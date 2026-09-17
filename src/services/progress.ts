import { Dance, DanceProgress } from "../types";
import { supabase } from "../lib/supabase";

type ProgressRow = {
  dance_id: string;
  status: "none" | "want" | "learning" | "learned";
  source: string | null;
  dance_name: string | null;
  dance_song: string | null;
  dance_difficulty: string | null;
  dance_spotify_track_id: string | null;
  dance_spotify_url: string | null;
  dance_apple_music_url: string | null;
  dance_youtube_music_url: string | null;
  dance_amazon_music_url: string | null;
  dance_teach_video_url: string | null;
  link: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export async function loadProgress(
  userId: string,
): Promise<Record<string, DanceProgress>> {
  const { data, error } = await supabase
    .from("user_dance_progress")
    .select(
      "dance_id,status,source,dance_name,dance_song,dance_difficulty,dance_spotify_track_id,dance_spotify_url,dance_apple_music_url,dance_youtube_music_url,dance_amazon_music_url,dance_teach_video_url,link,created_at,updated_at",
    )
    .eq("user_id", userId);
  if (error) throw error;
  return Object.fromEntries(
    ((data ?? []) as ProgressRow[]).map((row) => [
      row.dance_id,
      {
        danceId: row.dance_id,
        status: row.status,
        fromFriend: row.source ?? "self",
        danceName: row.dance_name ?? undefined,
        danceSong: row.dance_song ?? undefined,
        danceDifficulty:
          (row.dance_difficulty as DanceProgress["danceDifficulty"]) ??
          undefined,
        danceSpotifyTrackId: row.dance_spotify_track_id ?? undefined,
        danceSpotifyUrl: row.dance_spotify_url ?? undefined,
        danceAppleMusicUrl: row.dance_apple_music_url ?? undefined,
        danceYoutubeMusicUrl: row.dance_youtube_music_url ?? undefined,
        danceAmazonMusicUrl: row.dance_amazon_music_url ?? undefined,
        danceTeachVideoUrl: row.dance_teach_video_url ?? undefined,
        link: row.link ?? undefined,
        createdAt: row.created_at ?? undefined,
        updatedAt: row.updated_at ?? undefined,
      },
    ]),
  );
}

// `dance` is the BootStepper dance being saved — we snapshot its
// name/song/difficulty onto the progress row so My List can still render
// it if a later live re-fetch fails (offline, removed upstream).
//
// Returns true if a row was written, false if it was left alone. `false`
// only happens in the default (non-overwrite) mode, which friend import
// uses — it must not clobber a status the user set themselves. The quick
// actions pass `overwrite: true` so a want→learning→learned move actually
// persists.
export async function saveProgress(
  userId: string,
  progress: DanceProgress,
  dance: Dance,
  friendUsername?: string,
  options: { overwrite?: boolean } = {},
): Promise<boolean> {
  if (!options.overwrite) {
    const { data: existingDance, error: checkError } = await supabase
      .from("user_dance_progress")
      .select("dance_id")
      .eq("user_id", userId)
      .eq("dance_id", progress.danceId)
      .maybeSingle();
    if (checkError) throw checkError;
    if (existingDance) return false;
  }

  // created_at is deliberately absent: on an upsert conflict Postgres only
  // writes the columns we list, so an existing "date added" survives every
  // later status change; a fresh insert gets the column default (now()).
  const { error } = await supabase.from("user_dance_progress").upsert({
    user_id: userId,
    dance_id: progress.danceId,
    status: progress.status,
    source: friendUsername ?? "self",
    dance_name: dance.name,
    dance_song: dance.defaultSong,
    dance_difficulty: dance.difficulty,
    dance_spotify_track_id: dance.spotifyTrackId ?? null,
    dance_spotify_url: dance.spotifyUrl ?? null,
    dance_apple_music_url: dance.appleMusicUrl ?? null,
    dance_youtube_music_url: dance.youtubeMusicUrl ?? null,
    dance_amazon_music_url: dance.amazonMusicUrl ?? null,
    dance_teach_video_url: dance.teachVideoUrl ?? null,
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
  return true;
}

// Re-syncs just the music/video snapshot on an *existing* row from a
// freshly-resolved BootStepper dance — status/created_at/updated_at are
// left untouched, so this can run silently in the background (App.tsx's
// dance-resolver effect) without disturbing My List's sort order or
// anything the user set themselves. Also how existing rows saved before
// migration_dance_music_links.sql backfill: the next time each dance
// resolves, its row picks these columns up.
export async function backfillDanceLinks(
  userId: string,
  dance: Dance,
): Promise<void> {
  const { error } = await supabase
    .from("user_dance_progress")
    .update({
      dance_spotify_track_id: dance.spotifyTrackId ?? null,
      dance_spotify_url: dance.spotifyUrl ?? null,
      dance_apple_music_url: dance.appleMusicUrl ?? null,
      dance_youtube_music_url: dance.youtubeMusicUrl ?? null,
      dance_amazon_music_url: dance.amazonMusicUrl ?? null,
      dance_teach_video_url: dance.teachVideoUrl ?? null,
    })
    .eq("user_id", userId)
    .eq("dance_id", dance.id);
  if (error) throw error;
}

// Sets (or clears) the reference link on an existing progress row —
// kept separate from saveProgress so an `overwrite` status change can't
// wipe it. Used by the Apple Notes import.
export async function setDanceLink(
  userId: string,
  danceId: string,
  link: string | null,
) {
  const { error } = await supabase
    .from("user_dance_progress")
    .update({ link })
    .eq("user_id", userId)
    .eq("dance_id", danceId);
  if (error) throw error;
}

// Wipes one or more dances from everything for this user: their
// want/learning/learned status, and every venue they've been tagged to.
// Used by the modal's "Remove" action and the list quick-delete / bulk
// remove — all of which confirm before calling this.
export async function removeDancesEverywhere(
  userId: string,
  danceIds: string[],
) {
  if (!danceIds.length) return;
  const [progressResult, venueResult] = await Promise.all([
    supabase
      .from("user_dance_progress")
      .delete()
      .eq("user_id", userId)
      .in("dance_id", danceIds),
    supabase
      .from("user_venue_dances")
      .delete()
      .eq("user_id", userId)
      .in("dance_id", danceIds),
  ]);
  if (progressResult.error) throw progressResult.error;
  if (venueResult.error) throw venueResult.error;
}

export function removeDanceEverywhere(userId: string, danceId: string) {
  return removeDancesEverywhere(userId, [danceId]);
}
