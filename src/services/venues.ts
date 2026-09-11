import { supabase } from "../lib/supabase";
import { Dance } from "../types";

export type VenueOption = {
  id: string;
  name: string;
  // Community "this is a real venue" signal — how many people have endorsed
  // it, and whether the current user is one of them. Undefined when not
  // loaded (e.g. a bare snapshot).
  votes?: number;
  votedByMe?: boolean;
};

// ---------------------------------------------------------------------
// The global venue catalog (the `venues` table) — shared across all users.
// ---------------------------------------------------------------------

/** Normalized venue name — must match public.venue_key() in the DB. This is
 *  what carries uniqueness: "Neon Boots", "neon boots" and "Neon  Boots!"
 *  all map to "neonboots". */
export function venueKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

// Fetches the thumbs-up tally for a set of venues and folds it in.
async function attachVotes(
  venues: VenueOption[],
  userId?: string,
): Promise<VenueOption[]> {
  if (!venues.length) return venues;
  const ids = venues.map((v) => v.id);
  const { data, error } = await supabase
    .from("venue_votes")
    .select("venue_id,user_id")
    .in("venue_id", ids);
  if (error) return venues; // non-critical — just show them without counts
  const counts = new Map<string, number>();
  const mine = new Set<string>();
  for (const row of (data ?? []) as { venue_id: string; user_id: string }[]) {
    counts.set(row.venue_id, (counts.get(row.venue_id) ?? 0) + 1);
    if (userId && row.user_id === userId) mine.add(row.venue_id);
  }
  return venues.map((v) => ({
    ...v,
    votes: counts.get(v.id) ?? 0,
    votedByMe: mine.has(v.id),
  }));
}

export async function searchGlobalVenues(
  query: string,
  userId?: string,
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
  const withVotes = await attachVotes((data ?? []) as VenueOption[], userId);
  // Best-endorsed first, then alphabetical — helps a real venue outrank a
  // typo'd duplicate that slipped in before name_key existed.
  return withVotes.sort(
    (a, b) => (b.votes ?? 0) - (a.votes ?? 0) || a.name.localeCompare(b.name),
  );
}

/** Same shape as searchGlobalVenues, but scoped to venues *this user* has
 *  already added — the free-tier picker. Browsing the full shared catalog
 *  (everyone else's venues) is the premium feature. */
export async function searchMyVenues(
  userId: string,
  query: string,
): Promise<VenueOption[]> {
  const mine = await loadUserVenues(userId);
  const needle = query.trim().toLowerCase();
  return needle ? mine.filter((v) => v.name.toLowerCase().includes(needle)) : mine;
}

/** One venue by id, with votes attached — used to hydrate a default
 *  selection (the home bar) where we only have the id, not the row. */
