import { supabase } from "../lib/supabase";
import { LearningStatus } from "../types";
import { YoutubePlaylistKind } from "../lib/youtubeSync";

// A free-form subset of My List statuses to sync — multi-select, so any
// combination is valid (e.g. "none" + "learned" but not "learning"). The
// old three-way "all / learning_learned / learned" enum is gone: "none"
// (added to My List but not yet tagged Want/Learning/Learned — still
// counts toward your list per src/lib/planLimits.ts) is now its own
// selectable option rather than something only "all" silently included,
// so there's no longer any hidden/derived state — "Everything" in the
// UI is purely a shortcut for selecting all four, computed client-side.
export type PlaylistSyncScope = LearningStatus[];

export const DEFAULT_SYNC_SCOPE: PlaylistSyncScope = ["learning", "learned"];

export async function loadPlaylistSyncScope(
  userId: string,
): Promise<PlaylistSyncScope> {
  const { data, error } = await supabase
    .from("profiles")
    .select("playlist_sync_scope")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  const scope = data?.playlist_sync_scope as PlaylistSyncScope | null;
  return scope?.length ? scope : DEFAULT_SYNC_SCOPE;
}

export async function setPlaylistSyncScope(
  userId: string,
  scope: PlaylistSyncScope,
): Promise<void> {
  const { error } = await supabase
    .from("profiles")
    .update({ playlist_sync_scope: scope })
    .eq("id", userId);
  if (error) throw error;
}

// YouTube syncs to two fully separate playlists by video kind — see
// YoutubePlaylistKind in lib/youtubeSync.ts ("tutorials"/"demos") — each
// with its own status-scope preference (which dances count toward that
// playlist: any combination of "learning" [= want + learning dances
// together] and "learned"). Two profiles columns, same text[] shape as
// playlist_sync_scope above: youtube_sync_scope (repurposed as
// Tutorials' scope) and youtube_demo_sync_scope (Demos').
export type YoutubeStatusGroup = "learning" | "learned";
export type YoutubeSyncScope = YoutubeStatusGroup[];

export const DEFAULT_YOUTUBE_SYNC_SCOPE: YoutubeSyncScope = ["learning", "learned"];

function isYoutubeStatusGroup(value: unknown): value is YoutubeStatusGroup {
  return value === "learning" || value === "learned";
}

const YOUTUBE_SCOPE_COLUMN: Record<YoutubePlaylistKind, "youtube_sync_scope" | "youtube_demo_sync_scope"> = {
  tutorials: "youtube_sync_scope",
  demos: "youtube_demo_sync_scope",
};

export async function loadYoutubeSyncScope(
  userId: string,
  kind: YoutubePlaylistKind,
): Promise<YoutubeSyncScope> {
  const column = YOUTUBE_SCOPE_COLUMN[kind];
  const { data, error } = await supabase
    .from("profiles")
    .select(column)
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  const raw = ((data as any)?.[column] as unknown[] | null) ?? [];
  const scope = raw.filter(isYoutubeStatusGroup);
  return scope.length ? scope : DEFAULT_YOUTUBE_SYNC_SCOPE;
}

export async function setYoutubeSyncScope(
  userId: string,
  kind: YoutubePlaylistKind,
  scope: YoutubeSyncScope,
): Promise<void> {
  const column = YOUTUBE_SCOPE_COLUMN[kind];
  const { error } = await supabase
    .from("profiles")
    .update({ [column]: scope })
    .eq("id", userId);
  if (error) throw error;
}

/** Spotify's developer-mode cap means only manually-allowlisted users can
 *  connect at all — see migration_playlist_sync.sql. Apple Music has no
 *  such gate. */
export async function loadSpotifyBetaEnabled(userId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("profiles")
    .select("spotify_beta_enabled")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  return data?.spotify_beta_enabled === true;
}

export type MusicAccountStatus = {
  connected: boolean;
  spotifyUserId?: string | null;
  playlistId: string | null;
  playlistUrl: string | null;
};

/** The underlying `user_*_accounts` tables are fully locked down (no RLS
 *  policy for `authenticated` at all — only the edge functions'
 *  service-role client can touch refresh_token/music_user_token).
 *  `my_spotify_account` / `my_apple_music_account` (migration_playlist_sync.sql)
 *  are narrow views — never expose the token columns — that the client
 *  reads instead, purely to answer "am I connected." */
export async function loadSpotifyStatus(userId: string): Promise<MusicAccountStatus> {
  const [account, playlist] = await Promise.all([
    supabase
      .from("my_spotify_account")
      .select("spotify_user_id")
      .eq("user_id", userId)
      .maybeSingle(),
    supabase
      .from("user_spotify_playlists")
      .select("playlist_id, playlist_url")
      .eq("user_id", userId)
      .maybeSingle(),
  ]);
  if (account.error) throw account.error;
  if (playlist.error) throw playlist.error;
  return {
    connected: !!account.data,
    spotifyUserId: account.data?.spotify_user_id ?? null,
    playlistId: playlist.data?.playlist_id ?? null,
    playlistUrl: playlist.data?.playlist_url ?? null,
  };
}

export async function loadAppleMusicStatus(userId: string): Promise<MusicAccountStatus> {
  const [account, playlist] = await Promise.all([
    supabase.from("my_apple_music_account").select("user_id").eq("user_id", userId).maybeSingle(),
    supabase
      .from("user_apple_music_playlists")
      .select("playlist_id")
      .eq("user_id", userId)
      .maybeSingle(),
  ]);
  if (account.error) throw account.error;
  if (playlist.error) throw playlist.error;
  return {
    connected: !!account.data,
    playlistId: playlist.data?.playlist_id ?? null,
    playlistUrl: null,
  };
}

export type YoutubeAccountStatus = {
  connected: boolean;
  tutorials: { playlistId: string | null; playlistUrl: string | null };
  demos: { playlistId: string | null; playlistUrl: string | null };
};

/** Two rows possible now (one per kind, see
 *  migration_youtube_tutorials_demos_split.sql) instead of one — this
 *  returns both playlists' status in one call rather than the
 *  single-playlist MusicAccountStatus shape Spotify/Apple Music use. */
export async function loadYoutubeStatus(userId: string): Promise<YoutubeAccountStatus> {
  const [account, playlists] = await Promise.all([
    supabase.from("my_youtube_account").select("user_id").eq("user_id", userId).maybeSingle(),
    supabase
      .from("user_youtube_playlists")
      .select("kind, playlist_id, playlist_url")
      .eq("user_id", userId),
  ]);
  if (account.error) throw account.error;
  if (playlists.error) throw playlists.error;
  const byKind = new Map(
    (playlists.data ?? []).map((row: any) => [row.kind as YoutubePlaylistKind, row]),
  );
  const forKind = (kind: YoutubePlaylistKind) => ({
    playlistId: byKind.get(kind)?.playlist_id ?? null,
    playlistUrl: byKind.get(kind)?.playlist_url ?? null,
  });
  return {
    connected: !!account.data,
    tutorials: forKind("tutorials"),
    demos: forKind("demos"),
  };
}
