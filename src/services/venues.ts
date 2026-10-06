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
  // Crowdsourced "city, state" — null until someone fills it in. See
  // migration_venue_address.sql.
  address?: string | null;
  // Manually stamped by the product owner via the SQL editor — never
  // settable from the app itself (enforced by a column-level grant, not
  // just by omission in the UI). See migration_venue_address.sql.
  addressVerified?: boolean;
  // Real coordinates — null until someone adds this venue via Google
  // Places (findOrCreateGlobalVenueFromPlace) or otherwise fills them in.
  // Same "first submission wins" lock as address. See
  // migration_venue_places.sql.
  latitude?: number | null;
  longitude?: number | null;
  // Google's own id for this place — lets "Get Directions" pin exactly
  // on the right result while still showing the venue's name as the
  // label (see src/lib/directions.ts).
  googlePlaceId?: string | null;
  // Whoever first added this venue to the catalog — they can always
  // manage its nights (see attachRepStatus), same as an admin or
  // approved rep. See migration_venue_created_by.sql.
  createdBy?: string | null;
  // One row per day of the week this venue has line dancing — see
  // migration_venue_nights.sql and attachNights below. Undefined when
  // not loaded (e.g. a bare snapshot), empty array when loaded but none
  // submitted yet.
  nights?: VenueNight[];
  // Whether the current viewer can add/edit/remove this venue's nights
  // — true for admins (every venue) and approved reps (their own
  // venue only). See attachRepStatus and migration_venue_reps.sql.
  canManageNights?: boolean;
  // The current viewer's own rep request for this venue, if any —
  // drives whether "Become this venue's rep" / "Request pending" shows.
  repStatus?: RepStatus;
  // Manually stamped by the product owner via the SQL editor — blocks
  // further `venue_nights` writes for this venue regardless of which
  // days are already filled in, even for an approved rep. See
  // migration_venue_reps.sql.
  detailsLocked?: boolean;
  // Distinct check-ins (migration_venue_checkins.sql) — see
  // attachCheckinCounts and VERIFIED_THRESHOLD above.
  checkinCount?: number;
  // Derived, not a DB column: true while this venue is still below
  // VENUE_PUBLIC_THRESHOLD and the viewer can only see it because
  // they created it or have it in their own user_venues list — i.e.
  // the only case where the viewer can see this row at all AND it's
  // still locked to everyone else. Computed client-side by
  // attachCheckinCounts; a venue the viewer can't see isn't in the
  // results to begin with, so this only ever describes "my own,
  // still-locked" venues, never someone else's.
  locked?: boolean;
};

export type DayOfWeek = "sun" | "mon" | "tue" | "wed" | "thu" | "fri" | "sat";
export type VenueNight = { day: DayOfWeek; details: string };
export type RepStatus = "pending" | "approved" | "denied" | null;

