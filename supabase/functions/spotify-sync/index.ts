// supabase/functions/spotify-sync/index.ts
//
// Server side of My List's "Create/Sync Playlist" feature — see
// src/lib/playlistDiff.ts for the diff algorithm this applies, and
// src/lib/spotifyAuth.ts / src/lib/spotifySync.ts for the client side.
//
// Deploy:
//   supabase functions deploy spotify-sync
// Secret to set (the Spotify Client ID — NOT the app's secret; Authorization
// Code + PKCE needs no client secret at all, see spotifyAuth.ts):
//   supabase secrets set SPOTIFY_CLIENT_ID=your-client-id-here
//
// user_spotify_accounts / user_spotify_playlists (migration_playlist_sync.sql)
// have no RLS policy for `authenticated` at all on the accounts table — only
// this function's service-role client ever reads/writes a refresh token.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { computeSyncPlan, computeNewSynced } from "../_shared/playlistDiff.ts";
import { playlistNameFor } from "../_shared/playlistName.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const TOKEN_URL = "https://accounts.spotify.com/api/token";
const API_BASE = "https://api.spotify.com/v1";
const CHUNK_SIZE = 100; // Spotify's per-call limit for playlist track add/remove

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const clientId = Deno.env.get("SPOTIFY_CLIENT_ID");
  if (!supabaseUrl || !anonKey || !serviceRoleKey || !clientId) {
    return json({ error: "Server misconfiguration: missing env vars" }, 500);
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const asCaller = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userError } = await asCaller.auth.getUser();
  if (userError || !userData.user) {
    return json({ error: "Not authenticated" }, 401);
  }
  const userId = userData.user.id;
  const db = createClient(supabaseUrl, serviceRoleKey);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid request body" }, 400);
  }
  const action = body.action;

  try {
    switch (action) {
      case "exchange-code":
        return json(
          await exchangeCode(db, clientId, userId, body as {
            code: string;
            codeVerifier: string;
            redirectUri: string;
          }),
        );
      case "disconnect":
        return json(await disconnect(db, userId));
      case "create":
        return json(
          await createPlaylist(db, clientId, userId, body.trackIds as string[]),
        );
      case "sync-plan":
        return json(
          await syncPlan(db, clientId, userId, body.trackIds as string[]),
        );
      case "sync-apply":
        return json(
          await syncApply(db, clientId, userId, body as {
            addTrackIds: string[];
            removeTrackIds: string[];
            keepTrackIds: string[];
          }),
        );
      default:
        return json({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

// ---------------------------------------------------------------------
// Token lifecycle
// ---------------------------------------------------------------------

async function exchangeCode(
  db: ReturnType<typeof createClient>,
  clientId: string,
  userId: string,
  args: { code: string; codeVerifier: string; redirectUri: string },
) {
  const tokenRes = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: args.code,
      redirect_uri: args.redirectUri,
      client_id: clientId,
      code_verifier: args.codeVerifier,
    }),
  });
  if (!tokenRes.ok) {
    throw new Error(`Spotify token exchange failed: ${await tokenRes.text()}`);
  }
  const tokens = await tokenRes.json();

  const meRes = await fetch(`${API_BASE}/me`, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  if (!meRes.ok) throw new Error("Could not read your Spotify profile.");
  const me = await meRes.json();

  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
  const { error } = await db.from("user_spotify_accounts").upsert({
    user_id: userId,
    spotify_user_id: me.id,
    refresh_token: tokens.refresh_token,
    access_token: tokens.access_token,
    access_token_expires_at: expiresAt,
    connected_at: new Date().toISOString(),
  });
  if (error) throw error;
  return { connected: true };
}

async function disconnect(db: ReturnType<typeof createClient>, userId: string) {
  // Leaves any already-created playlist alone — disconnecting just stops
  // JOMD from managing it further, it doesn't delete the user's playlist.
  const { error } = await db.from("user_spotify_accounts").delete().eq("user_id", userId);
  if (error) throw error;
  return { disconnected: true };
}

/** Returns a live access token, refreshing first if the cached one has
 *  expired. Spotify sometimes rotates the refresh token on refresh —
 *  overwriting the stored one when that happens is not optional, or the
 *  *next* refresh silently breaks. */
async function getAccessToken(
  db: ReturnType<typeof createClient>,
  clientId: string,
  userId: string,
): Promise<{ accessToken: string; spotifyUserId: string }> {
  const { data: account, error } = await db
    .from("user_spotify_accounts")
    .select("spotify_user_id, refresh_token, access_token, access_token_expires_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!account) throw new Error("Spotify isn't connected.");

  const stillValid =
    account.access_token &&
    account.access_token_expires_at &&
    new Date(account.access_token_expires_at).getTime() > Date.now() + 30_000;
  if (stillValid) {
    return { accessToken: account.access_token, spotifyUserId: account.spotify_user_id };
  }

  const tokenRes = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: account.refresh_token,
      client_id: clientId,
    }),
  });
  if (!tokenRes.ok) {
    throw new Error("Your Spotify connection expired — reconnect in Profile.");
  }
  const tokens = await tokenRes.json();
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

  const update: Record<string, unknown> = {
    access_token: tokens.access_token,
    access_token_expires_at: expiresAt,
  };
  // Only present when Spotify rotates it — must persist or the next
  // refresh call uses a dead refresh_token.
  if (tokens.refresh_token) update.refresh_token = tokens.refresh_token;

  const { error: updateError } = await db
    .from("user_spotify_accounts")
    .update(update)
    .eq("user_id", userId);
  if (updateError) throw updateError;

  return { accessToken: tokens.access_token, spotifyUserId: account.spotify_user_id };
}

