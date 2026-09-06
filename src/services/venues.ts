import { supabase } from "../lib/supabase";
import { Dance } from "../types";

export type VenueOption = { id: string; name: string };

// ---------------------------------------------------------------------
// The global venue catalog (the `venues` table) — shared across all users.
// ---------------------------------------------------------------------

export async function searchGlobalVenues(
  query: string,
  limit = 20,
): Promise<VenueOption[]> {
  let request = supabase
    .from("venues")
    .select("id,name")
    .order("name")
    .limit(limit);
  if (query.trim()) request = request.ilike("name", `%${query.trim()}%`);
  const { data, error } = await request;
  if (error) throw error;
  return data ?? [];
}

function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || `venue-${Date.now()}`;
}

/** Finds a venue by exact (case-insensitive) name, or creates one in the
 *  shared catalog. Two people typing "Neon Boots" both land on the same row. */
export async function findOrCreateGlobalVenue(
  name: string,
): Promise<VenueOption> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Venue name can't be empty.");

  const { data: existing, error: findError } = await supabase
    .from("venues")
    .select("id,name")
    .ilike("name", trimmed)
    .limit(1)
    .maybeSingle();
  if (findError) throw findError;
  if (existing) return existing;

  const { data: created, error: insertError } = await supabase
    .from("venues")
    .insert({ id: slugify(trimmed), name: trimmed })
    .select("id,name")
    .single();
  if (insertError) throw insertError;
  return created;
}

// ---------------------------------------------------------------------
// A user's own "My Venues" list — which venues they've added, regardless
// of whether they've tagged a dance to it yet.
// ---------------------------------------------------------------------

export async function loadUserVenues(userId: string): Promise<VenueOption[]> {
  const { data, error } = await supabase
    .from("user_venues")
    .select("venue_id, venues ( id, name )")
    .eq("user_id", userId);
  if (error) throw error;
  return (data ?? [])
    .map((row: any) => row.venues as VenueOption | null)
    .filter((venue): venue is VenueOption => Boolean(venue))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function addUserVenue(userId: string, venueId: string) {
  const { error } = await supabase
    .from("user_venues")
    .upsert(
      { user_id: userId, venue_id: venueId },
      { onConflict: "user_id,venue_id", ignoreDuplicates: true },
    );
  if (error) throw error;
}

// ---------------------------------------------------------------------
// Dances a user has tied to a particular venue, with an optional song swap.
// ---------------------------------------------------------------------

type VenueDanceRow = {
  dance_id: string;
  dance_name: string | null;
  dance_song: string | null;
  dance_difficulty: string | null;
  song_swap: string | null;
};

export async function loadVenueDances(
  userId: string,
  venueId: string,
): Promise<{ dance: Dance; songSwap?: string }[]> {
  const { data, error } = await supabase
    .from("user_venue_dances")
    .select("dance_id,dance_name,dance_song,dance_difficulty,song_swap")
    .eq("user_id", userId)
    .eq("venue_id", venueId)
    .order("added_at", { ascending: false });
  if (error) throw error;
  return ((data ?? []) as VenueDanceRow[]).map((row) => ({
    dance: {
      id: row.dance_id,
      name: row.dance_name ?? "Dance",
      defaultSong: row.dance_song ?? "",
      difficulty: (row.dance_difficulty as Dance["difficulty"]) ?? "Beginner",
      details: "",
      songSwaps: [],
    },
    songSwap: row.song_swap ?? undefined,
  }));
}

/** Ties a dance to a venue for this user (and makes sure that venue shows
 *  up in their "My Venues" list, even if it's their first dance there). */
export async function saveVenueDance(
  userId: string,
  venueId: string,
  dance: Dance,
  songSwap: string,
) {
  await addUserVenue(userId, venueId);
  const { error } = await supabase.from("user_venue_dances").upsert({
    user_id: userId,
    venue_id: venueId,
    dance_id: dance.id,
    dance_name: dance.name,
    dance_song: dance.defaultSong,
    dance_difficulty: dance.difficulty,
    song_swap: songSwap || null,
    added_at: new Date().toISOString(),
  });
  if (error) throw error;
}

/** Every venue this user has already tied a specific dance to — used to
 *  disable re-adding the same venue and mark it in the picker. */
export async function loadDanceVenueIds(
  userId: string,
  danceId: string,
): Promise<string[]> {
  const { data, error } = await supabase
    .from("user_venue_dances")
    .select("venue_id")
    .eq("user_id", userId)
    .eq("dance_id", danceId);
  if (error) throw error;
  return (data ?? []).map((row: any) => row.venue_id as string);
}
