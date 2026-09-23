// supabase/functions/youtube-sync/index.ts
//
// Server side of My List's "Create/Sync YouTube Playlist" feature (the
// third provider alongside Spotify/Apple Music) — see
// src/lib/playlistDiff.ts for the diff algorithm this applies, and
// src/lib/googleAuth.ts / src/lib/youtubeSync.ts for the client side.
//
// Deploy:
//   supabase functions deploy youtube-sync
// Secrets to set — Google issues a SEPARATE OAuth client per platform (an
// "iOS" type for native, a "Web application" type for web; see
// googleAuth.ts's header comment for why), so this needs two client id
// pairs. The native pair's secret is expected to be empty (iOS clients are
// public/PKCE-only, per Google's docs) — set it to an empty string, never
// omit the var:
//   supabase secrets set GOOGLE_CLIENT_ID_NATIVE=your-ios-client-id
//   supabase secrets set GOOGLE_CLIENT_SECRET_NATIVE=
//   supabase secrets set GOOGLE_CLIENT_ID_WEB=your-web-client-id
//   supabase secrets set GOOGLE_CLIENT_SECRET_WEB=your-web-client-secret
//
// user_youtube_accounts / user_youtube_playlists (migration_youtube_sync.sql)
// have no RLS policy for `authenticated` at all on the accounts table —
// only this function's service-role client ever reads/writes a refresh
// token.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { computeSyncPlan, computeNewSynced } from "../_shared/playlistDiff.ts";
import { playlistNameFor } from "../_shared/playlistName.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API_BASE = "https://www.googleapis.com/youtube/v3";

