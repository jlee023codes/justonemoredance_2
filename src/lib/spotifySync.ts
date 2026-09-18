import { invokeEdgeFunction } from "./edgeFunctions";

// Thin client for supabase/functions/spotify-sync — mirrors how
// src/lib/bootstepper.ts wraps bootstepper-proxy. See that function for the
// actual Spotify API calls; nothing here talks to Spotify directly.

export async function exchangeSpotifyCode(
  code: string,
  codeVerifier: string,
  redirectUri: string,
): Promise<void> {
  await invokeEdgeFunction("spotify-sync", {
    action: "exchange-code",
    code,
    codeVerifier,
    redirectUri,
  });
}

export async function disconnectSpotify(): Promise<void> {
  await invokeEdgeFunction("spotify-sync", { action: "disconnect" });
}

export type CreatePlaylistResult = {
  playlistId: string;
  playlistUrl: string;
  trackCount: number;
};

export async function createSpotifyPlaylist(
  trackIds: string[],
): Promise<CreatePlaylistResult> {
  return invokeEdgeFunction("spotify-sync", { action: "create", trackIds });
}

export type SyncPlanResult = {
  toAddTrackIds: string[];
  toRemoveCandidateTrackIds: string[];
};

export async function planSpotifySync(trackIds: string[]): Promise<SyncPlanResult> {
  return invokeEdgeFunction("spotify-sync", { action: "sync-plan", trackIds });
}

export type SyncApplyResult = {
  added: number;
  removed: number;
  failed: string[];
};

export async function applySpotifySync(args: {
  addTrackIds: string[];
  removeTrackIds: string[];
  keepTrackIds: string[];
}): Promise<SyncApplyResult> {
  return invokeEdgeFunction("spotify-sync", { action: "sync-apply", ...args });
}
