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
