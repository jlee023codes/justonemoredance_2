import { supabase } from "../lib/supabase";

export type SongSwapEntry = {
  id: string;
  songName: string;
  venueId?: string;
  venueName?: string;
};

type SongSwapRow = {
  id: string;
  song_name: string;
  venue_id: string | null;
  venues: { name: string } | { name: string }[] | null;
};

function venueNameFrom(row: SongSwapRow): string | undefined {
  const venues = row.venues;
  if (!venues) return undefined;
  return Array.isArray(venues) ? venues[0]?.name : venues.name;
}

/** A user's own saved song swaps for a dance — separate from BootStepper's
 *  catalog list. Each entry is optionally tied to a venue. */
export async function loadSongSwaps(
  userId: string,
  danceId: string,
): Promise<SongSwapEntry[]> {
  const { data, error } = await supabase
    .from("user_song_swaps")
    .select("id, song_name, venue_id, venues ( name )")
    .eq("user_id", userId)
    .eq("dance_id", danceId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return ((data ?? []) as SongSwapRow[]).map((row) => ({
    id: row.id,
    songName: row.song_name,
    venueId: row.venue_id ?? undefined,
    venueName: venueNameFrom(row),
  }));
}

export async function addSongSwap(
  userId: string,
  danceId: string,
  songName: string,
  venueId: string | null,
): Promise<void> {
  const { error } = await supabase.from("user_song_swaps").insert({
    user_id: userId,
    dance_id: danceId,
    venue_id: venueId,
    song_name: songName,
  });
  if (error) throw error;
}

export async function deleteSongSwap(userId: string, id: string): Promise<void> {
  const { error } = await supabase
    .from("user_song_swaps")
    .delete()
    .eq("user_id", userId)
    .eq("id", id);
  if (error) throw error;
}
