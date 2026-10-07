import { supabase } from "../lib/supabase";
import { LoggedDance } from "../lib/checkinSession";
import { Dance } from "../types";
import { VenueOption } from "./venues";

export type SessionHistoryEntry = {
  id: string;
  venueId: string;
  venueName: string;
  checkedInAt: string;
  endedAt: string;
  endReason: string | null;
  durationSeconds: number;
  dances: LoggedDance[];
  stepCount: number | null;
  // "You danced X of Y" snapshot, stamped once at session-end time —
  // null for any session from before this feature shipped, or one
  // where nobody else was ever at the venue to make the stat
  // meaningful. See src/lib/liveSession.ts.
  liveDancedCount: number | null;
  liveTotalCount: number | null;
};

/** Deletes a past session entirely — the venue_checkins row itself,
 *  plus anything that cascades from it (any session_shares link,
 *  venue_live_dances rows tied to this checkin_id). RLS already
 *  limits this to the owner's own rows ("manage own checkins" is
 *  `for all`), so no new migration is needed for this to work. */
export async function deleteSession(checkinId: string): Promise<void> {
  const { error } = await supabase.from("venue_checkins").delete().eq("id", checkinId);
  if (error) throw error;
}

/** Past, closed-out check-in sessions for this user, newest first.
 *  Two-step fetch (checkins, then venue names) rather than an embedded
 *  select — keeps each query's select string a simple literal, same
 *  reasoning as VENUE_SELECT in services/venues.ts. */
export async function loadSessionHistory(userId: string): Promise<SessionHistoryEntry[]> {
  const { data: checkins, error } = await supabase
    .from("venue_checkins")
    .select(
      "id,venue_id,checked_in_at,ended_at,end_reason,paused_seconds,step_count,logged_dances,live_danced_count,live_total_count",
    )
    .eq("user_id", userId)
    .not("ended_at", "is", null)
    .order("ended_at", { ascending: false });
  if (error) throw error;
  const rows = checkins ?? [];
  if (!rows.length) return [];

  const venueIds = [...new Set(rows.map((r: any) => r.venue_id as string))];
  const { data: venues, error: venuesError } = await supabase
    .from("venues")
    .select("id,name")
    .in("id", venueIds);
  if (venuesError) throw venuesError;
  const nameById = new Map((venues ?? []).map((v: any) => [v.id as string, v.name as string]));

  return rows.map((row: any) => {
    const startedAt = new Date(row.checked_in_at).getTime();
    const endedAt = new Date(row.ended_at).getTime();
    const durationSeconds = Math.max(
      0,
      Math.floor((endedAt - startedAt) / 1000) - (row.paused_seconds ?? 0),
    );
    return {
      id: row.id,
      venueId: row.venue_id,
      venueName: nameById.get(row.venue_id) ?? "Unknown venue",
      checkedInAt: row.checked_in_at,
      endedAt: row.ended_at,
      endReason: row.end_reason,
      durationSeconds,
      dances: (row.logged_dances ?? []) as LoggedDance[],
      stepCount: row.step_count ?? null,
      liveDancedCount: row.live_danced_count ?? null,
      liveTotalCount: row.live_total_count ?? null,
    };
  });
}

function toLoggedDance(dance: {
  id: string;
  name: string;
  defaultSong?: string;
  details?: string;
  difficulty?: Dance["difficulty"];
}): LoggedDance {
  return {
    danceId: dance.id,
    name: dance.name,
    song: dance.defaultSong ?? "",
    details: dance.details ?? null,
    difficulty: dance.difficulty ?? null,
    loggedAt: new Date().toISOString(),
    source: "manual",
  };
}

/** A whole night backfilled after the fact — no real check-in/GPS fix
 *  ever happened, so the row is inserted already closed out (ended_at
 *  set immediately) with no step count, which Stats shows as
 *  "N/A — not live tracked" rather than hiding. `end_reason:
 *  'backfilled'` is what tells Stats this session was never live, as
 *  opposed to 'manual' (a live session ended normally via Done
 *  Dancing) or 'geofence'. */
export async function createBackfilledSession(
  userId: string,
  venue: VenueOption,
  dancedOn: Date,
  dances: { id: string; name: string; defaultSong?: string; details?: string; difficulty?: Dance["difficulty"] }[],
): Promise<void> {
  const loggedDances = dances.map(toLoggedDance);
  const { error } = await supabase.from("venue_checkins").insert({
    user_id: userId,
    venue_id: venue.id,
    latitude: null,
    longitude: null,
    checked_in_at: dancedOn.toISOString(),
    ended_at: dancedOn.toISOString(),
    end_reason: "backfilled",
    step_count: null,
    logged_dances: loggedDances,
  });
  if (error) throw error;
}

/** Adds a forgotten dance to a PAST (already-ended) session — reads
 *  the row's current logged_dances and appends to it. For the
 *  currently-active session, use logDanceToSession (src/lib/checkinSession.ts)
 *  with source: "manual" instead; this is only for Stats history. */
export async function addManualDanceToSession(
  checkinId: string,
  dance: { id: string; name: string; defaultSong?: string; details?: string; difficulty?: Dance["difficulty"] },
): Promise<void> {
  const { data, error: readError } = await supabase
    .from("venue_checkins")
    .select("logged_dances")
    .eq("id", checkinId)
    .single();
  if (readError) throw readError;
  const current = ((data?.logged_dances ?? []) as LoggedDance[]);
  const next = [toLoggedDance(dance), ...current];
  const { error } = await supabase
    .from("venue_checkins")
    .update({ logged_dances: next })
    .eq("id", checkinId);
  if (error) throw error;
}

function randomToken(): string {
  // 12 chars, base36 — unguessable enough for a non-sensitive,
  // non-revocable share link; shown in a user-facing URL, so kept
  // short rather than a full uuid.
  const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";
  return Array.from({ length: 12 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
}

/** Returns the public justonemoredance.com/s/<token> link for a
 *  session, creating the token row on first share — idempotent per
 *  checkin, reuses an existing token if "Share" was already tapped
 *  once rather than minting a new link every time. Rendered by the
 *  share-session Edge Function (see supabase/functions/share-session),
 *  which reads the session with the service-role key server-side —
 *  no RLS change needed here for anonymous reads. */
export async function getOrCreateShareLink(checkinId: string): Promise<string> {
  const { data: existing } = await supabase
    .from("session_shares")
    .select("token")
    .eq("checkin_id", checkinId)
    .limit(1)
    .maybeSingle();
  if (existing?.token) return `https://justonemoredance.com/s/${existing.token}`;

  const token = randomToken();
  const { error } = await supabase.from("session_shares").insert({ token, checkin_id: checkinId });
  if (error) throw error;
  return `https://justonemoredance.com/s/${token}`;
}

/** Whether new-to-me dances from a tracked session should be added to
 *  My List automatically at session-end, instead of needing a manual
 *  visit to Stats' "New To Me" picker — default false, opt-in. See
 *  migration_auto_add_new_dances.sql. */
export async function loadAutoAddNewDances(userId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("profiles")
    .select("auto_add_new_dances")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  return data?.auto_add_new_dances === true;
}

export async function setAutoAddNewDances(userId: string, enabled: boolean): Promise<void> {
  const { error } = await supabase
    .from("profiles")
    .update({ auto_add_new_dances: enabled })
    .eq("id", userId);
  if (error) throw error;
}
