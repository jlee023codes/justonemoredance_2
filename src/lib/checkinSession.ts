import AsyncStorage from "@react-native-async-storage/async-storage";
import { Pedometer } from "expo-sensors";
import { supabase } from "./supabase";
import { haversineDistanceMeters } from "./geoCheckin";
import { VenueOption } from "../services/venues";
import { Dance } from "../types";

// How far (in meters) a user can drift from the checked-in venue
// before a session auto-ends — 0.5 miles. Foreground-only, same
// AppState-driven pattern as the proximity prompt in geoCheckin.ts —
// no background location, no "Always" permission.
export const GEOFENCE_EXIT_METERS = 804.7;

const SESSION_KEY = "jomd.active-session";

export type LoggedDance = {
  danceId: string;
  name: string;
  song: string;
  // BootStepper's own "32 count • 4 wall • ..." summary string, same
  // field DanceCard reads as dance.details — null for a dance that
  // doesn't have one.
  details: string | null;
  loggedAt: string;
  difficulty: Dance["difficulty"] | null;
  // "live" (default, logged during an active session with the device
  // present) vs "manual" (added after the fact from Stats — a
  // forgotten dance added to a past session, or part of a whole
  // backfilled night). Manual entries never have a real step count,
  // since there was no device tracking them — see LoggedDanceRow.
  source?: "live" | "manual";
  // Did THIS user actually dance it, vs. it was just logged/playing
  // (by them or by someone else in a collaborative session) — see
  // src/lib/liveSession.ts's dancedByMe. A solo/manual entry is always
  // true (logging it already implies you danced it, same as the
  // live-session auto-mark-the-logger rule). Optional only for
  // backward compatibility with history written before this field
  // existed — treat a missing value as true (the old behavior, before
  // "logged" and "danced" were distinguished at all).
  danced?: boolean;
  // First time anyone tagged this dance at this venue, as of when
  // this session started — see loadDancesAlreadyAtVenue
  // (src/services/venues.ts). Snapshotted once at endSession time,
  // same as `danced`; never recomputed later.
  newToVenue?: boolean;
  // Wasn't already in this user's My List before this session started.
  // Distinct from newToVenue — a dance can be new to the user while
  // well-known at the venue, or vice versa.
  newToUser?: boolean;
};

export type ActiveSession = {
  checkinId: string;
  venueId: string;
  venueName: string;
  venueLat: number;
  venueLon: number;
  startedAt: string;
  // Dances logged so far tonight — part of the persisted session
  // itself (not just DancingSessionScreen's local state), so closing
  // and reopening the session screen doesn't lose what's already been
  // logged. The actual venue-tag write still goes to
  // user_venue_dances via saveVenueDance; this is just the display
  // list for "tonight so far."
  loggedDances: LoggedDance[];
};

export type SessionSummary = {
  durationSeconds: number;
  danceCount: number;
  stepCount: number | null;
  // "You danced X of Y dances logged collaboratively while you were
  // there" — null when there's nothing meaningful to show (solo
  // session, or nobody else ever logged anything). See
  // src/lib/liveSession.ts's loadLivePercent, computed by the caller
  // and passed in since it needs venue/user context endSession
  // doesn't otherwise have.
  liveDancedCount: number | null;
  liveTotalCount: number | null;
};

async function persist(session: ActiveSession | null): Promise<void> {
  try {
    if (session) await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else await AsyncStorage.removeItem(SESSION_KEY);
  } catch {
    // Non-critical — worst case a kill mid-session loses resumability.
  }
}

/** Restores an in-progress session after an app restart/kill — this is
 *  what makes "phone died mid-session" recoverable: the venue and
 *  start time survive even if nothing was ever logged live. */
export async function loadActiveSession(): Promise<ActiveSession | null> {
  try {
    const raw = await AsyncStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as ActiveSession) : null;
  } catch {
    return null;
  }
}

export async function startSession(
  userId: string,
  venue: VenueOption,
  position: { latitude: number; longitude: number },
): Promise<ActiveSession> {
  const { data, error } = await supabase
    .from("venue_checkins")
    .insert({
      user_id: userId,
      venue_id: venue.id,
      latitude: position.latitude,
      longitude: position.longitude,
    })
    .select("id")
    .single();
  if (error) throw error;
  const session: ActiveSession = {
    checkinId: data.id as string,
    venueId: venue.id,
    venueName: venue.name,
    venueLat: position.latitude,
    venueLon: position.longitude,
    startedAt: new Date().toISOString(),
    loggedDances: [],
  };
  await persist(session);
  return session;
}

