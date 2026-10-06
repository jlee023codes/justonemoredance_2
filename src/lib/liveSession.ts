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

/** Everyone currently checked in (ended_at is null) at this venue —
 *  the live pool's roster. Degenerates to a single-entry array for a
 *  solo session, same data shape either way. */
export async function loadLiveParticipants(venueId: string): Promise<LiveParticipant[]> {
  const { data: presence, error } = await supabase
    .from("venue_live_presence")
    .select("user_id")
    .eq("venue_id", venueId);
  if (error) throw error;
  const userIds = [...new Set((presence ?? []).map((r: any) => r.user_id as string))];
  if (!userIds.length) return [];

  const { data: profiles, error: profilesError } = await supabase
    .from("profiles")
    .select("id, username, display_name, avatar_url")
    .in("id", userIds);
  if (profilesError) throw profilesError;

  return (profiles ?? []).map((p: any) => ({
    userId: p.id,
    name: labelFor(p),
    avatarUrl: p.avatar_url ?? null,
  }));
}

/** The shared dance pool for this venue, with each dance's logger
 *  name, whether the caller has marked it "danced," and how many
 *  people in total have. Scoped to dances logged since `checkedInAt`
 *  — venue_live_dances is append-only and never cleared between
 *  sessions, so without this a second check-in at the same venue
 *  later the same day would show every dance from the earlier,
 *  already-ended session too (same reasoning as loadLivePercent's
 *  identical gte filter). */
export async function loadLiveDances(
  venueId: string,
  myUserId: string,
  checkedInAt: string,
): Promise<LiveDance[]> {
  const { data: rows, error } = await supabase
    .from("venue_live_dances")
    .select("id, dance_id, dance_name, dance_song, dance_difficulty, dance_details, logged_by, logged_at")
    .eq("venue_id", venueId)
    .gte("logged_at", checkedInAt)
    .order("logged_at", { ascending: false });
  if (error) throw error;
  const dances = rows ?? [];
  if (!dances.length) return [];

  const liveDanceIds = dances.map((d: any) => d.id as string);
  const loggerIds = [...new Set(dances.map((d: any) => d.logged_by as string))];

  const [{ data: marks, error: marksError }, { data: profiles, error: profilesError }] = await Promise.all([
    supabase.from("venue_live_dance_marks").select("live_dance_id, user_id").in("live_dance_id", liveDanceIds),
    supabase.from("profiles").select("id, username, display_name").in("id", loggerIds),
  ]);
  if (marksError) throw marksError;
  if (profilesError) throw profilesError;

  const nameById = new Map((profiles ?? []).map((p: any) => [p.id as string, labelFor(p)]));
  const marksByDance = new Map<string, Set<string>>();
  for (const m of (marks ?? []) as any[]) {
    const set = marksByDance.get(m.live_dance_id) ?? new Set<string>();
    set.add(m.user_id);
    marksByDance.set(m.live_dance_id, set);
  }

  return dances.map((d: any) => {
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

/** "You danced X of Y dances logged while you were there" — scoped to
 *  THIS user's own check-in window (not the whole night), per the
 *  confirmed design: a late arrival isn't asked about dances logged
 *  before they showed up. Returns null when nothing meaningful to
 *  show (solo session, nobody else ever logged anything). */
export async function loadLivePercent(
  venueId: string,
  myUserId: string,
  checkedInAt: string,
  endedAt: string,
): Promise<LivePercent> {
  const { data: rows, error } = await supabase
    .from("venue_live_dances")
    .select("id, logged_by")
    .eq("venue_id", venueId)
    .gte("logged_at", checkedInAt)
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