export const DAY_ORDER: DayOfWeek[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
export const DAY_LABEL: Record<DayOfWeek, string> = {
  sun: "Sun",
  mon: "Mon",
  tue: "Tue",
  wed: "Wed",
  thu: "Thu",
  fri: "Fri",
  sat: "Sat",
};

// A venue's check-in Verified badge (see VenueCard.tsx) unlocks at this
// many distinct check-ins — a plain constant, same spirit as
// awards.ts's ladders, so it's tunable without a migration. NEW signal,
// separate from addressVerified above (the existing admin-only manual
// stamp — don't conflate them). See migration_venue_checkins.sql.
export const VERIFIED_THRESHOLD = 3;

// A brand-new venue is only visible to whoever added it until this
// many distinct users have actually checked in there — enforced
// server-side by venues' RLS policy (migration_venue_lock.sql), using
// the same venue_checkin_counts view VERIFIED_THRESHOLD reads. Kept
// in sync with the SQL constant `>= 5` in that migration; change both
// together if this ever moves.
export const VENUE_PUBLIC_THRESHOLD = 5;

const VENUE_SELECT = "id,name,address,addressVerified:address_verified,latitude,longitude,googlePlaceId:google_place_id,createdBy:created_by,detailsLocked:details_locked";

// Fetches venue_nights rows for a set of venues and folds them in,
// sorted Sun-Sat — same shape as attachVotes below.
export async function attachNights(venues: VenueOption[]): Promise<VenueOption[]> {
  if (!venues.length) return venues;
  const ids = venues.map((v) => v.id);
  const { data, error } = await supabase
    .from("venue_nights")
    .select("venue_id,day_of_week,details")
    .in("venue_id", ids);
  if (error) return venues.map((v) => ({ ...v, nights: [] }));
  const byVenue = new Map<string, VenueNight[]>();
  for (const row of (data ?? []) as { venue_id: string; day_of_week: DayOfWeek; details: string }[]) {
    const list = byVenue.get(row.venue_id) ?? [];
    list.push({ day: row.day_of_week, details: row.details });
    byVenue.set(row.venue_id, list);
  }
  for (const list of byVenue.values()) {
    list.sort((a, b) => DAY_ORDER.indexOf(a.day) - DAY_ORDER.indexOf(b.day));
  }
  return venues.map((v) => ({ ...v, nights: byVenue.get(v.id) ?? [] }));
}

/** Whether the signed-in user is a universal admin (profiles.is_admin,
 *  set manually by the product owner via SQL) — treated as an approved
 *  rep for every venue. See migration_venue_reps.sql. */
export async function isUserAdmin(userId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", userId)
    .maybeSingle();
  if (error) return false;
  return Boolean((data as { is_admin?: boolean } | null)?.is_admin);
}

/** Folds in whether the viewer can manage each venue's nights (admin,
 *  or their own approved-rep venue) and their own rep request status.
 *  isAdmin is passed in rather than re-queried per call — load it once
 *  per screen via isUserAdmin. */
export async function attachRepStatus(
  venues: VenueOption[],
  userId: string,
  isAdmin: boolean,
): Promise<VenueOption[]> {
  if (!venues.length) return venues;
  if (isAdmin) {
    return venues.map((v) => ({ ...v, canManageNights: true, repStatus: "approved" }));
  }
  const ids = venues.map((v) => v.id);
  const { data, error } = await supabase
    .from("venue_representatives")
    .select("venue_id,status")
    .eq("user_id", userId)
    .in("venue_id", ids);
  if (error) {
    return venues.map((v) => ({ ...v, canManageNights: v.createdBy === userId, repStatus: null }));
  }
  const byVenue = new Map(
    (data ?? []).map((r: any) => [r.venue_id as string, r.status as RepStatus]),
  );
  return venues.map((v) => {
    const status = byVenue.get(v.id) ?? null;
    // Whoever created the venue can always manage it — same trust as an
    // approved rep (see can_manage_venue in migration_venue_created_by.sql).
    return {
      ...v,
      canManageNights: status === "approved" || v.createdBy === userId,
      repStatus: status,
    };
  });
}

/** Asks to become a venue's representative — always lands as 'pending',
 *  the owner approves/denies by hand via SQL. Returns false rather than
 *  throwing if a request already exists for this venue. */
export async function requestVenueRep(venueId: string, userId: string): Promise<boolean> {
  const { error } = await supabase
    .from("venue_representatives")
    .insert({ venue_id: venueId, user_id: userId });
  if (error) {
    if (error.code === "23505") return false; // already requested
    throw error;
  }
  return true;
}

/** Submits one day's details for a venue. Only an admin or approved rep
 *  for that venue can call this — see can_manage_venue in
 *  migration_venue_reps.sql; RLS silently no-ops (no row returned)
 *  rather than this throwing for anyone else. */
export async function addVenueNight(
  venueId: string,
  day: DayOfWeek,
  details: string,
): Promise<boolean> {
  const trimmed = details.trim();
  if (!trimmed) throw new Error("Describe that night — time, cover, age, etc.");
  const { error } = await supabase
    .from("venue_nights")
    .insert({ venue_id: venueId, day_of_week: day, details: trimmed });
  if (error) {
    if (error.code === "23505") return false; // someone already added that day
    throw error;
  }
  return true;
}

/** Edits an existing night's details — same admin/approved-rep gate as
 *  addVenueNight, now allowed since the writer is vetted rather than
 *  anonymous. */
export async function updateVenueNight(
  venueId: string,
  day: DayOfWeek,
  details: string,
): Promise<void> {
  const trimmed = details.trim();
  if (!trimmed) throw new Error("Describe that night — time, cover, age, etc.");
  const { error } = await supabase
    .from("venue_nights")
    .update({ details: trimmed })
    .eq("venue_id", venueId)
    .eq("day_of_week", day);
  if (error) throw error;
}

/** Removes a night entirely — same admin/approved-rep gate. */
export async function deleteVenueNight(venueId: string, day: DayOfWeek): Promise<void> {
  const { error } = await supabase
    .from("venue_nights")
    .delete()
    .eq("venue_id", venueId)
    .eq("day_of_week", day);
  if (error) throw error;
}

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

/** The venue this user has tagged the most dances at, or null if they
 *  haven't tagged any yet. Counts client-side (same house style as
 *  attachVotes/attachNights) rather than a DB-side group-by — fine at
 *  the per-user row counts this app deals with. */
export async function loadMostDancedVenue(userId: string): Promise<VenueOption | null> {
  const { data, error } = await supabase
    .from("user_venue_dances")
    .select("venue_id")
    .eq("user_id", userId);
  if (error || !data?.length) return null;
  const counts = new Map<string, number>();
  for (const row of data as { venue_id: string }[]) {
    counts.set(row.venue_id, (counts.get(row.venue_id) ?? 0) + 1);
  }
  let topId: string | null = null;
  let topCount = 0;
  for (const [venueId, count] of counts) {
    if (count > topCount) {
      topId = venueId;
      topCount = count;
    }
  }
  return topId ? loadVenueById(topId, userId) : null;
}

export async function searchGlobalVenues(
  query: string,
  userId?: string,
  limit = 20,
  days?: DayOfWeek[],
): Promise<VenueOption[]> {
  const trimmed = query.trim();
  let request = supabase.from("venues").select(VENUE_SELECT).order("name");
  // A text search narrows to matching rows first, so capping at the DB is
  // safe. The no-query "browse" case can't cap here — ordering
  // alphabetically before votes are even known would cut off a
  // well-endorsed venue just for sorting late in the alphabet (e.g. "The
  // Grizzly Rose"); fetch everything and cap after the real ranking below.
  if (trimmed) request = request.ilike("name", `%${trimmed}%`).limit(limit);
  // Filtering to venues dancing ANY of the given days (multi-select) is a
  // small separate lookup against venue_nights (a handful of rows at
  // this app's scale) rather than an embedded-resource join, to keep
  // the main query's select string a stable literal (see VENUE_SELECT —
  // Supabase's type inference needs that to stay one literal, not built
  // dynamically).
  if (days?.length) {
    const { data: dayRows, error: dayError } = await supabase
      .from("venue_nights")
      .select("venue_id")
      .in("day_of_week", days);
    if (dayError) throw dayError;
    const ids = [...new Set((dayRows ?? []).map((r) => r.venue_id as string))];
    if (!ids.length) return [];
    request = request.in("id", ids);
  }
  const { data, error } = await request;
  if (error) throw error;
  const withVotes = await attachVotes((data ?? []) as VenueOption[], userId);
  const withNights = await attachNights(withVotes);
  const withCheckins = await attachCheckinCounts(withNights, userId);
  // Best-endorsed first, then alphabetical — helps a real venue outrank a
  // typo'd duplicate that slipped in before name_key existed.
  const ranked = withCheckins.sort(
    (a, b) => (b.votes ?? 0) - (a.votes ?? 0) || a.name.localeCompare(b.name),
  );
  return trimmed ? ranked : ranked.slice(0, limit);
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
    .select(VENUE_SELECT)
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

export type FoundOrCreatedVenue = { venue: VenueOption; isNew: boolean };

/** Looks up a venue's id regardless of lock state (via the
 *  SECURITY DEFINER find_venue_id RPC — see migration_venue_lock.sql),
 *  then re-fetches full details through the normal RLS-gated select.
 *  The id lookup never leaks a locked venue's details to someone who
 *  can't otherwise see it; the follow-up select just returns nothing
 *  extra in that case, same as if the row didn't exist for them. Used
 *  by findOrCreateGlobalVenue/FromPlace so a second person adding the
 *  same not-yet-unlocked venue attaches to (and helps unlock) the
 *  real row instead of creating a duplicate. */
async function findExistingVenueId(nameKey: string, googlePlaceId?: string): Promise<string | null> {
  const { data, error } = await supabase.rpc("find_venue_id", {
    p_name_key: nameKey,
    p_google_place_id: googlePlaceId ?? null,
  });
  if (error) throw error;
  return (data as string | null) ?? null;
}

/** Finds a venue by its normalized name, or creates one in the shared
 *  catalog. Race-safe: if someone else inserts the same normalized name
 *  between our lookup and our insert, the unique index rejects ours and we
 *  return theirs. `isNew` tells the caller whether this really just got
 *  created (vs. matched an existing row) — VenuePicker uses it to prompt
 *  the creator for a starting schedule, since created_by makes them able
 *  to manage this venue's nights (see migration_venue_created_by.sql). */
export async function findOrCreateGlobalVenue(
  name: string,
  userId?: string,
): Promise<FoundOrCreatedVenue> {
  const trimmed = name.trim();
  const key = venueKey(trimmed);
  if (!key) throw new Error("A venue name needs at least one letter or number.");

  const findExisting = async (): Promise<VenueOption | null> => {
    const existingId = await findExistingVenueId(key);
    if (!existingId) return null;
    const { data, error } = await supabase
      .from("venues")
      .select(VENUE_SELECT)
      .eq("id", existingId)
      .maybeSingle();
    if (error) throw error;
    // null here means the venue is locked and this caller isn't its
    // creator — the id is still real and safe to attach
    // user_venues/venue_checkins rows to (that's how a venue actually
    // reaches the unlock threshold), it just means this caller can't
    // see its full card yet. A bare id+name snapshot is enough to
    // proceed with (same shape used elsewhere in this app for
    // not-yet-fully-loaded data).
    return data ?? { id: existingId, name: trimmed };
  };

  const existing = await findExisting();
  if (existing) return { venue: existing, isNew: false };

  const { data: created, error: insertError } = await supabase
    .from("venues")
    .insert({ id: slugify(trimmed) || key, name: trimmed, name_key: key, created_by: userId ?? null })
    .select(VENUE_SELECT)
    .single();
  if (!insertError) return { venue: created, isNew: true };

  // 23505 = unique violation: lost the race (name_key) or the readable id
  // collided with a different venue. Either way, the canonical row is the
  // one keyed by name_key.
  if (insertError.code === "23505") {
    const raced = await findExisting();
    if (raced) return { venue: raced, isNew: false };
    // id collided but name_key is free — retry with a unique id.
    const { data: retry, error: retryError } = await supabase
      .from("venues")
      .insert({
        id: `${slugify(trimmed)}-${key.slice(0, 6)}`,
        name: trimmed,
        name_key: key,
        created_by: userId ?? null,
      })
      .select(VENUE_SELECT)
      .single();
    if (retryError) throw retryError;
    return { venue: retry, isNew: true };
  }
  throw insertError;
}

/** Fills in a venue's coordinates/Google place id — only works while
 *  they're still blank (see migration_venue_places.sql's RLS policy:
 *  `using (latitude is null)`). Same "first submission wins" shape as
 *  setVenueAddress below. Returns false (not an error) if someone else
 *  already set it first. */
export async function setVenueLocation(
  venueId: string,
  location: { latitude: number; longitude: number; googlePlaceId?: string; address?: string | null },
): Promise<boolean> {
  const update: Record<string, unknown> = {
    latitude: location.latitude,
    longitude: location.longitude,
  };
  if (location.googlePlaceId) update.google_place_id = location.googlePlaceId;
  const { data, error } = await supabase
    .from("venues")
    .update(update)
    .eq("id", venueId)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  // A venue picked via Places search that matched an existing free-text
  // venue by name might also still be missing its address — fill that in
  // too, same best-effort spirit, but never let a failure here undo the
  // location update above.
  if (data && location.address) {
    await setVenueAddress(venueId, location.address).catch(() => {});
  }
  return Boolean(data);
}

/** Finds or creates a venue from a Google Places result (see
 *  src/lib/placesSearch.ts) — same race-safety as findOrCreateGlobalVenue,
 *  but matches first on google_place_id (the most reliable identity for a
 *  real place) before falling back to the same name_key dedup everyone
 *  else uses, so two people independently picking the same Google place
 *  land on one venue row either way. An existing free-text-added venue
 *  found by name gets backfilled with real coordinates/address if it
 *  didn't already have them. */
export async function findOrCreateGlobalVenueFromPlace(
  place: {
    name: string;
    placeId: string;
    latitude: number;
    longitude: number;
    formattedAddress?: string | null;
  },
  userId?: string,
): Promise<FoundOrCreatedVenue> {
  const trimmed = place.name.trim();
  const key = venueKey(trimmed);
  if (!key) throw new Error("A venue name needs at least one letter or number.");

  const findExisting = async (): Promise<VenueOption | null> => {
    const existingId = await findExistingVenueId(key, place.placeId);
    if (!existingId) return null;
    const { data, error } = await supabase
      .from("venues")
      .select(VENUE_SELECT)
      .eq("id", existingId)
      .maybeSingle();
    if (error) throw error;
    // null here means locked + not this caller's — see the identical
    // comment in findOrCreateGlobalVenue. Skip the "backfill missing
    // coordinates" step below in that case: there's nothing visible
    // to backfill onto, and the id/name snapshot already has real
    // coordinates from this Places result if the caller wants to use
    // them directly.
    if (!data) return { id: existingId, name: trimmed, latitude: place.latitude, longitude: place.longitude };
    if (data.latitude == null) {
      await setVenueLocation(data.id, {
        latitude: place.latitude,
        longitude: place.longitude,
        googlePlaceId: place.placeId,
        address: place.formattedAddress,
      }).catch(() => {});
      return {
        ...data,
        latitude: place.latitude,
        longitude: place.longitude,
        address: data.address ?? place.formattedAddress,
      };
    }
    return data;
  };

  const existing = await findExisting();
  if (existing) return { venue: existing, isNew: false };

  const insertRow = {
    id: slugify(trimmed) || key,
    name: trimmed,
    name_key: key,
    address: place.formattedAddress ?? null,
    latitude: place.latitude,
    longitude: place.longitude,
    google_place_id: place.placeId,
    created_by: userId ?? null,
  };
  const { data: created, error: insertError } = await supabase
    .from("venues")
    .insert(insertRow)
    .select(VENUE_SELECT)
    .single();
  if (!insertError) return { venue: created, isNew: true };

  // 23505 = unique violation: lost the race on name_key or google_place_id,
  // or the readable id collided with a different venue.
  if (insertError.code === "23505") {
    const raced = await findExisting();
    if (raced) return { venue: raced, isNew: false };
    const { data: retry, error: retryError } = await supabase
      .from("venues")
      .insert({ ...insertRow, id: `${slugify(trimmed)}-${key.slice(0, 6)}` })
      .select(VENUE_SELECT)
      .single();
    if (retryError) throw retryError;
    return { venue: retry, isNew: true };
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
    .select(VENUE_SELECT)
    .eq("name_key", key)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

/** Fills in a venue's address — only works while it's still blank (see
 *  migration_venue_address.sql's RLS policy: `using (address is null)`).
 *  Returns false if someone else already set it first (0 rows matched,
 *  not an error) so the caller can say so instead of silently no-oping. */
export async function setVenueAddress(
  venueId: string,
  address: string,
): Promise<boolean> {
  const trimmed = address.trim();
  if (!trimmed) throw new Error("Enter a city and state.");
  const { data, error } = await supabase
    .from("venues")
    .update({ address: trimmed })
    .eq("id", venueId)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
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
    .select(`venue_id, venues ( ${VENUE_SELECT} )`)
    .eq("user_id", userId);
  if (error) throw error;
  const venues = (data ?? [])
    .map((row: any) => row.venues as VenueOption | null)
    .filter((venue): venue is VenueOption => Boolean(venue))
    .sort((a, b) => a.name.localeCompare(b.name));
  return attachVotes(venues, userId);
}

/** Venues this user has actually tagged a dance at — distinct
 *  venue_ids from user_venue_dances, not the separate (and no longer
 *  user-facing) user_venues "added" list. This is what "My Venues"
 *  means now: derived from real reported dances, not a manually
 *  curated list. Used by the Venues page's "Danced Here" filter, My
 *  List's venue-filter dropdown, and Profile's venue milestone count. */
export async function loadDancedVenues(userId: string): Promise<VenueOption[]> {
  const { data, error } = await supabase
    .from("user_venue_dances")
    .select("venue_id")
    .eq("user_id", userId);
  if (error) throw error;
  const ids = [...new Set((data ?? []).map((r: any) => r.venue_id as string))];
  if (!ids.length) return [];
  const { data: venues, error: venuesError } = await supabase
    .from("venues")
    .select(VENUE_SELECT)
    .in("id", ids);
  if (venuesError) throw venuesError;
  const withVotes = await attachVotes((venues ?? []) as VenueOption[], userId);
  return withVotes.sort((a, b) => a.name.localeCompare(b.name));
}


/** Venues that have crossed the check-in Verified threshold — see
 *  geoCheckin.ts's VERIFIED_THRESHOLD and migration_venue_checkins.sql's
 *  venue_checkin_counts view. */
export async function loadVerifiedVenues(): Promise<VenueOption[]> {
  const { data: counts, error: countsError } = await supabase
    .from("venue_checkin_counts")
    .select("venue_id,checkin_count")
    .gte("checkin_count", VERIFIED_THRESHOLD);
  if (countsError) throw countsError;
  const ids = (counts ?? []).map((r: any) => r.venue_id as string);
  if (!ids.length) return [];
  const { data: venues, error: venuesError } = await supabase
    .from("venues")
    .select(VENUE_SELECT)
    .in("id", ids);
  if (venuesError) throw venuesError;
  return (venues ?? []) as VenueOption[];
}

// Fetches venue_checkin_counts for a set of venues and folds it in —
// same shape as attachVotes/attachNights. Also derives `locked`: true
// for a venue below VENUE_PUBLIC_THRESHOLD that the viewer can only
// see because they created it OR have it in their own user_venues
// list (the RLS policy in migration_venue_lock_user_venues.sql grants
// visibility on both grounds, not just created_by — every
// pre-existing venue has created_by = null, so user_venues is the
// only real "who brought this venue in" signal those rows have).
export async function attachCheckinCounts(
  venues: VenueOption[],
  userId?: string,
): Promise<VenueOption[]> {
  if (!venues.length) return venues;
  const ids = venues.map((v) => v.id);
  const [{ data, error }, mineResult] = await Promise.all([
    supabase.from("venue_checkin_counts").select("venue_id,checkin_count").in("venue_id", ids),
    userId
      ? supabase.from("user_venues").select("venue_id").eq("user_id", userId).in("venue_id", ids)
      : Promise.resolve({ data: [] as { venue_id: string }[], error: null }),
  ]);
  if (error) return venues.map((v) => ({ ...v, checkinCount: 0 }));
  const counts = new Map(
    (data ?? []).map((r: any) => [r.venue_id as string, r.checkin_count as number]),
  );
  const mine = new Set((mineResult.data ?? []).map((r: any) => r.venue_id as string));
  return venues.map((v) => {
    const checkinCount = counts.get(v.id) ?? 0;
    const inMyList = !!userId && (v.createdBy === userId || mine.has(v.id));
    const locked = inMyList && checkinCount < VENUE_PUBLIC_THRESHOLD;
    return { ...v, checkinCount, locked };
  });
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
    .select(`venue_id, venues ( ${VENUE_SELECT} )`)
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
