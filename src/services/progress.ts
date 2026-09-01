import { Dance, DanceProgress } from "../types";
import { supabase } from "../lib/supabase";

type ProgressRow = {
  dance_id: string;
  status: "want" | "learned";
  source: "self" | "friend";
  dance_name: string | null;
  dance_song: string | null;
  dance_difficulty: string | null;
};

export async function loadProgress(
  userId: string,
): Promise<Record<string, DanceProgress>> {
  const { data, error } = await supabase
    .from("user_dance_progress")
    .select("dance_id,status,source,dance_name,dance_song,dance_difficulty")
    .eq("user_id", userId);
  if (error) throw error;
  return Object.fromEntries(
    ((data ?? []) as ProgressRow[]).map((row) => [
      row.dance_id,
      {
        danceId: row.dance_id,
        status: row.status,
        fromFriend: row.source === "friend",
        danceName: row.dance_name ?? undefined,
        danceSong: row.dance_song ?? undefined,
        danceDifficulty:
          (row.dance_difficulty as DanceProgress["danceDifficulty"]) ??
          undefined,
      },
    ]),
  );
}

// `dance` is the full BootStepper dance being saved — we snapshot its
// name/song/difficulty alongside the progress row so the Want/Learned
// lists can still render something reasonable if a later live re-fetch
// from BootStepper fails (offline, dance removed upstream, etc).
export async function saveProgress(
  userId: string,
  progress: DanceProgress,
  dance: Dance,
) {
  const { error } = await supabase.from("user_dance_progress").upsert({
    user_id: userId,
    dance_id: progress.danceId,
    status: progress.status,
    source: progress.fromFriend ? "friend" : "self",
    dance_name: dance.name,
    dance_song: dance.defaultSong,
    dance_difficulty: dance.difficulty,
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
}
