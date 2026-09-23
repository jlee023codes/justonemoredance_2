import { invokeEdgeFunction } from "./edgeFunctions";

// Thin client for supabase/functions/youtube-sync — mirrors spotifySync.ts.
// See that function for the actual YouTube Data API calls; nothing here
// talks to Google/YouTube directly.

export async function exchangeYoutubeCode(
  code: string,
  codeVerifier: string,
  redirectUri: string,
  platform: "native" | "web",
): Promise<void> {
  await invokeEdgeFunction("youtube-sync", {
    action: "exchange-code",
    code,
    codeVerifier,
    redirectUri,
    platform,
  });
}

export async function disconnectYoutube(): Promise<void> {
  await invokeEdgeFunction("youtube-sync", { action: "disconnect" });
}

export type CreateYoutubePlaylistResult = {
  playlistId: string;
  playlistUrl: string;
  videoCount: number;
};

export async function createYoutubePlaylist(
  videoIds: string[],
): Promise<CreateYoutubePlaylistResult> {
  return invokeEdgeFunction("youtube-sync", { action: "create", videoIds });
}

export type YoutubeSyncPlanResult = {
  // True when the stored playlist no longer exists (deleted directly in
  // YouTube) — the server already cleared the stale row; the client just
  // needs to refresh status so the button flips back to "Create".
  playlistMissing: boolean;
  toAddVideoIds: string[];
  toRemoveCandidateVideoIds: string[];
};

export async function planYoutubeSync(videoIds: string[]): Promise<YoutubeSyncPlanResult> {
  return invokeEdgeFunction("youtube-sync", { action: "sync-plan", videoIds });
}

export type YoutubeSyncApplyResult = {
  added: number;
  removed: number;
  failed: string[];
};

export async function applyYoutubeSync(args: {
  addVideoIds: string[];
  removeVideoIds: string[];
  keepVideoIds: string[];
}): Promise<YoutubeSyncApplyResult> {
  return invokeEdgeFunction("youtube-sync", { action: "sync-apply", ...args });
}
