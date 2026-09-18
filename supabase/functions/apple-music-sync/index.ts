// supabase/functions/apple-music-sync/index.ts
//
// Server side of My List's "Create/Sync Playlist" feature for Apple Music —
// see src/lib/playlistDiff.ts for the diff algorithm this applies, and
// src/lib/appleMusicAuth.tsx / src/lib/appleMusicSync.ts for the client
// side.
//
// Deploy:
//   supabase functions deploy apple-music-sync
// Secrets to set (from your MusicKit identifier in the Apple Developer
// portal — Certificates, Identifiers & Profiles > Keys):
//   supabase secrets set APPLE_MUSICKIT_TEAM_ID=your-10-char-team-id
//   supabase secrets set APPLE_MUSICKIT_KEY_ID=your-10-char-key-id
//   supabase secrets set APPLE_MUSICKIT_PRIVATE_KEY="$(cat AuthKey_XXXX.p8)"
//
// IMPORTANT, UNVERIFIED AGAINST LIVE DATA: Apple Music API has no DELETE
// endpoint for library playlist tracks (confirmed via Apple's own developer
// forums — this has been a long-standing, publicly complained-about gap).
// The documented workaround is to PUT a full replacement track list for a
// playlist your own app created. removeTracksViaReplace() below implements
// that. Verify this actually works once real MusicKit credentials exist —
// if Apple has tightened this further, "No, remove" will need a different
// approach (e.g. leaving the track in place and just not re-adding it,
// with copy that's honest about the limitation).

