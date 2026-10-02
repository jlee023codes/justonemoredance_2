import { invokeEdgeFunction } from "./edgeFunctions";

// Thin client for supabase/functions/youtube-sync — mirrors spotifySync.ts.
// See that function for the actual YouTube Data API calls; nothing here
// talks to Google/YouTube directly.
//
// YouTube gets two fully independent playlists per user — "Tutorials"
// (teach videos) and "Demos" (demo videos) — so every create/plan/apply
// call needs a `kind` telling the server which one it's operating on.
// Which dances actually land in each is a client-side decision (each
// kind's own status-scope picker in Profile — see musicSync.ts's
// YoutubeSyncScope), not something this function or the server knows
// about.

export type YoutubePlaylistKind = "tutorials" | "demos";

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
  kind: YoutubePlaylistKind,
  videoIds: string[],
): Promise<CreateYoutubePlaylistResult> {
  return invokeEdgeFunction("youtube-sync", { action: "create", kind, videoIds });
}

export type YoutubeSyncPlanResult = {
  // True when the stored playlist no longer exists (deleted directly in
  // YouTube) — the server already cleared the stale row; the client just
  // needs to refresh status so the button flips back to "Create".
  playlistMissing: boolean;
  toAddVideoIds: string[];
  toRemoveCandidateVideoIds: string[];
};

export async function planYoutubeSync(
  kind: YoutubePlaylistKind,
  videoIds: string[],
): Promise<YoutubeSyncPlanResult> {
  return invokeEdgeFunction("youtube-sync", { action: "sync-plan", kind, videoIds });
}

export type YoutubeSyncApplyResult = {
  added: number;
  removed: number;
  failed: string[];
};

export async function applyYoutubeSync(
  kind: YoutubePlaylistKind,
  args: {
    addVideoIds: string[];
    removeVideoIds: string[];
    keepVideoIds: string[];
  },
): Promise<YoutubeSyncApplyResult> {
  return invokeEdgeFunction("youtube-sync", { action: "sync-apply", kind, ...args });
}