type ClientCreds = { clientId: string; clientSecret: string };

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const creds: Record<"native" | "web", ClientCreds> = {
    native: {
      clientId: Deno.env.get("GOOGLE_CLIENT_ID_NATIVE") ?? "",
      clientSecret: Deno.env.get("GOOGLE_CLIENT_SECRET_NATIVE") ?? "",
    },
    web: {
      clientId: Deno.env.get("GOOGLE_CLIENT_ID_WEB") ?? "",
      clientSecret: Deno.env.get("GOOGLE_CLIENT_SECRET_WEB") ?? "",
    },
  };
  if (!supabaseUrl || !anonKey || !serviceRoleKey || !creds.native.clientId || !creds.web.clientId) {
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
      case "exchange-code": {
        const platform = body.platform === "web" ? "web" : "native";
        return json(
          await exchangeCode(db, creds[platform], userId, body as {
            code: string;
            codeVerifier: string;
            redirectUri: string;
          }),
        );
      }
      case "disconnect":
        return json(await disconnect(db, userId));
      case "create":
        return json(
          await createPlaylist(db, creds, userId, body.videoIds as string[]),
        );
      case "sync-plan":
        return json(
          await syncPlan(db, creds, userId, body.videoIds as string[]),
        );
      case "sync-apply":
        return json(
          await syncApply(db, creds, userId, body as {
            addVideoIds: string[];
            removeVideoIds: string[];
            keepVideoIds: string[];
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

function tokenRequestBody(creds: ClientCreds, extra: Record<string, string>) {
  const params: Record<string, string> = { client_id: creds.clientId, ...extra };
  // Only sent when actually configured — the native (iOS) client is
  // public/PKCE-only and has no real secret; Google's docs say
  // client_secret "is not applicable" to that client type, so omitting it
  // there mirrors Spotify's PKCE-needs-no-secret model exactly.
  if (creds.clientSecret) params.client_secret = creds.clientSecret;
  return new URLSearchParams(params);
}

async function exchangeCode(
  db: ReturnType<typeof createClient>,
  creds: ClientCreds,
  userId: string,
  args: { code: string; codeVerifier: string; redirectUri: string },
) {
  const tokenRes = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: tokenRequestBody(creds, {
      grant_type: "authorization_code",
      code: args.code,
      redirect_uri: args.redirectUri,
      code_verifier: args.codeVerifier,
    }),
  });
  if (!tokenRes.ok) {
    throw new Error(`Google token exchange failed: ${await tokenRes.text()}`);
  }
  const tokens = await tokenRes.json();
  if (!tokens.refresh_token) {
    // Shouldn't happen with access_type=offline&prompt=consent on every
    // request (see googleAuth.ts) — surfacing clearly beats a mysterious
    // failure on the first sync after connect.
    throw new Error(
      "Google didn't return a refresh token — disconnect and reconnect YouTube.",
    );
  }

  const meRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  if (!meRes.ok) {
    throw new Error(`Could not read your Google profile: ${await meRes.text()}`);
  }
  const me = await meRes.json();

  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
  const { error } = await db.from("user_youtube_accounts").upsert({
    user_id: userId,
    google_user_id: me.id,
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
  const { error } = await db.from("user_youtube_accounts").delete().eq("user_id", userId);
  if (error) throw error;
  return { disconnected: true };
}

/** Returns a live access token, refreshing first if the cached one has
 *  expired. Same conditional-overwrite-of-refresh_token pattern as
 *  Spotify's getAccessToken — Google, like Spotify, doesn't always return
 *  a new refresh_token on refresh, and keeping the old one when it
 *  doesn't is correct (only overwrite when a new one actually arrives).
 *  The stored account row doesn't remember which platform (native/web)
 *  connected it, so refreshes are always attempted against BOTH client
 *  credential pairs — Google's refresh endpoint just 400s on a mismatched
 *  client_id/refresh_token pair, so trying native first and falling back
 *  to web (or vice versa) is cheap and avoids needing a third stored
 *  column purely for this. */
async function getAccessToken(
  db: ReturnType<typeof createClient>,
  creds: Record<"native" | "web", ClientCreds>,
  userId: string,
): Promise<string> {
  const { data: account, error } = await db
    .from("user_youtube_accounts")
    .select("refresh_token, access_token, access_token_expires_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!account) throw new Error("YouTube isn't connected.");

  const stillValid =
    account.access_token &&
    account.access_token_expires_at &&
    new Date(account.access_token_expires_at).getTime() > Date.now() + 30_000;
  if (stillValid) return account.access_token;

  let tokens: any = null;
  let lastError = "";
  for (const platform of ["native", "web"] as const) {
    const tokenRes = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: tokenRequestBody(creds[platform], {
        grant_type: "refresh_token",
        refresh_token: account.refresh_token,
      }),
    });
    if (tokenRes.ok) {
      tokens = await tokenRes.json();
      break;
    }
    lastError = await tokenRes.text();
  }
  if (!tokens) {
    throw new Error(`Your YouTube connection expired — reconnect in Profile. (${lastError})`);
  }
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

  const update: Record<string, unknown> = {
    access_token: tokens.access_token,
    access_token_expires_at: expiresAt,
  };
  if (tokens.refresh_token) update.refresh_token = tokens.refresh_token;

  const { error: updateError } = await db
    .from("user_youtube_accounts")
    .update(update)
    .eq("user_id", userId);
  if (updateError) throw updateError;

  return tokens.access_token;
}

// ---------------------------------------------------------------------
// Playlist operations
// ---------------------------------------------------------------------

/** Thrown specifically for a 404 reading the playlist — distinct from
 *  every other failure so syncPlan can recover (the user deleted the
 *  playlist directly in YouTube, so JOMD's stored playlist_id is stale)
 *  instead of just surfacing a generic sync error. */
class PlaylistNotFoundError extends Error {}

/** Unlike Spotify's flat track-id list, deleting a YouTube playlist item
 *  requires the *playlist item's own id*, not the video id
 *  (playlistItems.delete takes id=<playlistItemId>) — so this returns
 *  both a flat videoId[] (for computeSyncPlan, which only ever deals in
 *  the provider's chosen id string) and a videoId -> playlistItemId map
 *  (used only here, at the two points that actually touch YouTube's API:
 *  fetch and delete). Not persisted — cheap to re-fetch, and persisting
 *  it could go stale between a sync-plan and the sync-apply that follows. */
async function fetchLiveVideos(
  accessToken: string,
  playlistId: string,
): Promise<{ videoIds: string[]; itemIdByVideoId: Map<string, string> }> {
  const videoIds: string[] = [];
  const itemIdByVideoId = new Map<string, string>();
  let pageToken: string | undefined;
  do {
    const url = new URL(`${API_BASE}/playlistItems`);
    url.searchParams.set("part", "snippet");
    url.searchParams.set("playlistId", playlistId);
    url.searchParams.set("maxResults", "50");
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (res.status === 404) {
      throw new PlaylistNotFoundError("Your YouTube playlist no longer exists.");
    }
    if (!res.ok) {
      throw new Error(`Could not read your YouTube playlist: ${await res.text()}`);
    }
    const page: any = await res.json();
    for (const item of page.items ?? []) {
      const videoId = item.snippet?.resourceId?.videoId;
      if (videoId && item.id) {
        videoIds.push(videoId);
        itemIdByVideoId.set(videoId, item.id);
      }
    }
    pageToken = page.nextPageToken;
  } while (pageToken);
  return { videoIds, itemIdByVideoId };
}

/** No bulk-add endpoint on YouTube's API — one playlistItems.insert call
 *  per video, unlike Spotify's ≤100-id chunked POST. Returns only the ids
 *  that actually succeeded — a partial failure must not be credited as
 *  synced (see src/lib/playlistDiff.ts's computeNewSynced). A video that's
 *  private/deleted/region-blocked fails its own insert without aborting
 *  the rest. */
async function addVideos(
  accessToken: string,
  playlistId: string,
  videoIds: string[],
): Promise<string[]> {
  const confirmed: string[] = [];
  for (const videoId of videoIds) {
    const res = await fetch(`${API_BASE}/playlistItems?part=snippet`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        snippet: { playlistId, resourceId: { kind: "youtube#video", videoId } },
      }),
    });
    if (res.ok) confirmed.push(videoId);
  }
  return confirmed;
}

