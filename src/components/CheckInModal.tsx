import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import * as Location from "expo-location";
import { colors } from "../styles";
import { NearbyPlace, searchNearby } from "../lib/placesSearch";
import { stampCooldown } from "../lib/geoCheckin";
import { ActiveSession, startSession } from "../lib/checkinSession";
import {
  findOrCreateGlobalVenue,
  findOrCreateGlobalVenueFromPlace,
  searchGlobalVenues,
  VenueOption,
} from "../services/venues";

/** Manual "📍 Check In" flow — finds real named places near the user
 *  via Google Places Nearby Search (not reverse geocoding, which only
 *  returns a street address, not a business name), lets them confirm
 *  which one they're at, and starts a tracked session there. Doubles
 *  as the bootstrap path for giving a legacy, coordinate-less venue
 *  its first real location, same as the Places-search add flow
 *  elsewhere. */
export function CheckInModal({
  userId,
  visible,
  onClose,
  onCheckedIn,
}: {
  userId: string;
  visible: boolean;
  onClose: () => void;
  onCheckedIn: (session: ActiveSession) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [position, setPosition] = useState<{ latitude: number; longitude: number } | null>(null);
  const [places, setPlaces] = useState<NearbyPlace[]>([]);
  const [checkingInId, setCheckingInId] = useState<string | null>(null);

  // Fallback "pick a venue" list — the full shared catalog (same source
  // VenuesScreen's own list uses), not just venues this user has already
  // danced at/verified. Those are the right (tighter) set for the
  // passive proximity *prompt* (see geoCheckin.ts), but too narrow for
  // a manual picker — a brand-new user with no history still needs to
  // be able to find and check into any venue in the list.
  const [venueQuery, setVenueQuery] = useState("");
  const [myVenues, setMyVenues] = useState<VenueOption[]>([]);
  const [venuesLoading, setVenuesLoading] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setError("");
    setPlaces([]);
    setPosition(null);
    setVenueQuery("");
    setLoading(true);
    (async () => {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) {
        throw new Error("Location access is needed to search nearby — enable it in Settings, or pick a venue below.");
      }
      const loc = await Location.getCurrentPositionAsync({});
      const pos = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
      setPosition(pos);
      setPlaces(await searchNearby(pos.latitude, pos.longitude));
    })()
      .catch((err: any) => setError(err?.message ?? "Could not find nearby places."))
      .finally(() => setLoading(false));
  }, [visible]);

  // Debounced — re-runs on open (empty query = top venues by votes,
  // same default VenuesScreen shows) and on every typed character.
  useEffect(() => {
    if (!visible) return;
    setVenuesLoading(true);
    const timer = setTimeout(() => {
      searchGlobalVenues(venueQuery, userId, 20)
        .then(setMyVenues)
        .catch(() => {})
        .finally(() => setVenuesLoading(false));
    }, 300);
    return () => clearTimeout(timer);
  }, [visible, venueQuery, userId]);

  const checkIntoVenue = async (id: string, create: () => Promise<VenueOption>) => {
    setCheckingInId(id);
    setError("");
    try {
      const venue = await create();
      // Prefer the real GPS fix; fall back to the venue's own
      // coordinates when checking in manually without one (nearby
      // search failed, or location access was never granted) — picking
      // a venue is itself a claim "I'm here".
      const pos = position ?? { latitude: venue.latitude, longitude: venue.longitude };
      if (pos.latitude == null || pos.longitude == null) {
        throw new Error("That venue doesn't have a location on file yet.");
      }
      const session = await startSession(userId, venue, {
        latitude: pos.latitude,
        longitude: pos.longitude,
      });
      await stampCooldown(venue.id);
      onCheckedIn(session);
      onClose();
    } catch (err: any) {
      setError(err?.message ?? "Could not check in there.");
    } finally {
      setCheckingInId(null);
    }
  };

  const handleSelectNearby = (place: NearbyPlace) =>
    checkIntoVenue(place.placeId, async () => {
      const { venue } =
        place.latitude != null && place.longitude != null
          ? await findOrCreateGlobalVenueFromPlace(
              {
                name: place.name,
                placeId: place.placeId,
                latitude: place.latitude,
                longitude: place.longitude,
                formattedAddress: place.formattedAddress,
              },
              userId,
            )
          : await findOrCreateGlobalVenue(place.name, userId);
      return venue;
    });

  const handleSelectMyVenue = (venue: VenueOption) => checkIntoVenue(venue.id, async () => venue);

  if (!visible) return null;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={s.overlay}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={s.card}>
          <Pressable style={s.closeButton} onPress={onClose} hitSlop={10}>
            <Text style={s.closeButtonText}>✕</Text>
          </Pressable>
          <Text style={s.title}>Check In</Text>
          <Text style={s.subtitle}>Which place are you at?</Text>

          <ScrollView
            contentContainerStyle={s.sheet}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
          >
            {loading && <ActivityIndicator color={colors.gold} style={s.loader} />}
            {error ? <Text style={s.error}>{error}</Text> : null}

            {!loading &&
              places.map((place) => (
                <Pressable
                  key={place.placeId}
                  style={s.placeOption}
                  onPress={() => handleSelectNearby(place)}
                  disabled={checkingInId === place.placeId}
                >
                  <View style={s.placeOptionCopy}>
                    <Text style={s.placeOptionName}>{place.name}</Text>
                    {place.formattedAddress && (
                      <Text style={s.placeOptionAddress} numberOfLines={1}>
                        {place.formattedAddress}
                      </Text>
                    )}
                  </View>
                  {checkingInId === place.placeId && (
                    <ActivityIndicator color={colors.gold} size="small" />
                  )}
                </Pressable>
              ))}
            {!loading && !places.length && (
              <Text style={s.empty}>No places found nearby.</Text>
            )}

            <Text style={s.sectionLabel}>OR PICK A VENUE</Text>
            <TextInput
              value={venueQuery}
              onChangeText={setVenueQuery}
              placeholder="Search venues"
              placeholderTextColor={colors.muted}
              style={s.venueSearch}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {venuesLoading && !myVenues.length && (
              <ActivityIndicator color={colors.gold} style={s.loader} />
            )}
            {myVenues.map((venue) => (
              <Pressable
                key={venue.id}
                style={s.placeOption}
                onPress={() => handleSelectMyVenue(venue)}
                disabled={checkingInId === venue.id}
              >
                <View style={s.placeOptionCopy}>
                  <Text style={s.placeOptionName}>{venue.name}</Text>
                  {venue.address && (
                    <Text style={s.placeOptionAddress} numberOfLines={1}>
                      {venue.address}
                    </Text>
                  )}
                </View>
                {checkingInId === venue.id && (
                  <ActivityIndicator color={colors.gold} size="small" />
                )}
              </Pressable>
            ))}
            {!venuesLoading && !myVenues.length && (
              <Text style={s.empty}>No venues match your search.</Text>
            )}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "#000000aa",
    justifyContent: "center",
    padding: 20,
  },
  card: {
    backgroundColor: "#2b1f35",
    borderRadius: 28,
    maxHeight: "80%",
    paddingTop: 25,
  },
  closeButton: {
    position: "absolute",
    top: 14,
    right: 14,
    zIndex: 10,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#00000055",
    alignItems: "center",
    justifyContent: "center",
  },
  closeButtonText: { color: colors.ink, fontSize: 15, fontWeight: "800" },
  title: { color: colors.ink, fontSize: 23, fontWeight: "900", paddingHorizontal: 25, paddingRight: 46 },
  subtitle: { color: colors.muted, fontSize: 12, marginTop: 4, paddingHorizontal: 25, marginBottom: 10 },
  sheet: { paddingHorizontal: 25, paddingBottom: 30 },
  loader: { marginTop: 20 },
  sectionLabel: {
    color: colors.gold,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.2,
    marginTop: 18,
    marginBottom: 4,
  },
  venueSearch: {
    backgroundColor: "#00000033",
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    color: colors.ink,
    padding: 11,
    fontSize: 14,
    marginBottom: 6,
  },
  placeOption: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  placeOptionCopy: { flex: 1, paddingRight: 10 },
  placeOptionName: { color: colors.ink, fontSize: 15, fontWeight: "700" },
  placeOptionAddress: { color: colors.muted, fontSize: 12, marginTop: 2 },
  empty: { color: colors.muted, fontSize: 14, marginTop: 10, lineHeight: 20 },
  error: { color: "#ff8080", fontSize: 13, marginTop: 10, lineHeight: 18 },
});
