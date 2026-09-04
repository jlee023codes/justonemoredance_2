import { Dance, DanceProgress } from "../types";
import { supabase } from "../lib/supabase";
import { FriendDancesModal } from "../components/FriendDancesModal";
import { Alert } from "react-native";

type ProgressRow = {
  dance_id: string;
  status: "maybe" | "want" | "learned";
  source: string | null;
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
        fromFriend: row.source ?? "self",
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
// export async function saveProgress(
//   userId: string,
//   progress: DanceProgress,
//   dance: Dance,
//   friendUsername?: string,
// ) {
//   const { error } = await supabase.from("user_dance_progress").upsert({
//     user_id: userId,
//     dance_id: progress.danceId,
//     status: progress.status,
//     source: friendUsername ?? "self",
//     dance_name: dance.name,
//     dance_song: dance.defaultSong,
//     dance_difficulty: dance.difficulty,
//     updated_at: new Date().toISOString(),
//   });

//   if (error) throw error;
// }
export async function saveProgress(
  userId: string,
  progress: DanceProgress,
  dance: Dance,
  friendUsername?: string,
) {
  const { data: existingDance, error: checkError } = await supabase
    .from("user_dance_progress")
    .select("dance_id")
    .eq("user_id", userId)
    .eq("dance_id", progress.danceId)
    .maybeSingle();
  if (checkError) throw checkError;

  if (existingDance) {
    console.log("I already Know:", existingDance);

    return false;
  }
  const { error } = await supabase.from("user_dance_progress").insert({
    user_id: userId,
    dance_id: progress.danceId,
    status: progress.status,
    source: friendUsername ?? "self",
    dance_name: dance.name,
    dance_song: dance.defaultSong,
    dance_difficulty: dance.difficulty,
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
  return true;
}

// Used by "Remove" — deletes the progress row entirely (no row = no
// status at all, distinct from any of maybe/want/learned).
export async function deleteProgress(userId: string, danceId: string) {
  const { error } = await supabase
    .from("user_dance_progress")
    .delete()
    .eq("user_id", userId)
    .eq("dance_id", danceId);
  if (error) throw error;
}

// Wipes a dance from everything for this user: its want/learned/maybe
// status, and every venue it's been tagged to. Used by the modal's
// "Remove" action, which asks for confirmation before calling this.
export async function removeDanceEverywhere(userId: string, danceId: string) {
  const [progressResult, venueResult] = await Promise.all([
    supabase
      .from("user_dance_progress")
      .delete()
      .eq("user_id", userId)
      .eq("dance_id", danceId),
    supabase
      .from("user_venue_dances")
      .delete()
      .eq("user_id", userId)
      .eq("dance_id", danceId),
  ]);
  if (progressResult.error) throw progressResult.error;
  if (venueResult.error) throw venueResult.error;
}