import { createClient } from "jsr:@supabase/supabase-js@2";
import { computeSyncPlan, computeNewSynced } from "../_shared/playlistDiff.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const API_BASE = "https://api.music.apple.com/v1";
const CHUNK_SIZE = 100; // Apple's per-call limit is generous; 100 matches Spotify's for consistency

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const teamId = Deno.env.get("APPLE_MUSICKIT_TEAM_ID");
  const keyId = Deno.env.get("APPLE_MUSICKIT_KEY_ID");
  const privateKey = Deno.env.get("APPLE_MUSICKIT_PRIVATE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey || !teamId || !keyId || !privateKey) {
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
      case "developer-token":
        return json({ developerToken: await signDeveloperToken(teamId, keyId, privateKey) });
      case "connect":
        return json(await connect(db, userId, body.musicUserToken as string));
      case "disconnect":
        return json(await disconnect(db, userId));
      case "create": {
        const devToken = await signDeveloperToken(teamId, keyId, privateKey);
        return json(await createPlaylist(db, devToken, userId, body.trackIds as string[]));
      }
      case "sync-plan": {
        const devToken = await signDeveloperToken(teamId, keyId, privateKey);
        return json(await syncPlan(db, devToken, userId, body.trackIds as string[]));
      }
      case "sync-apply": {
        const devToken = await signDeveloperToken(teamId, keyId, privateKey);
        return json(
          await syncApply(db, devToken, userId, body as {
            addTrackIds: string[];
            removeTrackIds: string[];
            keepTrackIds: string[];
          }),
        );
      }
      default:
        return json({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

// ---------------------------------------------------------------------
// Developer Token (JWT, ES256) — signed here so the MusicKit private key
// never leaves Supabase secrets. The token itself isn't secret (both
// MusicKit native and MusicKit JS need it client-side), just its signature
// must come from a key only this server holds.
// ---------------------------------------------------------------------

function base64UrlFromBytes(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlFromString(s: string): string {
  return base64UrlFromBytes(new TextEncoder().encode(s));
}

function pemToPkcs8(pem: string): ArrayBuffer {
  const body = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

let cachedToken: { token: string; expiresAt: number } | null = null;

/** Valid up to 6 months per Apple's limit; this caches in-memory for the
 *  life of the function instance (cold starts just re-sign, which is
 *  cheap) rather than persisting anywhere, to keep this stateless. */
async function signDeveloperToken(
  teamId: string,
  keyId: string,
  privateKeyPem: string,
): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.token;
  }

  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToPkcs8(privateKeyPem),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );

  const nowSec = Math.floor(Date.now() / 1000);
  const expSec = nowSec + 60 * 60 * 24 * 30; // 30 days — well under Apple's 6-month cap, rotated often via this cache
  const header = { alg: "ES256", kid: keyId };
  const payload = { iss: teamId, iat: nowSec, exp: expSec };

  const signingInput = `${base64UrlFromString(JSON.stringify(header))}.${base64UrlFromString(
    JSON.stringify(payload),
  )}`;
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    new TextEncoder().encode(signingInput),
  );
  // Web Crypto's ECDSA signature is already raw r||s (P1363 format), which
  // is exactly what JWS ES256 requires — no DER conversion needed.
  const token = `${signingInput}.${base64UrlFromBytes(new Uint8Array(signature))}`;

  cachedToken = { token, expiresAt: expSec * 1000 };
  return token;
}

// ---------------------------------------------------------------------
// Account lifecycle
// ---------------------------------------------------------------------

async function connect(
  db: ReturnType<typeof createClient>,
  userId: string,
  musicUserToken: string,
) {
  if (!musicUserToken) throw new Error("Missing Apple Music user token.");
  const { error } = await db.from("user_apple_music_accounts").upsert({
    user_id: userId,
    music_user_token: musicUserToken,
    connected_at: new Date().toISOString(),
  });
  if (error) throw error;
  return { connected: true };
}

async function disconnect(db: ReturnType<typeof createClient>, userId: string) {
  const { error } = await db.from("user_apple_music_accounts").delete().eq("user_id", userId);
  if (error) throw error;
  return { disconnected: true };
}

async function getUserToken(db: ReturnType<typeof createClient>, userId: string): Promise<string> {
  const { data, error } = await db
    .from("user_apple_music_accounts")
    .select("music_user_token")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Apple Music isn't connected.");
  return data.music_user_token;
}

// ---------------------------------------------------------------------
// Playlist operations
// ---------------------------------------------------------------------

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function authHeaders(developerToken: string, userToken: string) {
  return {
    Authorization: `Bearer ${developerToken}`,
    "Music-User-Token": userToken,
    "Content-Type": "application/json",
  };
}

const songRef = (catalogId: string) => ({ id: catalogId, type: "songs" });

async function fetchLiveCatalogTrackIds(
  developerToken: string,
  userToken: string,
  playlistId: string,
): Promise<string[]> {
  const ids: string[] = [];
  let url: string | null =
    `${API_BASE}/me/library/playlists/${playlistId}/tracks?limit=100&include[library-songs]=catalog`;
  while (url) {
    const res: Response = await fetch(url, {
      headers: authHeaders(developerToken, userToken),
    });
    if (!res.ok) throw new Error("Could not read your Apple Music playlist.");
    const page: any = await res.json();
    for (const item of page.data ?? []) {
      // Catalog id when the item carries one (added from the catalog, our
      // case); falls back to the item's own id if playParams is absent.
      const catalogId = item.attributes?.playParams?.catalogId ?? item.id;
      if (catalogId) ids.push(catalogId);
    }
    url = page.next ? `https://api.music.apple.com${page.next}` : null;
  }
  return ids;
}

async function addTracks(
  developerToken: string,
  userToken: string,
  playlistId: string,
  catalogIds: string[],
): Promise<string[]> {
  const confirmed: string[] = [];
  for (const batch of chunk(catalogIds, CHUNK_SIZE)) {
    if (!batch.length) continue;
    const res = await fetch(`${API_BASE}/me/library/playlists/${playlistId}/tracks`, {
      method: "POST",
      headers: authHeaders(developerToken, userToken),
      body: JSON.stringify({ data: batch.map(songRef) }),
    });
    if (res.ok) confirmed.push(...batch);
  }
  return confirmed;
}

/** No DELETE endpoint exists (see file header) — replaces the playlist's
 *  full track list instead, omitting the ids to remove. Only known to work
 *  for playlists this same app created via the API. */
async function removeTracksViaReplace(
  developerToken: string,
  userToken: string,
  playlistId: string,
  currentLiveIds: string[],
  removeIds: string[],
): Promise<string[]> {
  const removeSet = new Set(removeIds);
  const finalIds = currentLiveIds.filter((id) => !removeSet.has(id));
  const res = await fetch(`${API_BASE}/me/library/playlists/${playlistId}/tracks`, {
    method: "PUT",
    headers: authHeaders(developerToken, userToken),
    body: JSON.stringify({ data: finalIds.map(songRef) }),
  });
  return res.ok ? removeIds.filter((id) => removeSet.has(id)) : [];
}

async function createPlaylist(
  db: ReturnType<typeof createClient>,
  developerToken: string,
  userId: string,
  trackIds: string[],
) {
  const userToken = await getUserToken(db, userId);

  const res = await fetch(`${API_BASE}/me/library/playlists`, {
    method: "POST",
    headers: authHeaders(developerToken, userToken),
    body: JSON.stringify({
      attributes: {
        name: "Just One More Dance",
        description: "Synced from your My List on Just One More Dance.",
      },
      relationships: {
        tracks: { data: trackIds.slice(0, CHUNK_SIZE).map(songRef) },
      },
    }),
  });
  if (!res.ok) throw new Error("Could not create your Apple Music playlist.");
  const created = await res.json();
  const playlistId = created.data?.[0]?.id;
  if (!playlistId) throw new Error("Apple Music didn't return a playlist id.");

  // First CHUNK_SIZE seeded in the create call above; add the rest, if any.
  const remaining = trackIds.slice(CHUNK_SIZE);
  const restAdded = remaining.length
    ? await addTracks(developerToken, userToken, playlistId, remaining)
    : [];
  const allSynced = [...trackIds.slice(0, CHUNK_SIZE), ...restAdded];

  const { error } = await db.from("user_apple_music_playlists").upsert({
    user_id: userId,
    playlist_id: playlistId,
    last_synced_track_ids: allSynced,
    last_synced_at: new Date().toISOString(),
  });
  if (error) throw error;

  return { playlistId, trackCount: allSynced.length };
}

async function loadPlaylistRow(db: ReturnType<typeof createClient>, userId: string) {
  const { data, error } = await db
    .from("user_apple_music_playlists")
    .select("playlist_id, last_synced_track_ids")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("No playlist yet — create one first.");
  return data as { playlist_id: string; last_synced_track_ids: string[] };
}

async function syncPlan(
  db: ReturnType<typeof createClient>,
  developerToken: string,
  userId: string,
  myList: string[],
) {
  const userToken = await getUserToken(db, userId);
  const row = await loadPlaylistRow(db, userId);
  const live = await fetchLiveCatalogTrackIds(developerToken, userToken, row.playlist_id);
  const plan = computeSyncPlan(myList, live, row.last_synced_track_ids ?? []);
  return { toAddTrackIds: plan.toAdd, toRemoveCandidateTrackIds: plan.toRemoveCandidates };
}

async function syncApply(
  db: ReturnType<typeof createClient>,
  developerToken: string,
  userId: string,
  args: { addTrackIds: string[]; removeTrackIds: string[]; keepTrackIds: string[] },
) {
  const userToken = await getUserToken(db, userId);
  const row = await loadPlaylistRow(db, userId);

  const confirmedAdded = await addTracks(
    developerToken,
    userToken,
    row.playlist_id,
    args.addTrackIds ?? [],
  );

  let confirmedRemoved: string[] = [];
  if ((args.removeTrackIds ?? []).length) {
    const live = await fetchLiveCatalogTrackIds(developerToken, userToken, row.playlist_id);
    confirmedRemoved = await removeTracksViaReplace(
      developerToken,
      userToken,
      row.playlist_id,
      live,
      args.removeTrackIds,
    );
  }

  const newSynced = computeNewSynced(
    row.last_synced_track_ids ?? [],
    confirmedAdded,
    confirmedRemoved,
    args.keepTrackIds ?? [],
  );

  const { error } = await db
    .from("user_apple_music_playlists")
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
