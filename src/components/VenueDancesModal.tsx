import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Dance, DanceProgress } from "../types";
import { colors } from "../styles";
import { DanceCard, QuickStatus } from "./DanceCard";
import { SearchInput } from "./SearchInput";
import { getDancesByIds, searchTeachVideoUrl, mapWithConcurrency } from "../lib/bootstepper";
import { loadVenueDanceReports, VenueDanceReport, VenueOption } from "../services/venues";
import { Tier } from "../lib/tier";
import { topDancesPerVenueFor } from "../lib/planLimits";

/** "What's Playing" — the dances reported at a venue, in a modal instead
 *  of inline (see VenuesScreen.tsx, which now shows many venue cards at
 *  once rather than one selected venue). Same fetch/resolve logic that
 *  used to live directly in VenuesScreen, just scoped to whichever venue
 *  is currently open here. Free accounts only see the top N (already
 *  ordered most-reported-first) — see topDancesPerVenueFor. */
export function VenueDancesModal({
  venue,
  tier,
  progress,
  catalogCache,
  onOpenDance,
  onQuickStatusAtVenue,
  onCacheDances,
  refreshKey,
  onClose,
}: {
  venue: VenueOption | null;
  tier: Tier;
  progress: Record<string, DanceProgress>;
  catalogCache: Record<string, Dance>;
  onOpenDance: (dance: Dance) => void;
  onQuickStatusAtVenue: (dance: Dance, status: QuickStatus, venueId: string) => void;
  onCacheDances: (dances: Dance[]) => void;
  refreshKey: number;
  onClose: () => void;
}) {
  const [reports, setReports] = useState<VenueDanceReport[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!venue) return;
    setReports([]);
    setQuery("");
    setLoading(true);
    setError("");
    loadVenueDanceReports(venue.id)
      .then(setReports)
      .catch((err: any) => setError(err?.message ?? "Could not load dances for this venue."))
      .finally(() => setLoading(false));
  }, [venue?.id, refreshKey]);

  const cap = topDancesPerVenueFor(tier);
  // Already ordered most-reported-first by loadVenueDanceReports, so
  // capping here keeps the most relevant dances for a free account.
  // Memoized (not just sliced inline) so it has a stable reference across
  // renders — it's a useEffect dependency below.
  const capped = useMemo(
    () => (Number.isFinite(cap) ? reports.slice(0, cap) : reports),
    [reports, cap],
  );
  const hiddenCount = reports.length - capped.length;

  // Resolve full BootStepper details (choreographer, counts, …) for
  // whatever's still a bare snapshot — same self-healing pattern as
  // App.tsx's own resolver: only mark an id "done" on success, so a
  // transient BootStepper hiccup doesn't leave a card bare forever.
  // Scoped to `capped`, not `reports` — no point resolving dances a free
  // account can't even see.
  const resolvedRef = useRef<Set<string>>(new Set());
  const retryRef = useRef(0);
  const [retryTick, setRetryTick] = useState(0);
  useEffect(() => {
    const needIds = capped
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
        // getDancesByIds never carries a teach video — best-effort,
        // separate lookup so a dance you haven't added yet still gets to
        // show BootStepper's video here, not just once you've searched
        // for it on Home.
        mapWithConcurrency(
          dances.filter((d) => !d.teachVideoUrl),
          8,
          (d): Promise<Dance | null> =>
            searchTeachVideoUrl(d.id, d.name)
              .then((teachVideoUrl): Dance | null =>
                teachVideoUrl ? { ...d, teachVideoUrl } : null,
              )
              .catch(() => null),
        ).then((withVideos) => {
          if (cancelled) return;
          const found = withVideos.filter((d): d is Dance => d !== null);
          if (found.length) onCacheDances(found);
        });
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
  }, [capped, retryTick]);

  const visible = useMemo(() => {
    const merged = capped.map((r) => ({
      ...r,
      dance: catalogCache[r.dance.id] ?? r.dance,
    }));
    const needle = query.trim().toLowerCase();
    if (!needle) return merged;
    return merged.filter(({ dance }) =>
      [dance.name, dance.defaultSong].join(" ").toLowerCase().includes(needle),
    );
  }, [capped, catalogCache, query]);

  if (!venue) return null;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.overlay}>
        <View style={s.card}>
          <Pressable style={s.closeButton} onPress={onClose} hitSlop={10}>
            <Text style={s.closeButtonText}>✕</Text>
          </Pressable>
          <View style={s.header}>
            <Text style={s.title} numberOfLines={2}>
              {venue.name}
            </Text>
            <Text style={s.subtitle}>
              {reports.length} {reports.length === 1 ? "dance" : "dances"} reported here
            </Text>
            {reports.length > 0 && (
              <SearchInput
                value={query}
                onChangeText={setQuery}
                placeholder="Search dances"
                style={s.search}
              />
            )}
          </View>
          <ScrollView contentContainerStyle={s.sheet}>
            {loading && <ActivityIndicator color={colors.gold} style={s.loader} />}
            {error ? <Text style={s.error}>{error}</Text> : null}

            {!loading &&
              visible.map(({ dance, reportedBy }) => (
                <DanceCard
                  key={dance.id}
                  dance={dance}
                  song={dance.defaultSong}
                  progress={progress[dance.id]}
                  note={`👥 ${reportedBy} dancer${reportedBy === 1 ? "" : "s"} report this here`}
                  onPress={() => onOpenDance(dance)}
                  onQuickStatus={(status) => onQuickStatusAtVenue(dance, status, venue.id)}
                />
              ))}

            {!loading && !reports.length && !error && (
              <Text style={s.empty}>
                No dances reported at {venue.name} yet — tag one to a venue
                from its details to be the first.
              </Text>
            )}
            {!loading && reports.length > 0 && !visible.length && (
              <Text style={s.empty}>No dances match "{query}".</Text>
            )}
            {!loading && hiddenCount > 0 && !query.trim() && (
              <Text style={s.capNote}>
                Showing the top {capped.length} — {hiddenCount} more danced
                here. Upgrade for the full list.
              </Text>
            )}
          </ScrollView>
        </View>
      </View>
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
    maxHeight: "88%",
    overflow: "hidden",
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
  header: {
    paddingHorizontal: 25,
    paddingTop: 25,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  title: { color: colors.ink, fontSize: 23, fontWeight: "900", paddingRight: 36 },
  subtitle: { color: colors.muted, fontSize: 12, marginTop: 4, marginBottom: 12 },
  search: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    color: colors.ink,
    padding: 13,
    fontSize: 15,
  },
  sheet: { paddingHorizontal: 25, paddingTop: 14, paddingBottom: 32 },
  loader: { marginTop: 20 },
  empty: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  capNote: { color: colors.gold, fontSize: 12, lineHeight: 17, marginTop: 14, textAlign: "center" },
  error: { color: "#ff8080", fontSize: 13, marginTop: 10 },
});
