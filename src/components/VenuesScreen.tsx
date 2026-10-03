import { Ref, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Dance, DanceProgress } from "../types";
import { colors } from "../styles";
import { Tier } from "../lib/tier";
import { QuickStatus } from "./DanceCard";
import { BackToTopHandle, BackToTopScrollView } from "./BackToTopScrollView";
import { VenueCard } from "./VenueCard";
import { VenueDancesModal } from "./VenueDancesModal";
import { VenueRevisionModal } from "./VenueRevisionModal";
import { VenueScheduleModal } from "./VenueScheduleModal";
import { SearchInput } from "./SearchInput";
import { getPlaceDetails, newSessionToken, PlaceSuggestion, searchPlaces } from "../lib/placesSearch";
import {
  attachNights,
  attachRepStatus,
  DAY_LABEL,
  DAY_ORDER,
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
  const [dayFilter, setDayFilter] = useState<DayOfWeek | null>(null);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [dancedOnly, setDancedOnly] = useState(false);
  const [dancedVenueIds, setDancedVenueIds] = useState<Set<string>>(new Set());
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
    const timer = setTimeout(() => {
      searchGlobalVenues(query, userId, limit, dayFilter ?? undefined)
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
  }, [query, limit, dayFilter, userId, isAdmin]);

  // Independent of the local search above — kicked off in parallel so
  // there's no extra delay once local comes back empty. Only shown
  // (below) once local results are actually empty for this query.
  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setPlaceSuggestions([]);
      return;
    }
    let cancelled = false;
    setPlacesLoading(true);
    const timer = setTimeout(() => {
      searchPlaces(trimmed, sessionToken.current)
        .then((suggestions) => {
          if (!cancelled) setPlaceSuggestions(suggestions);
        })
        .catch(() => {
          if (!cancelled) setPlaceSuggestions([]);
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

  const handleDayFilter = (day: DayOfWeek) => {
    setDayFilter((cur) => (cur === day ? null : day));
    setLimit(DEFAULT_LIMIT);
  };

  const setNightsLocally = (venueId: string, nights: { day: DayOfWeek; details: string }[]) => {
    setResults((prev) => prev.map((v) => (v.id === venueId ? { ...v, nights } : v)));
  };

  const setFavoritedLocally = (venueId: string, favorited: boolean) => {
    setResults((prev) => prev.map((v) => (v.id === venueId ? { ...v, favorited } : v)));
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

  const ordered = homeFirst(results, homeVenueId).filter(
    (v) => (!favoritesOnly || v.favorited) && (!dancedOnly || dancedVenueIds.has(v.id)),
  );
  const initialLoading = loading && !results.length;
  const trimmedQuery = query.trim();
  const showGoogleResults = trimmedQuery.length > 0 && !loading && results.length === 0;

  // favoritesOnly/dancedOnly filter client-side after the fetch, so "no
  // matches" can mean either "nothing in the DB" (results empty) or
  // "nothing matching the filter among what's there" (results
  // non-empty, ordered empty) — worth distinguishing so the message is
  // actually useful.
  let emptyMessage: string | null = null;
  if (!ordered.length) {
    if (favoritesOnly) {
      emptyMessage = trimmedQuery
        ? `No favorites match "${query}".`
        : "No favorites yet — tap ♥ on a venue to save it here.";
    } else if (dancedOnly) {
      emptyMessage = trimmedQuery
        ? `No danced venues match "${query}".`
        : "Nowhere yet — tag a dance to a venue to see it here.";
    } else if (!trimmedQuery) {
      emptyMessage = dayFilter
        ? `No venues have ${DAY_LABEL[dayFilter]} dancing reported yet.`
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

        <Text style={s.filterLabel}>FILTER BY NIGHT</Text>
        <View style={s.dayRow}>
          {DAY_ORDER.map((d) => (
            <Pressable
              key={d}
              style={[s.dayChip, dayFilter === d && s.dayChipOn]}
              onPress={() => handleDayFilter(d)}
            >
              <Text style={[s.dayChipText, dayFilter === d && s.dayChipTextOn]}>
                {DAY_LABEL[d]}
              </Text>
            </Pressable>
          ))}
          <Pressable
            style={[s.dayChip, favoritesOnly && s.dayChipOn]}
            onPress={() => setFavoritesOnly((v) => !v)}
          >
            <Text style={[s.dayChipText, favoritesOnly && s.dayChipTextOn]}>
              ♥ Favorites
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
        </View>

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
              onFavoriteToggled={(favorited) => setFavoritedLocally(venue.id, favorited)}
              onHomeChanged={setHomeVenueId}
            />
          ))}

        {!initialLoading && !error && emptyMessage && (
          <Text style={s.empty}>{emptyMessage}</Text>
        )}

        {showGoogleResults && (
          <>
            <Text style={s.filterLabel}>FROM GOOGLE MAPS</Text>
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
  dayRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
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
  search: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    color: colors.ink,
    padding: 13,
    fontSize: 15,
    marginTop: 16,
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