/** Appends a dance to the session's persisted log — call this after
 *  the actual venue-tag write (saveVenueDance) succeeds. `source`
 *  defaults to "live"; pass "manual" when adding a forgotten dance to
 *  the still-open session after the fact. */
export async function logDanceToSession(
  session: ActiveSession,
  dance: {
    id: string;
    name: string;
    defaultSong?: string;
    details?: string;
    difficulty?: Dance["difficulty"];
  },
  source: "live" | "manual" = "live",
): Promise<ActiveSession> {
  const next = {
    ...session,
    loggedDances: [
      {
        danceId: dance.id,
        name: dance.name,
        song: dance.defaultSong ?? "",
        details: dance.details ?? null,
        difficulty: dance.difficulty ?? null,
        loggedAt: new Date().toISOString(),
        source,
      },
      ...session.loggedDances,
    ],
  };
  await persist(next);
  return next;
}

/** Elapsed session time, plain wall clock from check-in to now. */
export function elapsedSeconds(session: ActiveSession): number {
  const totalMs = Date.now() - new Date(session.startedAt).getTime();
  return Math.max(0, Math.floor(totalMs / 1000));
}

/** Best-effort step count for the whole session window (wall clock,
 *  not excluding paused time — steps taken on a smoke break outside
 *  are still steps that night). Returns null on anything but a clean
 *  read: unsupported device, denied permission, API hiccup — this
 *  should never block ending a session. */
export async function queryStepCount(session: ActiveSession): Promise<number | null> {
  try {
    const available = await Pedometer.isAvailableAsync();
    if (!available) return null;
    const result = await Pedometer.getStepCountAsync(
      new Date(session.startedAt),
      new Date(),
    );
    return result.steps;
  } catch {
    return null;
  }
}

export function distanceFromVenueMeters(
  session: ActiveSession,
  position: { latitude: number; longitude: number },
): number {
  return haversineDistanceMeters(
    position.latitude,
    position.longitude,
    session.venueLat,
    session.venueLon,
  );
}

/** Closes out a session: stamps the venue_checkins row and clears the
 *  persisted active-session, whether ended manually or by the geofence.
 *  Dance count comes from `finalDances` if given (the session's own
 *  local log, by default) — `DancingSessionScreen` passes the full
 *  collaborative pool (every dance anyone logged this session, each
 *  flagged `danced` per this user's own marks) instead, so Stats shows
 *  the whole night's setlist, not just what this user personally
 *  tapped to log. `livePercent` (from loadLivePercent) is a snapshot
 *  stamped once here, not live-recomputed later, so a Stats history
 *  card stays stable even if the underlying live-session rows are
 *  ever pruned.
 *
 *  `endedAt` defaults to now — pass an earlier Date for the "forgot to
 *  end this" prompt (StaleSessionModal), where the user is backdating
 *  to when they actually left rather than ending right now. Duration
 *  is computed against this same timestamp, not Date.now(), so a
 *  backdated end doesn't inflate the session's recorded length. */
export async function endSession(
  session: ActiveSession,
  reason: "manual" | "geofence" | "stale",
  stepCount: number | null,
  livePercent?: { dancedCount: number; totalCount: number } | null,
  finalDances?: LoggedDance[],
  endedAt: Date = new Date(),
): Promise<SessionSummary> {
  const loggedDances = finalDances ?? session.loggedDances;
  const danceCount = loggedDances.length;
  const durationSeconds = Math.max(
    0,
    Math.floor((endedAt.getTime() - new Date(session.startedAt).getTime()) / 1000),
  );

  const { error } = await supabase
    .from("venue_checkins")
    .update({
      ended_at: endedAt.toISOString(),
      end_reason: reason,
      step_count: stepCount,
      logged_dances: loggedDances,
      live_danced_count: livePercent?.dancedCount ?? null,
      live_total_count: livePercent?.totalCount ?? null,
    })
    .eq("id", session.checkinId);
  if (error) throw error;

  await persist(null);
  return {
    durationSeconds,
    danceCount,
    stepCount,
    liveDancedCount: livePercent?.dancedCount ?? null,
    liveTotalCount: livePercent?.totalCount ?? null,
  };
}
