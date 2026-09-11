import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Dance, DanceProgress } from "../types";
import { colors } from "../styles";
import { DanceCard, QuickStatus } from "./DanceCard";
import { VenuePicker } from "./VenuePicker";
import { getDancesByIds } from "../lib/bootstepper";
import {
  loadHomeVenueId,
  loadVenueById,
  loadVenueDanceReports,
  searchGlobalVenues,
  VenueDanceReport,
  VenueOption,
} from "../services/venues";

/** Browse every venue in the shared catalog — not just your own — and see
 *  which dances people report dancing there, aggregated across everyone.
 *  Defaults to your home bar. */
export function VenuesScreen({
  userId,
  progress,
  catalogCache,
  onOpenDance,
  onQuickStatusAtVenue,
  onCacheDances,
  refreshKey,
}: {
  userId: string;
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
  // Bumped by the parent whenever a venue tie changes elsewhere, so the
  // "reported by" counts here stay current.
  refreshKey: number;
}) {
  const [venue, setVenue] = useState<VenueOption | null>(null);
  const [homeVenueId, setHomeVenueId] = useState<string | null>(null);
  const [loadingVenue, setLoadingVenue] = useState(true);
  const [pickerOpen, setPickerOpen] = useState(false);

  const [reports, setReports] = useState<VenueDanceReport[]>([]);
  const [loadingDances, setLoadingDances] = useState(false);
  const [danceQuery, setDanceQuery] = useState("");
  const [error, setError] = useState("");

  // Default selection: the user's home bar, falling back to the
  // most-endorsed venue in the whole catalog if they haven't set one. Runs
  // once per sign-in — later home-bar changes elsewhere don't yank the
  // venue out from under someone actively browsing.
  useEffect(() => {
    let cancelled = false;
    setLoadingVenue(true);
    setError("");
    (async () => {
      const home = await loadHomeVenueId(userId).catch(() => null);
      if (cancelled) return;
      setHomeVenueId(home);
      if (home) {
        const named = await loadVenueById(home, userId).catch(() => null);
        if (cancelled) return;
        if (named) {
          setVenue(named);
          return;
        }
      }
      // Note: the DB query is limited *before* the votes sort, so ask for a
      // real page (default limit) rather than limit:1 — otherwise "top" is
      // just whatever's alphabetically first, not most-endorsed.
      const top = await searchGlobalVenues("", userId).catch(() => []);
      if (!cancelled) setVenue(top[0] ?? null);
    })()
      .catch((err: any) =>
        setError(err?.message ?? "Could not load venues."),
      )
      .finally(() => {
        if (!cancelled) setLoadingVenue(false);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  // The dances reported at whichever venue is currently selected.
  useEffect(() => {
    if (!venue) {
      setReports([]);
      return;
    }
    setLoadingDances(true);
    setError("");
    loadVenueDanceReports(venue.id)
      .then(setReports)
      .catch((err: any) =>
        setError(err?.message ?? "Could not load dances for this venue."),
      )
      .finally(() => setLoadingDances(false));
  }, [venue?.id, refreshKey]);

  // Resolve full BootStepper details (choreographer, counts, …) for
  // whatever's still a bare snapshot — same self-healing pattern as
  // App.tsx's own resolver: only mark an id "done" on success, so a
  // transient BootStepper hiccup doesn't leave a card bare forever.
  const resolvedRef = useRef<Set<string>>(new Set());
  const retryRef = useRef(0);
  const [retryTick, setRetryTick] = useState(0);
  useEffect(() => {
    const needIds = reports
      .map((r) => r.dance.id)
      .filter((id) => {
        if (resolvedRef.current.has(id)) return false;
        const cached = catalogCache[id];
        return !cached || cached.snapshot;
      });
    if (!needIds.length) return;
    let cancelled = false;
    getDancesByIds(needIds)
      .then((dances) => {
        if (cancelled) return;
        needIds.forEach((id) => resolvedRef.current.add(id));
        retryRef.current = 0;
        onCacheDances(dances);
      })
      .catch(() => {
        if (cancelled || retryRef.current >= 4) return;
        retryRef.current += 1;
        setTimeout(() => setRetryTick((n) => n + 1), 15000);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reports, retryTick]);

  const visible = useMemo(() => {
    const merged = reports.map((r) => ({
      ...r,
      dance: catalogCache[r.dance.id] ?? r.dance,
    }));
    const needle = danceQuery.trim().toLowerCase();
    if (!needle) return merged;
    return merged.filter(({ dance }) =>
      [dance.name, dance.defaultSong].join(" ").toLowerCase().includes(needle),
    );
  }, [reports, catalogCache, danceQuery]);

  const isHome = venue && venue.id === homeVenueId;
  // Only blank the list for the very first load of a venue. A background
  // refresh (e.g. after tying a venue from the dance modal) updates the
  // list in place instead of flashing a spinner over cards already on
  // screen.
  const initialLoading = loadingDances && reports.length === 0;

  return (
    <>
      <ScrollView
        contentContainerStyle={s.page}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={s.heading}>Venues</Text>
        <Text style={s.hint}>
          Browse every venue in the shared catalog and see which dances
          people report dancing there.
        </Text>

        {loadingVenue ? (
          <ActivityIndicator color={colors.gold} style={s.loader} />
        ) : (
          <Pressable style={s.venueCard} onPress={() => setPickerOpen(true)}>
            <View style={s.venueCardCopy}>
              <Text style={s.venueCardName} numberOfLines={1}>
                {venue ? `${isHome ? "🏠 " : ""}${venue.name}` : "Choose a venue"}
              </Text>
              {venue && (
                <Text style={s.venueCardMeta}>
                  ★ {venue.votes ?? 0} endorsement
                  {(venue.votes ?? 0) === 1 ? "" : "s"}
                  {isHome ? " · your home bar" : ""}
                </Text>
              )}
            </View>
            <Text style={s.venueCardChange}>
              {venue ? "Change ▾" : "Browse ▾"}
            </Text>
          </Pressable>
        )}

        {error ? <Text style={s.error}>{error}</Text> : null}

        {venue && (
          <>
            <View style={s.listHead}>
              <Text style={s.section}>DANCES REPORTED HERE</Text>
              {!initialLoading && (
                <Text style={s.listHeadCount}>
                  {reports.length} {reports.length === 1 ? "dance" : "dances"}
                </Text>
              )}
            </View>

            {reports.length > 0 && (
              <TextInput
                value={danceQuery}
                onChangeText={setDanceQuery}
                placeholder="Search dances"
                placeholderTextColor={colors.muted}
                style={s.danceSearch}
              />
            )}

            {initialLoading && (
              <ActivityIndicator color={colors.gold} style={s.loader} />
            )}

            {!initialLoading &&
              visible.map(({ dance, reportedBy }) => (
                <DanceCard
                  key={dance.id}
                  dance={dance}
                  song={dance.defaultSong}
                  progress={progress[dance.id]}
                  note={`👥 ${reportedBy} dancer${
                    reportedBy === 1 ? "" : "s"
                  } report this here`}
                  onPress={() => onOpenDance(dance)}
                  onQuickStatus={(status) =>
                    onQuickStatusAtVenue(dance, status, venue.id)
                  }
                />
              ))}

            {!initialLoading && !reports.length && !error && (
              <Text style={s.empty}>
                No dances reported at {venue.name} yet — tag one to a venue
                from its details to be the first.
              </Text>
            )}
            {!initialLoading && reports.length > 0 && !visible.length && (
              <Text style={s.empty}>No dances match “{danceQuery}”.</Text>
            )}
          </>
        )}
      </ScrollView>

      <VenuePicker
        visible={pickerOpen}
        title="Browse a venue"
        userId={userId}
        homeVenueId={homeVenueId}
        selectedVenueId={venue?.id}
        onSelect={(picked) => {
          setVenue(picked);
          setDanceQuery("");
          setPickerOpen(false);
        }}
        onClose={() => setPickerOpen(false)}
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
  loader: { marginTop: 20 },
  venueCard: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 14,
    padding: 16,
    marginTop: 16,
    flexDirection: "row",
    alignItems: "center",
  },
  venueCardCopy: { flex: 1 },
  venueCardName: { color: colors.ink, fontSize: 18, fontWeight: "900" },
  venueCardMeta: { color: colors.gold, fontSize: 12, fontWeight: "700", marginTop: 4 },
  venueCardChange: { color: colors.pink, fontSize: 13, fontWeight: "800" },
  listHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 26,
    marginBottom: 8,
  },
  section: {
    color: colors.gold,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1.4,
  },
  listHeadCount: { color: colors.muted, fontSize: 12, fontWeight: "500" },
  danceSearch: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    color: colors.ink,
    padding: 13,
    fontSize: 15,
    marginBottom: 10,
  },
  empty: { color: colors.muted, fontSize: 14, marginTop: 14, lineHeight: 20 },
  error: { color: "#ff8080", fontSize: 13, marginTop: 10 },
});
