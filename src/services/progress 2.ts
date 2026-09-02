import { DanceProgress } from "../types";
import { supabase } from "../lib/supabase";

type ProgressRow = {
  dance_id: string;
  status: "want" | "learned";
  personal_venue_id: string | null;
  personal_song_swap: string | null;
  source: "self" | "friend";
};
export async function loadProgress(
  userId: string,
): Promise<Record<string, DanceProgress>> {
  const { data, error } = await supabase
    .from("user_dance_progress")
    .select("dance_id,status,personal_venue_id,personal_song_swap,source")
    .eq("user_id", userId);
  if (error) throw error;
  return Object.fromEntries(
    ((data ?? []) as ProgressRow[]).map((row) => [
      row.dance_id,
      {
        danceId: row.dance_id,
        status: row.status,
        personalVenueId: row.personal_venue_id ?? undefined,
        personalSongSwap: row.personal_song_swap ?? undefined,
        fromFriend: row.source === "friend",
      },
    ]),
  );
}
export async function saveProgress(userId: string, progress: DanceProgress) {
  const { error } = await supabase
    .from("user_dance_progress")
    .upsert({
      user_id: userId,
      dance_id: progress.danceId,
      status: progress.status,
      personal_venue_id: progress.personalVenueId ?? null,
      personal_song_swap: progress.personalSongSwap ?? null,
      source: progress.fromFriend ? "friend" : "self",
      updated_at: new Date().toISOString(),
    });
  if (error) throw error;
}
