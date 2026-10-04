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
 *  the actual venue-tag write (saveVenueDance) succeeds. */
export async function logDanceToSession(
  session: ActiveSession,
  dance: {
    id: string;
    name: string;
    defaultSong?: string;
    details?: string;
    difficulty?: Dance["difficulty"];
  },
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
 *  Dance count comes from the session's own persisted log, not a
 *  caller-supplied number — it's always accurate even if the session
 *  screen was closed and reopened since the last dance was logged. */
export async function endSession(
  session: ActiveSession,
  reason: "manual" | "geofence",
  stepCount: number | null,
): Promise<SessionSummary> {
  const danceCount = session.loggedDances.length;
  const durationSeconds = elapsedSeconds(session);

  const { error } = await supabase
    .from("venue_checkins")
    .update({
      ended_at: new Date().toISOString(),
      end_reason: reason,
      step_count: stepCount,
      logged_dances: session.loggedDances,
    })
    .eq("id", session.checkinId);
  if (error) throw error;

  await persist(null);
  return { durationSeconds, danceCount, stepCount };
}
