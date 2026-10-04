import * as Crypto from "expo-crypto";
import { invokeEdgeFunction } from "./edgeFunctions";

// Thin client for supabase/functions/places-proxy — mirrors
// bootstepper.ts/youtubeSync.ts's shape. Used by VenuePicker for venue
// search autocomplete.

export type PlaceSuggestion = { placeId: string; description: string };

export function newSessionToken(): string {
  return Crypto.randomUUID();
}

export async function searchPlaces(
  input: string,
  sessionToken: string,
): Promise<PlaceSuggestion[]> {
  const result = await invokeEdgeFunction<{ suggestions: PlaceSuggestion[] }>(
    "places-proxy",
    { action: "autocomplete", input, sessionToken },
  );
  return result.suggestions;
}

export type PlaceDetails = {
  name: string;
  formattedAddress: string | null;
  latitude: number | null;
  longitude: number | null;
};

export async function getPlaceDetails(
  placeId: string,
  sessionToken: string,
): Promise<PlaceDetails> {
  return invokeEdgeFunction<PlaceDetails>("places-proxy", {
    action: "place-details",
    placeId,
    sessionToken,
  });
}

export type NearbyPlace = {
  placeId: string;
  name: string;
  formattedAddress: string | null;
  latitude: number | null;
  longitude: number | null;
};

/** Real named businesses near a GPS point — backs the check-in flow's
 *  "is this the place?" confirmation. No session token: unlike
 *  autocomplete/place-details, this isn't part of a type-to-select
 *  sequence, so there's no multi-request session to bill as one. */
export async function searchNearby(
  latitude: number,
  longitude: number,
): Promise<NearbyPlace[]> {
  const result = await invokeEdgeFunction<{ places: NearbyPlace[] }>("places-proxy", {
    action: "nearby",
    latitude,
    longitude,
  });
  return result.places;
}