/** Deletes by playlist-item id, looked up from a fresh live fetch (see
 *  fetchLiveVideos) — a video already removed from the live playlist
 *  (no matching item id) is treated as already-confirmed-removed rather
 *  than an error, since the end state either way is "not in the
 *  playlist." */
async function removeVideos(
  accessToken: string,
  itemIdByVideoId: Map<string, string>,
  videoIds: string[],
): Promise<string[]> {
  const confirmed: string[] = [];
  for (const videoId of videoIds) {
    const itemId = itemIdByVideoId.get(videoId);
    if (!itemId) {
      confirmed.push(videoId);
      continue;
    }
    const res = await fetch(`${API_BASE}/playlistItems?id=${encodeURIComponent(itemId)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (res.ok) confirmed.push(videoId);
  }
  return confirmed;
}

async function createPlaylist(
  db: ReturnType<typeof createClient>,
  creds: Record<"native" | "web", ClientCreds>,
  userId: string,
  videoIds: string[],
) {
  const accessToken = await getAccessToken(db, creds, userId);
  const name = await playlistNameFor(db, userId);

  const createRes = await fetch(`${API_BASE}/playlists?part=snippet,status`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      snippet: {
        title: name,
        description: "Synced from your My List on Just One More Dance.",
      },
      status: { privacyStatus: "private" },
    }),
  });
  if (!createRes.ok) {
    throw new Error(`Could not create your YouTube playlist: ${await createRes.text()}`);
  }
  const playlist = await createRes.json();

  const added = await addVideos(accessToken, playlist.id, videoIds);

  const { error } = await db.from("user_youtube_playlists").upsert({
    user_id: userId,
    playlist_id: playlist.id,
    playlist_url: `https://www.youtube.com/playlist?list=${playlist.id}`,
    last_synced_video_ids: added,
    last_synced_at: new Date().toISOString(),
  });
  if (error) throw error;

  return {
    playlistId: playlist.id,
    playlistUrl: `https://www.youtube.com/playlist?list=${playlist.id}`,
    videoCount: added.length,
  };
}

async function loadPlaylistRow(db: ReturnType<typeof createClient>, userId: string) {
  const { data, error } = await db
    .from("user_youtube_playlists")
    .select("playlist_id, last_synced_video_ids")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("No playlist yet — create one first.");
  return data as { playlist_id: string; last_synced_video_ids: string[] };
}

async function syncPlan(
  db: ReturnType<typeof createClient>,
  creds: Record<"native" | "web", ClientCreds>,
  userId: string,
  myList: string[],
) {
  const accessToken = await getAccessToken(db, creds, userId);
  const row = await loadPlaylistRow(db, userId);
  let live: { videoIds: string[]; itemIdByVideoId: Map<string, string> };
  try {
    live = await fetchLiveVideos(accessToken, row.playlist_id);
  } catch (err) {
    if (err instanceof PlaylistNotFoundError) {
      // Stale row — the user deleted the playlist directly in YouTube.
      // Drop it so the client sees "not connected to a playlist" and
      // offers Create instead of a broken Sync.
      await db.from("user_youtube_playlists").delete().eq("user_id", userId);
      return { playlistMissing: true, toAddVideoIds: [], toRemoveCandidateVideoIds: [] };
    }
    throw err;
  }
  const plan = computeSyncPlan(myList, live.videoIds, row.last_synced_video_ids ?? []);
  return {
    playlistMissing: false,
    toAddVideoIds: plan.toAdd,
    toRemoveCandidateVideoIds: plan.toRemoveCandidates,
  };
}

async function syncApply(
  db: ReturnType<typeof createClient>,
  creds: Record<"native" | "web", ClientCreds>,
  userId: string,
  args: { addVideoIds: string[]; removeVideoIds: string[]; keepVideoIds: string[] },
) {
  const accessToken = await getAccessToken(db, creds, userId);
  const row = await loadPlaylistRow(db, userId);

  const confirmedAdded = await addVideos(accessToken, row.playlist_id, args.addVideoIds ?? []);

  let confirmedRemoved: string[] = [];
  if ((args.removeVideoIds ?? []).length) {
    // Needs a fresh videoId -> playlistItemId map — see removeVideos.
    const { itemIdByVideoId } = await fetchLiveVideos(accessToken, row.playlist_id);
    confirmedRemoved = await removeVideos(accessToken, itemIdByVideoId, args.removeVideoIds ?? []);
  }

  const newSynced = computeNewSynced(
    row.last_synced_video_ids ?? [],
    confirmedAdded,
    confirmedRemoved,
    args.keepVideoIds ?? [],
  );

  const { error } = await db
    .from("user_youtube_playlists")
    .update({ last_synced_video_ids: newSynced, last_synced_at: new Date().toISOString() })
    .eq("user_id", userId);
  if (error) throw error;

  const failedToAdd = (args.addVideoIds ?? []).filter((id) => !confirmedAdded.includes(id));
  const failedToRemove = (args.removeVideoIds ?? []).filter(
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
