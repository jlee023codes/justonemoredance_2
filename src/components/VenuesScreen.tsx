import { Ref, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import * as Location from "expo-location";
import { Dance, DanceProgress } from "../types";
import { colors } from "../styles";
import { Tier } from "../lib/tier";
import { haversineDistanceMeters, NEAR_ME_METERS } from "../lib/geoCheckin";
import { QuickStatus } from "./DanceCard";
import { BackToTopHandle, BackToTopScrollView } from "./BackToTopScrollView";
import { VenueCard } from "./VenueCard";
import { VenueDancesModal } from "./VenueDancesModal";
import { VenueRevisionModal } from "./VenueRevisionModal";
import { VenueScheduleModal } from "./VenueScheduleModal";
import { DayFilterModal } from "./DayFilterModal";
import { SearchInput } from "./SearchInput";
import { getPlaceDetails, newSessionToken, PlaceSuggestion, searchPlaces } from "../lib/placesSearch";
import {
  attachPublicCounts,
  attachNights,
  attachRepStatus,
  DAY_LABEL,
  DayOfWeek,
  findOrCreateGlobalVenue,
  findOrCreateGlobalVenueFromPlace,
  homeFirst,
  isUserAdmin,
  loadDancedVenues,
  loadHomeVenueId,
  searchGlobalVenues,
  VenueOption,
} from "../services/venues";

const DEFAULT_LIMIT = 20;
// When "Near Me" is on, fetch the whole catalog rather than just the
// top-N-by-votes — searchGlobalVenues("") already skips a DB-level cap
// and only slices to `limit` at the very end, so bumping limit this
// high is enough to see every venue for distance filtering, not just
// the usual page.
const NEAR_ME_FETCH_LIMIT = 2000;

/** Browse every venue in the shared catalog as a scrollable list of
 *  cards — name/address, directions, line dancing nights, cover + age,
 *  and a "What's Playing" button opening the dances reported there.
 *  Free for everyone; free accounts just see a capped dance list per
 *  venue (see VenueDancesModal). The search bar doubles as "add a
 *  venue" — when a search doesn't match anything locally, Google
 *  results appear inline instead of a separate picker. */
export function VenuesScreen({
  userId,
  tier,
  progress,
  catalogCache,
  onOpenDance,
  onQuickStatusAtVenue,
  onCacheDances,
  refreshKey,
  scrollRef,
}: {
  userId: string;
  tier: Tier;
  progress: Record<string, DanceProgress>;
  catalogCache: Record<string, Dance>;
  onOpenDance: (dance: Dance) => void;
  // Setting a status here also ties the dance to the venue you found it
  // at — the parent handles both writes (see App.tsx).
  onQuickStatusAtVenue: (
    dance: Dance,
    status: QuickStatus,
    venueId: string,
  ) => void;
  onCacheDances: (dances: Dance[]) => void;
  // Bumped by the parent whenever a venue tie changes elsewhere, so
  // whichever "What's Playing" modal is open stays current.
  refreshKey: number;
  scrollRef?: Ref<BackToTopHandle>;
}) {
  const [homeVenueId, setHomeVenueId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [query, setQuery] = useState("");
  const [dayFilters, setDayFilters] = useState<DayOfWeek[]>([]);
  const [dayFilterOpen, setDayFilterOpen] = useState(false);
  const [dancedOnly, setDancedOnly] = useState(false);
  const [dancedVenueIds, setDancedVenueIds] = useState<Set<string>>(new Set());
  const [nearMeOnly, setNearMeOnly] = useState(false);
  const [nearMePosition, setNearMePosition] = useState<{ latitude: number; longitude: number } | null>(null);
  const [nearMeLoading, setNearMeLoading] = useState(false);
  const [limit, setLimit] = useState(DEFAULT_LIMIT);
  const [results, setResults] = useState<VenueOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [dancesVenue, setDancesVenue] = useState<VenueOption | null>(null);
  const [scheduleVenue, setScheduleVenue] = useState<VenueOption | null>(null);
  const [notifyModal, setNotifyModal] = useState<
    { venue: VenueOption; kind: "revision" | "rep_request" } | null
  >(null);

  // Inline "add via Google" — same pieces as VenuePicker.tsx, ported
  // here so the main search bar doubles as the add flow instead of
  // opening a separate modal.
  const [placeSuggestions, setPlaceSuggestions] = useState<PlaceSuggestion[]>([]);
  const [placesLoading, setPlacesLoading] = useState(false);
  const [placesError, setPlacesError] = useState("");
  const [addingPlaceId, setAddingPlaceId] = useState<string | null>(null);
  const [addingFreeText, setAddingFreeText] = useState(false);
  const sessionToken = useRef(newSessionToken());

  useEffect(() => {
    loadHomeVenueId(userId).then(setHomeVenueId).catch(() => {});
    isUserAdmin(userId).then(setIsAdmin).catch(() => {});
    loadDancedVenues(userId)
      .then((venues) => setDancedVenueIds(new Set(venues.map((v) => v.id))))
      .catch(() => {});
  }, [userId, refreshKey]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    const effectiveLimit = nearMeOnly ? NEAR_ME_FETCH_LIMIT : limit;
    const timer = setTimeout(() => {
      searchGlobalVenues(query, userId, effectiveLimit, dayFilters)
        .then((venues) => attachRepStatus(venues, userId, isAdmin))
        .then((venues) => {
          if (!cancelled) setResults(venues);
        })
        .catch((err: any) => {
          if (!cancelled) setError(err?.message ?? "Could not load venues.");
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // dayFilters.join(",") rather than the array itself — a new array
    // reference every render would otherwise re-fire this effect even
    // when the actual selected days haven't changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, limit, dayFilters.join(","), userId, isAdmin, nearMeOnly]);

  // Independent of the local search above — kicked off in parallel so
  // there's no extra delay once local comes back empty. Only shown
  // (below) once local results are actually empty for this query.
  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setPlaceSuggestions([]);
      setPlacesError("");
      return;
    }
    let cancelled = false;
    setPlacesLoading(true);
    setPlacesError("");
    const timer = setTimeout(() => {
      searchPlaces(trimmed, sessionToken.current)
        .then((suggestions) => {
          if (!cancelled) setPlaceSuggestions(suggestions);
        })
        .catch((err: any) => {
          if (cancelled) return;
          setPlaceSuggestions([]);
          // Previously swallowed entirely — a Places lookup failure
          // (bad/expired key, quota, auth) looked identical to "no
          // results," with no way to tell them apart. Surface it.
          setPlacesError(err?.message ?? "Could not search Google Maps.");
        })
        .finally(() => {
          if (!cancelled) setPlacesLoading(false);
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  const handleQueryChange = (text: string) => {
    setQuery(text);
    setLimit(DEFAULT_LIMIT);
  };

  const handleDayFiltersChange = (next: DayOfWeek[]) => {
    setDayFilters(next);
    setLimit(DEFAULT_LIMIT);
  };

  const handleToggleNearMe = async () => {
    if (nearMeOnly) {
      setNearMeOnly(false);
      return;
    }
    setNearMeLoading(true);
    setError("");
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) {
        throw new Error("Location access is needed to find venues near you — enable it in Settings.");
      }
      const loc = await Location.getCurrentPositionAsync({});
      setNearMePosition({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
      setNearMeOnly(true);
    } catch (err: any) {
      setError(err?.message ?? "Could not get your location.");
    } finally {
      setNearMeLoading(false);
    }
  };

  const setNightsLocally = (venueId: string, nights: { day: DayOfWeek; details: string }[]) => {
    setResults((prev) => prev.map((v) => (v.id === venueId ? { ...v, nights } : v)));
  };

  const markRepRequested = (venueId: string) => {
    setResults((prev) =>
      prev.map((v) => (v.id === venueId ? { ...v, repStatus: "pending" } : v)),
    );
  };

  // Enriches and merges a just-found/created venue into the visible
  // list, prompting for a starting schedule if it's genuinely new.
  const mergeVenue = (venue: VenueOption, isNew: boolean) => {
    attachNights([venue])
      .then((withNights) => attachRepStatus(withNights, userId, isAdmin))
      .then((withRep) => attachPublicCounts(withRep, userId))
      .then(([enriched]) => {
        setResults((prev) =>
          prev.some((v) => v.id === enriched.id)
            ? prev.map((v) => (v.id === enriched.id ? enriched : v))
            : [enriched, ...prev],
        );
        if (isNew) setScheduleVenue(enriched);
      });
  };

  const handleSelectPlace = async (suggestion: PlaceSuggestion) => {
    setAddingPlaceId(suggestion.placeId);
    setError("");
    try {
      const details = await getPlaceDetails(suggestion.placeId, sessionToken.current);
      sessionToken.current = newSessionToken();
      const name = details.name || suggestion.description;
      const { venue, isNew } =
        details.latitude != null && details.longitude != null
          ? await findOrCreateGlobalVenueFromPlace(
              {
                name,
                placeId: suggestion.placeId,
                latitude: details.latitude,
                longitude: details.longitude,
                formattedAddress: details.formattedAddress,
              },
              userId,
            )
          : await findOrCreateGlobalVenue(name, userId);
      mergeVenue(venue, isNew);
      setQuery("");
      setPlaceSuggestions([]);
    } catch (err: any) {
      setError(err.message ?? "Could not add that venue.");
    } finally {
      setAddingPlaceId(null);
    }
  };

  const handleAddFreeText = async () => {
    const trimmed = query.trim();
    if (!trimmed) return;
    setAddingFreeText(true);
    setError("");
    try {
      const { venue, isNew } = await findOrCreateGlobalVenue(trimmed, userId);
      mergeVenue(venue, isNew);
      setQuery("");
      setPlaceSuggestions([]);
    } catch (err: any) {
      setError(err.message ?? "Could not add that venue.");
    } finally {
      setAddingFreeText(false);
    }
  };

  // Near Me: keep only venues with coords within NEAR_ME_METERS, and
  // sort nearest-first — distance beats the usual votes-then-name
  // ranking while this filter's active, same way day/danced narrow
  // the list without changing how it's fetched.
  const withDistance = nearMeOnly && nearMePosition
    ? results
        .map((v) => ({
          venue: v,
          distance:
            v.latitude != null && v.longitude != null
              ? haversineDistanceMeters(nearMePosition.latitude, nearMePosition.longitude, v.latitude, v.longitude)
              : null,
        }))
        .filter((r) => r.distance != null && r.distance <= NEAR_ME_METERS)
        .sort((a, b) => a.distance! - b.distance!)
        .map((r) => r.venue)
    : results;

  const ordered = homeFirst(withDistance, homeVenueId).filter(
    (v) => !dancedOnly || dancedVenueIds.has(v.id),
  );
  const initialLoading = loading && !results.length;
  const trimmedQuery = query.trim();
  const showGoogleResults = trimmedQuery.length > 0 && !loading && results.length === 0;

  // dancedOnly/nearMeOnly filter client-side after the fetch, so "no
  // matches" can mean either "nothing in the DB" (results empty) or
  // "nothing matching the filter among what's there" (results
  // non-empty, ordered empty) — worth distinguishing so the message is
  // actually useful.
  let emptyMessage: string | null = null;
  if (!ordered.length) {
    if (nearMeOnly) {
      emptyMessage = "No reported line dancing bars within 30 miles of you yet.";
    } else if (dancedOnly) {
      emptyMessage = trimmedQuery
        ? `No danced venues match "${query}".`
        : "Nowhere yet — tag a dance to a venue to see it here.";
    } else if (!trimmedQuery) {
      emptyMessage = dayFilters.length
        ? `No venues have ${dayFilters.map((d) => DAY_LABEL[d]).join("/")} dancing reported yet.`
        : "No venues yet — be the first to add one.";
    }
    // else: a search with zero local matches falls through to the
    // Google results section below instead of this empty message.
  }

  return (
    <>
      <BackToTopScrollView
        ref={scrollRef}
        contentContainerStyle={s.page}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={s.heading}>Venues</Text>
        <Text style={s.hint}>
          Browse every venue in the shared catalog — nights, cover, age,
          and what's been danced there.
        </Text>

        <SearchInput
          value={query}
          onChangeText={handleQueryChange}
          placeholder="Search or add a venue"
          style={s.search}
        />

        <View style={s.dayRow}>
          <Pressable
            style={[s.dayChip, dayFilters.length > 0 && s.dayChipOn]}
            onPress={() => setDayFilterOpen(true)}
          >
            <Text style={[s.dayChipText, dayFilters.length > 0 && s.dayChipTextOn]}>
              {dayFilters.length
                ? `${dayFilters.map((d) => DAY_LABEL[d]).join(", ")} ▾`
                : "Filter by night ▾"}
            </Text>
          </Pressable>
          <Pressable
            style={[s.dayChip, dancedOnly && s.dayChipOn]}
            onPress={() => setDancedOnly((v) => !v)}
          >
            <Text style={[s.dayChipText, dancedOnly && s.dayChipTextOn]}>
              📍 Danced Here
            </Text>
          </Pressable>
          <Pressable
            style={[s.dayChip, nearMeOnly && s.dayChipOn]}
            onPress={handleToggleNearMe}
            disabled={nearMeLoading}
          >
            {nearMeLoading ? (
              <ActivityIndicator color={colors.muted} size="small" />
            ) : (
              <Text style={[s.dayChipText, nearMeOnly && s.dayChipTextOn]}>
                🧭 Near Me
              </Text>
            )}
          </Pressable>
        </View>

        {nearMeOnly && (
          <Text style={s.nearMeHint}>
            Reported line dancing bars within 30 miles of you.
          </Text>
        )}

        {error ? <Text style={s.error}>{error}</Text> : null}

        {initialLoading && (
          <ActivityIndicator color={colors.gold} style={s.loader} />
        )}

        {!initialLoading &&
          ordered.map((venue) => (
            <VenueCard
              key={venue.id}
              venue={venue}
              userId={userId}
              isHome={venue.id === homeVenueId}
              onOpenDances={() => setDancesVenue(venue)}
              onSubmitRevision={() => setNotifyModal({ venue, kind: "revision" })}
              onRequestRep={() => setNotifyModal({ venue, kind: "rep_request" })}
              onNightsChanged={(nights) => setNightsLocally(venue.id, nights)}
              onHomeChanged={setHomeVenueId}
            />
          ))}

        {!initialLoading && !error && emptyMessage && (
          <Text style={s.empty}>{emptyMessage}</Text>
        )}

        {showGoogleResults && (
          <>
            <Text style={s.filterLabel}>FROM GOOGLE MAPS</Text>
            {placesError ? <Text style={s.error}>{placesError}</Text> : null}
            {placesLoading && !placeSuggestions.length && (
              <ActivityIndicator color={colors.gold} style={s.loader} />
            )}
            {placeSuggestions.map((suggestion) => (
              <Pressable
                key={suggestion.placeId}
                style={s.placeOption}
                onPress={() => handleSelectPlace(suggestion)}
                disabled={addingPlaceId === suggestion.placeId}
              >
                <Text style={s.placeOptionText} numberOfLines={2}>
                  📍 {suggestion.description}
                </Text>
                {addingPlaceId === suggestion.placeId && (
                  <ActivityIndicator color={colors.gold} size="small" />
                )}
              </Pressable>
            ))}
            {!placesLoading && (
              <Pressable
                style={s.addFreeText}
                onPress={handleAddFreeText}
                disabled={addingFreeText}
              >
                <Text style={s.addFreeTextLabel}>
                  {addingFreeText ? "Adding…" : `＋ Add "${trimmedQuery}" as a new venue`}
                </Text>
              </Pressable>
            )}
          </>
        )}

        {!loading && !trimmedQuery && results.length >= limit && results.length > 0 && (
          <Pressable style={s.loadMore} onPress={() => setLimit((n) => n + DEFAULT_LIMIT)}>
            <Text style={s.loadMoreText}>Load more venues</Text>
          </Pressable>
        )}
      </BackToTopScrollView>

      <VenueDancesModal
        venue={dancesVenue}
        tier={tier}
        progress={progress}
        catalogCache={catalogCache}
        onOpenDance={onOpenDance}
        onQuickStatusAtVenue={onQuickStatusAtVenue}
        onCacheDances={onCacheDances}
        refreshKey={refreshKey}
        onClose={() => setDancesVenue(null)}
      />

      <VenueRevisionModal
        venue={notifyModal?.venue ?? null}
        userId={userId}
        kind={notifyModal?.kind ?? "revision"}
        onClose={() => setNotifyModal(null)}
        onRequested={() => notifyModal && markRepRequested(notifyModal.venue.id)}
      />

      <VenueScheduleModal venue={scheduleVenue} onClose={() => setScheduleVenue(null)} />

      <DayFilterModal
        visible={dayFilterOpen}
        selected={dayFilters}
        onChange={handleDayFiltersChange}
        onClose={() => setDayFilterOpen(false)}
      />
    </>
  );
}

const s = StyleSheet.create({
  page: { padding: 20, paddingBottom: 115 },
  heading: {
    color: colors.ink,
    fontSize: 25,
    fontWeight: "900",
    marginBottom: 8,
  },
  hint: { color: colors.muted, fontSize: 13, lineHeight: 18 },
  filterLabel: {
    color: colors.gold,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.2,
    marginTop: 18,
    marginBottom: 8,
  },
  dayRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 8 },
  dayChip: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 8,
    paddingVertical: 7,
    paddingHorizontal: 11,
  },
  dayChipOn: { borderColor: colors.pink, backgroundColor: "#ff4e9b22" },
  dayChipText: { color: colors.muted, fontSize: 12, fontWeight: "700" },
  dayChipTextOn: { color: colors.pink },
  nearMeHint: { color: colors.muted, fontSize: 12, marginBottom: 10 },
  search: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    color: colors.ink,
    padding: 13,
    fontSize: 15,
    marginTop: 16,
    marginBottom: 14,
  },
  placeOption: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  placeOptionText: { flex: 1, color: colors.ink, fontSize: 14 },
  addFreeText: { paddingVertical: 14, paddingHorizontal: 4 },
  addFreeTextLabel: { color: colors.pink, fontSize: 13, fontWeight: "800" },
  loader: { marginTop: 20 },
  empty: { color: colors.muted, fontSize: 14, marginTop: 14, lineHeight: 20 },
  error: { color: "#ff8080", fontSize: 13, marginTop: 10 },
  loadMore: {
    alignSelf: "center",
    marginTop: 6,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
  },
  loadMoreText: { color: colors.muted, fontSize: 13, fontWeight: "700" },
});
