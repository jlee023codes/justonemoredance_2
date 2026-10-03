import { Platform } from "react-native";
import { openExternalLink } from "./openExternalLink";

// "Get Directions" on a venue — the visible query is always the
// venue's name (plus address when known), so Maps shows the actual
// venue name as the pin label. Coordinates and Google's own place id
// (from Google Places, see venues.ts's findOrCreateGlobalVenueFromPlace)
// are passed alongside only as location hints, so Maps still lands
// precisely on the right building — passing raw "lat,lng" as the query
// itself (the old behavior here) made Maps show the coordinates as the
// label instead of the venue's name.
// Apple Maps on native iOS (the OS's own integration); Google Maps' web
// URL everywhere else (Android, and web regardless of the visitor's own
// device) — both are plain URLs, no SDK needed either way.
export function openDirections(venue: {
  name: string;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  googlePlaceId?: string | null;
}): Promise<void> {
  const hasCoords = venue.latitude != null && venue.longitude != null;
  if (!hasCoords && !venue.address) return Promise.resolve();

  const label = venue.address ? `${venue.name}, ${venue.address}` : venue.name;

  if (Platform.OS === "ios") {
    // `near` biases Apple's name search toward the real coordinates
    // without replacing the visible query (unlike `ll`, which drops a
    // pin with no name label at all).
    const url = hasCoords
      ? `https://maps.apple.com/?q=${encodeURIComponent(label)}&near=${venue.latitude},${venue.longitude}`
      : `https://maps.apple.com/?q=${encodeURIComponent(label)}`;
    return openExternalLink(url);
  }

  // `query_place_id` is Google's documented way to pin exactly on a
  // known place while still showing its name as the label.
  const params = new URLSearchParams({ query: label });
  if (venue.googlePlaceId) params.set("query_place_id", venue.googlePlaceId);
  return openExternalLink(
    `https://www.google.com/maps/search/?api=1&${params.toString()}`,
  );
}
