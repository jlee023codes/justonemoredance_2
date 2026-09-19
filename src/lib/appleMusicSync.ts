import { invokeEdgeFunction } from "./edgeFunctions";

// Thin client for supabase/functions/apple-music-sync — same shape as
// src/lib/spotifySync.ts, adapted for Apple Music's auth model (no
// authorization-code exchange; the client already has a Music User Token
// from MusicKit by the time "connect" is called — see
// src/lib/appleMusicAuth.tsx).

/** Apple Music Developer Tokens are signed server-side (with the MusicKit
 *  private key, which never leaves Supabase secrets) but the *token
 *  itself* isn't secret — it's designed to travel in client apps, same as
 *  Spotify's Client ID. Both MusicKit (native) and MusicKit JS (web) need
 *  one before they can do anything. Valid up to 6 months; this app just
 *  fetches a fresh one each cold start rather than caching across
 *  sessions, for simplicity. */
export async function fetchAppleMusicDeveloperToken(): Promise<string> {
  const result = await invokeEdgeFunction<{ developerToken: string }>(
    "apple-music-sync",
    { action: "developer-token" },
  );
  return result.developerToken;
}

export async function connectAppleMusic(musicUserToken: string): Promise<void> {
  await invokeEdgeFunction("apple-music-sync", {
    action: "connect",
    musicUserToken,
  });
}

export async function disconnectAppleMusic(): Promise<void> {
  await invokeEdgeFunction("apple-music-sync", { action: "disconnect" });
}

export type CreatePlaylistResult = {
  playlistId: string;
  trackCount: number;
};

export async function createAppleMusicPlaylist(
  trackIds: string[],
): Promise<CreatePlaylistResult> {
  return invokeEdgeFunction("apple-music-sync", { action: "create", trackIds });
}

export type SyncPlanResult = {
  // True when the stored playlist no longer exists (deleted directly in
  // Apple Music) — the server already cleared the stale row; the client
  // just needs to refresh status so the button flips back to "Create".
  playlistMissing: boolean;
  toAddTrackIds: string[];
  toRemoveCandidateTrackIds: string[];
};

export async function planAppleMusicSync(
  trackIds: string[],
): Promise<SyncPlanResult> {
  return invokeEdgeFunction("apple-music-sync", { action: "sync-plan", trackIds });
}

export type SyncApplyResult = {
  added: number;
  removed: number;
  failed: string[];
};

export async function applyAppleMusicSync(args: {
  addTrackIds: string[];
  removeTrackIds: string[];
  keepTrackIds: string[];
}): Promise<SyncApplyResult> {
  return invokeEdgeFunction("apple-music-sync", { action: "sync-apply", ...args });
}
