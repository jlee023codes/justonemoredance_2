import { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import { Dance } from "../types";

// Collaborative live dance pool, shared by everyone currently checked
// in (ended_at is null) at the same venue — automatic the moment you
// check in, no separate "join" step. See migration_venue_live_sessions.sql
// for the tables/RLS/Realtime wiring. Additive to the existing
// per-user venue_checkins.logged_dances jsonb — that path is
// untouched, this is a second, incrementally-written, shared log.

export type LiveDance = {
  id: string;
  danceId: string;
  name: string;
  song: string | null;
  details: string | null;
  difficulty: Dance["difficulty"] | null;
  loggedBy: string;
  loggedByName: string;
  loggedAt: string;
  dancedByMe: boolean;
  dancedCount: number;
};

export type LiveParticipant = {
  userId: string;
  name: string;
  avatarUrl: string | null;
};

function labelFor(profile: { display_name: string | null; username: string | null }): string {
  return profile.display_name?.trim() || (profile.username ? `@${profile.username}` : "Someone");
}

/** One venue_live_presence fetch, shared by loadLiveSessionState below
 *  for both the participant roster and the session window start — this
 *  used to be two entirely separate query chains (loadLiveParticipants'
 *  own presence -> profiles lookup, plus a second presence-only lookup
 *  just to find the window start), run alongside loadLiveDances' own
 *  3-step sequential chain (presence -> dances -> marks/profiles) —
 *  together the main cause of a slow open/reopen on the session
 *  screen. */
async function loadPresence(
  venueId: string,
  fallbackWindowStart: string,
): Promise<{ participants: LiveParticipant[]; windowStart: string }> {
  const { data: presence, error } = await supabase
    .from("venue_live_presence")
    .select("user_id, checked_in_at")
    .eq("venue_id", venueId)
    .order("checked_in_at", { ascending: true });
  if (error) throw error;
  const rows = presence ?? [];
  const windowStart = rows[0]?.checked_in_at ?? fallbackWindowStart;
  const userIds = [...new Set(rows.map((r: any) => r.user_id as string))];
  if (!userIds.length) return { participants: [], windowStart };

  const { data: profiles, error: profilesError } = await supabase
    .from("profiles")
    .select("id, username, display_name, avatar_url")
    .in("id", userIds);
  if (profilesError) throw profilesError;

  const participants = (profiles ?? []).map((p: any) => ({
    userId: p.id,
    name: labelFor(p),
    avatarUrl: p.avatar_url ?? null,
  }));
  return { participants, windowStart };
}

/** Participants + the shared dance pool, in one go — see loadPresence.
 *  Replaces separately calling loadLiveParticipants and loadLiveDances
 *  back to back (they both independently queried venue_live_presence
 *  and venue_live_dance_marks/profiles-adjacent data); this cuts the
 *  session screen's open/reopen refresh from ~6 round-trips (3 of them
 *  sequential) down to 3 (2 sequential). */
export async function loadLiveSessionState(
  venueId: string,
  myUserId: string,
  checkedInAt: string,
): Promise<{ dances: LiveDance[]; participants: LiveParticipant[] }> {
  const { participants, windowStart } = await loadPresence(venueId, checkedInAt);

  const { data: rows, error } = await supabase
    .from("venue_live_dances")
    .select("id, dance_id, dance_name, dance_song, dance_difficulty, dance_details, logged_by, logged_at")
    .eq("venue_id", venueId)
    .gte("logged_at", windowStart)
    .order("logged_at", { ascending: false });
  if (error) throw error;
  const rawDances = rows ?? [];
  if (!rawDances.length) return { dances: [], participants };

  const liveDanceIds = rawDances.map((d: any) => d.id as string);
  const loggerIds = [...new Set(rawDances.map((d: any) => d.logged_by as string))];
  const knownNames = new Map(participants.map((p) => [p.userId, p.name]));
  // Only fetch profiles for loggers NOT already covered by this venue's
  // current participant list (the common case: whoever logged a dance
  // is still checked in) — participants' names are already in hand
  // from loadPresence above, no need to ask for them twice.
  const unknownLoggerIds = loggerIds.filter((id) => !knownNames.has(id));

  const [{ data: marks, error: marksError }, profilesResult] = await Promise.all([
    supabase.from("venue_live_dance_marks").select("live_dance_id, user_id").in("live_dance_id", liveDanceIds),
    unknownLoggerIds.length
      ? supabase.from("profiles").select("id, username, display_name").in("id", unknownLoggerIds)
      : Promise.resolve({ data: [] as any[], error: null }),
  ]);
  if (marksError) throw marksError;
  if (profilesResult.error) throw profilesResult.error;

  const nameById = new Map(knownNames);
  for (const p of (profilesResult.data ?? []) as any[]) {
    nameById.set(p.id, labelFor(p));
  }
  const marksByDance = new Map<string, Set<string>>();
  for (const m of (marks ?? []) as any[]) {
    const set = marksByDance.get(m.live_dance_id) ?? new Set<string>();
    set.add(m.user_id);
    marksByDance.set(m.live_dance_id, set);
  }

  const dances = rawDances.map((d: any) => {
    const markedBy = marksByDance.get(d.id) ?? new Set<string>();
    return {
      id: d.id,
      danceId: d.dance_id,
      name: d.dance_name,
      song: d.dance_song ?? null,
      details: d.dance_details ?? null,
      difficulty: (d.dance_difficulty ?? null) as Dance["difficulty"] | null,
      loggedBy: d.logged_by,
      loggedByName: nameById.get(d.logged_by) ?? "Someone",
      loggedAt: d.logged_at,
      dancedByMe: markedBy.has(myUserId),
      dancedCount: markedBy.size,
    };
  });
  return { dances, participants };
}

/** The start of the CURRENT ongoing session at this venue — the
 *  earliest checked_in_at among everyone still actively checked in
 *  (ended_at is null) right now, not just this one caller's own
 *  check-in time. This is what lets a user who joins partway through
 *  a group's night see everything logged before they arrived, while
 *  still correctly excluding an earlier, already-ended, separate
 *  night at the same venue (venue_live_dances is append-only and
 *  never cleared between sessions — once everyone currently there
 *  ends their session, this naturally resets for whoever checks in
 *  next). Falls back to `fallback` (the caller's own checked_in_at)
 *  if the presence query fails or — in a genuine race, someone's row
 *  disappearing between calls — comes back empty. */
async function loadSessionWindowStart(venueId: string, fallback: string): Promise<string> {
  const { data, error } = await supabase
    .from("venue_live_presence")
    .select("checked_in_at")
    .eq("venue_id", venueId)
    .order("checked_in_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error || !data) return fallback;
  return data.checked_in_at as string;
}

/** Logs a dance into the shared pool and auto-marks the logger as
 *  having danced it — logging already implies you danced it, same as
 *  the solo flow today where logging = counted, no separate tap
 *  needed for your own entries. */
export async function logLiveDance(
  checkinId: string,
  venueId: string,
  dance: Dance,
  userId: string,
): Promise<void> {
  const { data, error } = await supabase
    .from("venue_live_dances")
    .insert({
      venue_id: venueId,
      checkin_id: checkinId,
      logged_by: userId,
      dance_id: dance.id,
      dance_name: dance.name,
      dance_song: dance.defaultSong ?? null,
      dance_difficulty: dance.difficulty ?? null,
      dance_details: dance.details || null,
    })
    .select("id")
    .single();
  if (error) throw error;

  const { error: markError } = await supabase
    .from("venue_live_dance_marks")
    .insert({ live_dance_id: data.id, venue_id: venueId, user_id: userId });
  if (markError) throw markError;
}

/** Toggles the caller's own "danced this" mark on someone's (or
 *  their own) logged dance. */
export async function toggleDanced(
  liveDanceId: string,
  venueId: string,
  userId: string,
  currentlyMarked: boolean,
): Promise<void> {
  if (currentlyMarked) {
    const { error } = await supabase
      .from("venue_live_dance_marks")
      .delete()
      .eq("live_dance_id", liveDanceId)
      .eq("user_id", userId);
    if (error) throw error;
  } else {
    const { error } = await supabase
      .from("venue_live_dance_marks")
      .insert({ live_dance_id: liveDanceId, venue_id: venueId, user_id: userId });
    if (error) throw error;
  }
}

export type LivePercent = { dancedCount: number; totalCount: number } | null;

/** "You danced X of Y dances logged" — scoped to the whole ongoing
 *  session (see loadSessionWindowStart), same window as
 *  loadLiveDances, not just since this caller's own check-in: a late
 *  joiner sees (and is scored against) the full night's list so far,
 *  not just what happened after they arrived. Returns null when
 *  nothing meaningful to show (solo session, nobody else ever logged
 *  anything). */
export async function loadLivePercent(
  venueId: string,
  myUserId: string,
  checkedInAt: string,
  endedAt: string,
): Promise<LivePercent> {
  const windowStart = await loadSessionWindowStart(venueId, checkedInAt);
  const { data: rows, error } = await supabase
    .from("venue_live_dances")
    .select("id, logged_by")
    .eq("venue_id", venueId)
    .gte("logged_at", windowStart)
    .lte("logged_at", endedAt);
  if (error) throw error;
  const dances = rows ?? [];
  const distinctLoggers = new Set(dances.map((d: any) => d.logged_by as string));
  if (dances.length <= 1 || distinctLoggers.size <= 1) return null;

  const liveDanceIds = dances.map((d: any) => d.id as string);
  const { data: marks, error: marksError } = await supabase
    .from("venue_live_dance_marks")
    .select("live_dance_id")
    .eq("user_id", myUserId)
    .in("live_dance_id", liveDanceIds);
  if (marksError) throw marksError;

  return { dancedCount: (marks ?? []).length, totalCount: dances.length };
}

/** Subscribes to live changes for a venue's shared pool — any insert
 *  on venue_live_dances or any change on venue_live_dance_marks
 *  triggers a debounced refetch via onChange, rather than hand-patching
 *  a local cache. Call the returned function to unsubscribe (e.g. on
 *  unmount). First use of Supabase Realtime in this app. */
export function subscribeLiveSession(venueId: string, onChange: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const debounced = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(onChange, 400);
  };

  let channel: RealtimeChannel | null = supabase
    .channel(`venue-live:${venueId}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "venue_live_dances", filter: `venue_id=eq.${venueId}` },
      debounced,
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "venue_live_dance_marks", filter: `venue_id=eq.${venueId}` },
      debounced,
    )
    .subscribe();

  return () => {
    if (timer) clearTimeout(timer);
    if (channel) {
      supabase.removeChannel(channel);
      channel = null;
    }
  };
}