// ---------------------------------------------------------------------
// Playlist operations
// ---------------------------------------------------------------------

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

const trackUri = (id: string) => `spotify:track:${id}`;

async function fetchLiveTrackIds(accessToken: string, playlistId: string): Promise<string[]> {
  const ids: string[] = [];
  let url: string | null =
    `${API_BASE}/playlists/${playlistId}/tracks?fields=items(track(id)),next&limit=100`;
  while (url) {
    const res: Response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new Error("Could not read your Spotify playlist.");
    const page: any = await res.json();
    for (const item of page.items ?? []) {
      if (item.track?.id) ids.push(item.track.id);
    }
    url = page.next ?? null;
  }
  return ids;
}

/** Adds ids to the playlist in chunks; returns only the ids from chunks
 *  that actually succeeded — a partial failure must not be credited as
 *  synced (see src/lib/playlistDiff.ts's computeNewSynced). */
async function addTracks(
  accessToken: string,
  playlistId: string,
  trackIds: string[],
): Promise<string[]> {
  const confirmed: string[] = [];
  for (const batch of chunk(trackIds, CHUNK_SIZE)) {
    if (!batch.length) continue;
    const res = await fetch(`${API_BASE}/playlists/${playlistId}/tracks`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ uris: batch.map(trackUri) }),
    });
    if (res.ok) confirmed.push(...batch);
  }
  return confirmed;
}

async function removeTracks(
  accessToken: string,
  playlistId: string,
  trackIds: string[],
): Promise<string[]> {
  const confirmed: string[] = [];
  for (const batch of chunk(trackIds, CHUNK_SIZE)) {
    if (!batch.length) continue;
    const res = await fetch(`${API_BASE}/playlists/${playlistId}/tracks`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ tracks: batch.map((id) => ({ uri: trackUri(id) })) }),
    });
    if (res.ok) confirmed.push(...batch);
  }
  return confirmed;
}

async function createPlaylist(
  db: ReturnType<typeof createClient>,
  clientId: string,
  userId: string,
  trackIds: string[],
) {
  const { accessToken, spotifyUserId } = await getAccessToken(db, clientId, userId);
  const name = await playlistNameFor(db, userId);

  const createRes = await fetch(`${API_BASE}/users/${spotifyUserId}/playlists`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name,
      description: "Synced from your My List on Just One More Dance.",
      public: false,
    }),
  });
  if (!createRes.ok) throw new Error("Could not create your Spotify playlist.");
  const playlist = await createRes.json();

  const added = await addTracks(accessToken, playlist.id, trackIds);

  const { error } = await db.from("user_spotify_playlists").upsert({
    user_id: userId,
    playlist_id: playlist.id,
    playlist_url: playlist.external_urls?.spotify ?? null,
    last_synced_track_ids: added,
    last_synced_at: new Date().toISOString(),
  });
  if (error) throw error;

  return {
    playlistId: playlist.id,
    playlistUrl: playlist.external_urls?.spotify ?? null,
    trackCount: added.length,
  };
}

async function loadPlaylistRow(db: ReturnType<typeof createClient>, userId: string) {
  const { data, error } = await db
    .from("user_spotify_playlists")
    .select("playlist_id, last_synced_track_ids")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("No playlist yet — create one first.");
  return data as { playlist_id: string; last_synced_track_ids: string[] };
}

async function syncPlan(
  db: ReturnType<typeof createClient>,
  clientId: string,
  userId: string,
  myList: string[],
) {
  const { accessToken } = await getAccessToken(db, clientId, userId);
  const row = await loadPlaylistRow(db, userId);
  const live = await fetchLiveTrackIds(accessToken, row.playlist_id);
  const plan = computeSyncPlan(myList, live, row.last_synced_track_ids ?? []);
  return { toAddTrackIds: plan.toAdd, toRemoveCandidateTrackIds: plan.toRemoveCandidates };
}

async function syncApply(
  db: ReturnType<typeof createClient>,
  clientId: string,
  userId: string,
  args: { addTrackIds: string[]; removeTrackIds: string[]; keepTrackIds: string[] },
) {
  const { accessToken } = await getAccessToken(db, clientId, userId);
  const row = await loadPlaylistRow(db, userId);

  const confirmedAdded = await addTracks(accessToken, row.playlist_id, args.addTrackIds ?? []);
  const confirmedRemoved = await removeTracks(
    accessToken,
    row.playlist_id,
    args.removeTrackIds ?? [],
  );

  const newSynced = computeNewSynced(
    row.last_synced_track_ids ?? [],
    confirmedAdded,
    confirmedRemoved,
    args.keepTrackIds ?? [],
  );

  const { error } = await db
    .from("user_spotify_playlists")
    .update({ last_synced_track_ids: newSynced, last_synced_at: new Date().toISOString() })
    .eq("user_id", userId);
  if (error) throw error;

  const failedToAdd = (args.addTrackIds ?? []).filter((id) => !confirmedAdded.includes(id));
  const failedToRemove = (args.removeTrackIds ?? []).filter(
    (id) => !confirmedRemoved.includes(id),
  );

  return {
    added: confirmedAdded.length,
    removed: confirmedRemoved.length,
    failed: [...failedToAdd, ...failedToRemove],
  };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}
