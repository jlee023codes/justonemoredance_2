import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "./supabase";
import {
  loadDancedVenues,
  loadVerifiedVenues,
  VenueOption,
} from "../services/venues";

// How close (in meters) a GPS fix has to be to a candidate venue to
// prompt a check-in. Matches the radius the places-proxy `nearby`
// action searches server-side (see supabase/functions/places-proxy).
export const PROXIMITY_METERS = 150;

// "Near Me" radius for the Venues tab's distance filter — 30 miles.
export const NEAR_ME_METERS = 30 * 1609.34;

const COOLDOWN_KEY = "jomd.checkin-cooldowns";
const COOLDOWN_MS = 4 * 60 * 60 * 1000; // 4 hours

/** Great-circle distance between two points, in meters. */
export function haversineDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Venues worth proximity-prompting for — venues you've danced at, or
 *  that have crossed the Verified threshold in the shared catalog. Not
 *  a blanket "near any venue anywhere" prompt. */
export async function loadCheckinCandidates(userId: string): Promise<VenueOption[]> {
  const [danced, verified] = await Promise.all([
    loadDancedVenues(userId),
    loadVerifiedVenues(),
  ]);
  const byId = new Map<string, VenueOption>();
  for (const v of [...danced, ...verified]) {
    if (v.latitude != null && v.longitude != null) byId.set(v.id, v);
  }
  return [...byId.values()];
}

/** The nearest candidate within PROXIMITY_METERS, or null. */
export function findNearestCandidate(
  position: { latitude: number; longitude: number },
  candidates: VenueOption[],
): VenueOption | null {
  let nearest: VenueOption | null = null;
  let nearestDistance = Infinity;
  for (const v of candidates) {
    if (v.latitude == null || v.longitude == null) continue;
    const distance = haversineDistanceMeters(
      position.latitude,
      position.longitude,
      v.latitude,
      v.longitude,
    );
    if (distance <= PROXIMITY_METERS && distance < nearestDistance) {
      nearest = v;
      nearestDistance = distance;
    }
  }
  return nearest;
}

async function loadCooldowns(): Promise<Record<string, string>> {
  try {
    const raw = await AsyncStorage.getItem(COOLDOWN_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export async function isOnCooldown(venueId: string): Promise<boolean> {
  const cooldowns = await loadCooldowns();
  const stamped = cooldowns[venueId];
  if (!stamped) return false;
  return Date.now() - new Date(stamped).getTime() < COOLDOWN_MS;
}

/** Stamps a venue's cooldown — called whether the prompt was accepted
 *  or declined, so either way it won't re-ask again right away. */
export async function stampCooldown(venueId: string): Promise<void> {
  try {
    const cooldowns = await loadCooldowns();
    cooldowns[venueId] = new Date().toISOString();
    await AsyncStorage.setItem(COOLDOWN_KEY, JSON.stringify(cooldowns));
  } catch {
    // Non-critical — worst case it prompts again sooner than ideal.
  }
}

/** Records a check-in at a venue. */
export async function createCheckin(
  userId: string,
  venueId: string,
  latitude: number,
  longitude: number,
): Promise<void> {
  const { error } = await supabase
    .from("venue_checkins")
    .insert({ user_id: userId, venue_id: venueId, latitude, longitude });
  if (error) throw error;
}