export async function loadVenueById(
  venueId: string,
  userId?: string,
): Promise<VenueOption | null> {
  const { data, error } = await supabase
    .from("venues")
    .select("id,name")
    .eq("id", venueId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const [withVotes] = await attachVotes([data], userId);
  return withVotes;
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

/** Finds a venue by its normalized name, or creates one in the shared
 *  catalog. Race-safe: if someone else inserts the same normalized name
 *  between our lookup and our insert, the unique index rejects ours and we
 *  return theirs. */
export async function findOrCreateGlobalVenue(
  name: string,
): Promise<VenueOption> {
  const trimmed = name.trim();
  const key = venueKey(trimmed);
  if (!key) throw new Error("A venue name needs at least one letter or number.");

  const findByKey = () =>
    supabase.from("venues").select("id,name").eq("name_key", key).maybeSingle();

  const { data: existing, error: findError } = await findByKey();
  if (findError) throw findError;
  if (existing) return existing;

  const { data: created, error: insertError } = await supabase
    .from("venues")
    .insert({ id: slugify(trimmed) || key, name: trimmed, name_key: key })
    .select("id,name")
    .single();
  if (!insertError) return created;

  // 23505 = unique violation: lost the race (name_key) or the readable id
  // collided with a different venue. Either way, the canonical row is the
  // one keyed by name_key.
  if (insertError.code === "23505") {
    const { data: raced } = await findByKey();
    if (raced) return raced;
    // id collided but name_key is free — retry with a unique id.
    const { data: retry, error: retryError } = await supabase
      .from("venues")
      .insert({
        id: `${slugify(trimmed)}-${key.slice(0, 6)}`,
        name: trimmed,
        name_key: key,
      })
      .select("id,name")
      .single();
    if (retryError) throw retryError;
    return retry;
  }
  throw insertError;
}

/** Plain lookup by exact (normalized) name — no create. Used by the
 *  free-tier picker to warn "this already exists in the shared catalog"
 *  *before* they commit to adding it, without blocking the add itself:
 *  free users can still add a venue that already exists elsewhere, they
 *  just won't see anyone else's dances there until they go Premium (see
 *  venue_dance_reports in migration_premium_venues.sql). */
export async function findVenueByName(name: string): Promise<VenueOption | null> {
  const key = venueKey(name);
  if (!key) return null;
  const { data, error } = await supabase
    .from("venues")
    .select("id,name")
    .eq("name_key", key)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

/** Toggle the current user's thumbs-up for a venue. */
export async function voteVenue(userId: string, venueId: string) {
  const { error } = await supabase
    .from("venue_votes")
    .upsert(
      { user_id: userId, venue_id: venueId },
      { onConflict: "user_id,venue_id", ignoreDuplicates: true },
    );
  if (error) throw error;
}

export async function unvoteVenue(userId: string, venueId: string) {
  const { error } = await supabase
    .from("venue_votes")
    .delete()
    .eq("user_id", userId)
    .eq("venue_id", venueId);
  if (error) throw error;
}

// ---------------------------------------------------------------------
// A user's own "My Venues" list — which venues they've added, regardless
// of whether they've tagged a dance to it yet.
// ---------------------------------------------------------------------

/** The user's "home bar" (profiles.default_venue_id) — pinned to the top of
 *  every venue list. null when they haven't chosen one. */
export async function loadHomeVenueId(userId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("default_venue_id")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  return data?.default_venue_id ?? null;
}

export async function setHomeVenue(
  userId: string,
  venueId: string | null,
): Promise<void> {
  const { error } = await supabase
    .from("profiles")
    .update({ default_venue_id: venueId })
    .eq("id", userId);
  if (error) throw error;
}

/** Home bar first, then whatever order the list already had. */
export function homeFirst<T extends { id: string }>(
  venues: T[],
  homeVenueId: string | null,
): T[] {
  if (!homeVenueId) return venues;
  const home = venues.filter((v) => v.id === homeVenueId);
  const rest = venues.filter((v) => v.id !== homeVenueId);
  return [...home, ...rest];
}

export async function loadUserVenues(userId: string): Promise<VenueOption[]> {
  const { data, error } = await supabase
    .from("user_venues")
    .select("venue_id, venues ( id, name )")
    .eq("user_id", userId);
  if (error) throw error;
  const venues = (data ?? [])
    .map((row: any) => row.venues as VenueOption | null)
    .filter((venue): venue is VenueOption => Boolean(venue))
    .sort((a, b) => a.name.localeCompare(b.name));
  return attachVotes(venues, userId);
}

export async function addUserVenue(userId: string, venueId: string) {
  const { error } = await supabase
    .from("user_venues")
    .upsert(
      { user_id: userId, venue_id: venueId },
      { onConflict: "user_id,venue_id", ignoreDuplicates: true },
    );
  if (error) throw error;
  // Adding a venue to your list is itself an endorsement.
  await voteVenue(userId, venueId).catch(() => {});
}

/** Drops a venue from the user's "My Venues" list. Leaves any
 *  `user_venue_dances` rows for that venue in place — same narrow scope as
 *  `addUserVenue` — so re-adding the venue brings its tagged dances back. */
export async function removeUserVenue(userId: string, venueId: string) {
  const { error } = await supabase
    .from("user_venues")
    .delete()
    .eq("user_id", userId)
    .eq("venue_id", venueId);
  if (error) throw error;
}

/** danceId → the venue ids this user has tagged it to. Powers the My List
 *  venue filter without a per-dance round trip. */
export async function loadVenueLinks(
  userId: string,
): Promise<Record<string, string[]>> {
  const { data, error } = await supabase
    .from("user_venue_dances")
    .select("dance_id,venue_id")
    .eq("user_id", userId);
  if (error) throw error;
  const links: Record<string, string[]> = {};
  for (const row of (data ?? []) as { dance_id: string; venue_id: string }[]) {
    (links[row.dance_id] ??= []).push(row.venue_id);
  }
  return links;
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

/** Every venue this user has tied a specific dance to — with names, so the
 *  details modal can list them and pre-check them in the multi-picker. */
export async function loadDanceVenues(
  userId: string,
  danceId: string,
): Promise<VenueOption[]> {
  const { data, error } = await supabase
    .from("user_venue_dances")
    .select("venue_id, venues ( id, name )")
    .eq("user_id", userId)
    .eq("dance_id", danceId);
  if (error) throw error;
  return (data ?? [])
    .map((row: any) => row.venues as VenueOption | null)
    .filter((v): v is VenueOption => Boolean(v))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Removes one dance⇄venue tie for this user (used when the multi-picker
 *  save unchecks a venue). Leaves the venue on the user's My Venues list. */
export async function removeVenueDance(
  userId: string,
  venueId: string,
  danceId: string,
) {
  const { error } = await supabase
    .from("user_venue_dances")
    .delete()
    .eq("user_id", userId)
    .eq("venue_id", venueId)
    .eq("dance_id", danceId);
  if (error) throw error;
}

// ---------------------------------------------------------------------
// The Venues page: dances reported at a venue by *everyone*, not just
// this user — via the venue_dance_reports view (see migration_venues_page /
// schema.sql), which aggregates without exposing who tagged what.
// ---------------------------------------------------------------------

export type VenueDanceReport = { dance: Dance; reportedBy: number };

type VenueDanceReportRow = {
  dance_id: string;
  dance_name: string | null;
  dance_song: string | null;
  dance_difficulty: string | null;
  reported_by: number;
};

export async function loadVenueDanceReports(
  venueId: string,
): Promise<VenueDanceReport[]> {
  const { data, error } = await supabase
    .from("venue_dance_reports")
    .select("dance_id,dance_name,dance_song,dance_difficulty,reported_by")
    .eq("venue_id", venueId)
    .order("reported_by", { ascending: false })
    .order("dance_name", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as VenueDanceReportRow[]).map((row) => ({
    dance: {
      id: row.dance_id,
      name: row.dance_name ?? "Dance",
      defaultSong: row.dance_song ?? "",
      difficulty: (row.dance_difficulty as Dance["difficulty"]) ?? "Beginner",
      details: "",
      songSwaps: [],
      // Only the snapshot — App.tsx's catalog resolves the real BootStepper
      // dance (choreographer, counts, …) the same way it does everywhere else.
      snapshot: true,
    },
    reportedBy: row.reported_by,
  }));
}
