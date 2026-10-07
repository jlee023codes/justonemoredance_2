import { Ref, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import { colors } from "../styles";
import { showError } from "../lib/alerts";
import { BackToTopHandle, BackToTopScrollView } from "./BackToTopScrollView";
import { DifficultyPieChart } from "./DifficultyPieChart";
import { SearchInput } from "./SearchInput";
import { AddPastNightModal } from "./AddPastNightModal";
import { AddDanceToSessionModal } from "./AddDanceToSessionModal";
import { NewToMeModal } from "./NewToMeModal";
import { matchesDanceName } from "../lib/danceListView";
import { DanceProgress } from "../types";
import { Tier } from "../lib/entitlements";
import {
  getOrCreateShareLink,
  loadSessionHistory,
  SessionHistoryEntry,
} from "../services/checkinSessions";

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** History of past check-in sessions — how long you were out, how many
 *  dances you logged, and steps if the device reported any. Free for
 *  everyone, same as check-in itself. */
export function StatsScreen({
  userId,
  refreshKey,
  scrollRef,
  progress,
  onProgressChange,
  tier,
}: {
  userId: string;
  // Bumped by the parent whenever a session ends, to pick up the new entry.
  refreshKey: number;
  scrollRef?: Ref<BackToTopHandle>;
  // The user's own My List — drives "New To Me"'s already-added
  // dimming and the tier dance-cap on import.
  progress: Record<string, DanceProgress>;
  onProgressChange: (danceId: string, next: DanceProgress | null) => void;
  tier?: Tier;
}) {
  const [entries, setEntries] = useState<SessionHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [viewingDancesFor, setViewingDancesFor] = useState<SessionHistoryEntry | null>(null);
  const [viewingNewToMeFor, setViewingNewToMeFor] = useState<SessionHistoryEntry | null>(null);
  const [search, setSearch] = useState("");
  const [addNightOpen, setAddNightOpen] = useState(false);
  const [addDanceFor, setAddDanceFor] = useState<SessionHistoryEntry | null>(null);
  const [localRefresh, setLocalRefresh] = useState(0);

  useEffect(() => {
    setLoading(true);
    setError("");
    loadSessionHistory(userId)
      .then(setEntries)
      .catch((err: any) => setError(err?.message ?? "Could not load your stats."))
      .finally(() => setLoading(false));
  }, [userId, refreshKey, localRefresh]);

  // Search matches either the venue name, or any dance logged during
  // that session — lets "which night did I dance Tortilla Shuffle at"
  // and "when was I last at Cantina" both work from one box.
  const trimmedSearch = search.trim();
  const visibleEntries = useMemo(() => {
    if (!trimmedSearch) return entries;
    return entries.filter(
      (entry) =>
        matchesDanceName(entry.venueName, trimmedSearch) ||
        entry.dances.some((d) => matchesDanceName(d.name, trimmedSearch)),
    );
  }, [entries, trimmedSearch]);

  return (
    <BackToTopScrollView
      ref={scrollRef}
      contentContainerStyle={s.page}
      keyboardShouldPersistTaps="handled"
    >
      <View style={s.headingRow}>
        <Text style={s.heading}>Stats</Text>
        <Pressable style={s.addNightButton} onPress={() => setAddNightOpen(true)}>
          <Text style={s.addNightButtonText}>＋ Add a night</Text>
        </Pressable>
      </View>
      <Text style={s.hint}>
        Every night out you've tracked — how long you were there, how
        many dances you logged, and steps if your device counted them.
      </Text>

      <SearchInput
        value={search}
        onChangeText={setSearch}
        placeholder="Search by venue or dance"
        style={s.search}
      />

      {error ? <Text style={s.error}>{error}</Text> : null}
      {loading && <ActivityIndicator color={colors.gold} style={s.loader} />}

      {!loading &&
        visibleEntries.map((entry) => (
          <View key={entry.id} style={s.card}>
            <View style={s.cardHeader}>
              <Text style={s.venueName} numberOfLines={1}>
                {entry.venueName}
              </Text>
              <Text style={s.date}>{formatDate(entry.checkedInAt)}</Text>
            </View>
            <View style={s.statsRow}>
              <View style={s.stat}>
                <Text style={s.statValue}>{formatDuration(entry.durationSeconds)}</Text>
                <Text style={s.statLabel}>time there</Text>
              </View>
              <View style={s.stat}>
                <Text style={s.statValue}>{entry.dances.length}</Text>
                <Text style={s.statLabel}>
                  {entry.dances.length === 1 ? "dance" : "dances"}
                </Text>
              </View>
              {entry.stepCount != null ? (
                <View style={s.stat}>
                  <Text style={s.statValue}>{entry.stepCount.toLocaleString()}</Text>
                  <Text style={s.statLabel}>steps</Text>
                </View>
              ) : entry.endReason === "backfilled" ? (
                <View style={s.stat}>
                  <Text style={s.statValueMuted}>N/A</Text>
                  <Text style={s.statLabel}>not live tracked</Text>
                </View>
              ) : null}
            </View>
            {entry.endReason === "geofence" && (
              <Text style={s.autoEnded}>Auto-ended when you left the area</Text>
            )}
            {entry.endReason === "backfilled" && (
              <Text style={s.autoEnded}>Added after the fact — not tracked live</Text>
            )}
            {entry.endReason === "stale" && (
              <Text style={s.autoEnded}>Ended later, after a quiet stretch</Text>
            )}
            {entry.liveTotalCount != null && entry.liveTotalCount > 1 && (
              <View style={s.livePercentPill}>
                <Text style={s.livePercentText}>
                  ⚔️ Danced {entry.liveDancedCount ?? 0} of {entry.liveTotalCount} logged
                  while you were there (
                  {Math.round(((entry.liveDancedCount ?? 0) / entry.liveTotalCount) * 100)}%)
                </Text>
              </View>
            )}

            {entry.dances.length > 0 && (
              <View style={s.chartRow}>
                <DifficultyPieChart dances={entry.dances} />
              </View>
            )}
            <View style={s.cardActionsRow}>
              {entry.dances.length > 0 && (
                <Pressable
                  style={s.viewDancesButton}
                  onPress={() => setViewingDancesFor(entry)}
                >
                  <Text style={s.viewDancesButtonText}>
                    View dances ({entry.dances.length}) →
                  </Text>
                </Pressable>
              )}
              <Pressable style={s.addDanceButton} onPress={() => setAddDanceFor(entry)}>
                <Text style={s.addDanceButtonText}>＋ Add a dance</Text>
              </Pressable>
            </View>
            {entry.dances.some((d) => d.newToUser) && (
              <View style={s.newDancesRow}>
                <Pressable onPress={() => setViewingNewToMeFor(entry)}>
                  <Text style={s.addDanceButtonText}>
                    New To Me ({entry.dances.filter((d) => d.newToUser).length}) →
                  </Text>
                </Pressable>
              </View>
            )}
          </View>
        ))}

      {!loading && !error && !entries.length && (
        <Text style={s.empty}>
          No check-ins yet — your session history will show up here once
          you check in at a venue and dance the night away.
        </Text>
      )}
      {!loading && !error && entries.length > 0 && !visibleEntries.length && (
        <Text style={s.empty}>No nights match "{trimmedSearch}".</Text>
      )}

      <SessionDancesModal
        entry={viewingDancesFor}
        onClose={() => setViewingDancesFor(null)}
      />

      <AddPastNightModal
        visible={addNightOpen}
        userId={userId}
        onClose={() => setAddNightOpen(false)}
        onAdded={() => setLocalRefresh((k) => k + 1)}
      />

      <AddDanceToSessionModal
        entry={addDanceFor}
        onClose={() => setAddDanceFor(null)}
        onAdded={() => setLocalRefresh((k) => k + 1)}
      />

      <NewToMeModal
        userId={userId}
        entry={viewingNewToMeFor}
        progress={progress}
        onProgressChange={onProgressChange}
        tier={tier}
        onClose={() => setViewingNewToMeFor(null)}
      />
    </BackToTopScrollView>
  );
}

/** Pop-out list of everything logged during one session — minimal by
 *  design: plain dance names in text columns (no card chrome), so a
 *  long night (avid dancers can log 60-100+) still fits on screen
 *  without scrolling forever. Full-screen rather than a centered card
 *  — a fixed-width card was clipping the venue name on longer titles.
 *
 *  Defaults to just the dances this user actually danced — "Show all
 *  dances" toggles to the whole venue log for the night; "New to
 *  venue" is a separate, independent filter on top of whichever of
 *  those two is active. */
function SessionDancesModal({
  entry,
  onClose,
}: {
  entry: SessionHistoryEntry | null;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [copied, setCopied] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [newToVenueOnly, setNewToVenueOnly] = useState(false);

  useEffect(() => {
    if (entry) {
      setQuery("");
      setCopied(false);
      setShowAll(false);
      setNewToVenueOnly(false);
    }
  }, [entry]);

  if (!entry) return null;

  const baseDances = entry.dances.filter((d) => {
    if (!showAll && d.danced === false) return false;
    if (newToVenueOnly && !d.newToVenue) return false;
    return true;
  });
  const trimmedQuery = query.trim();
  const visibleDances = trimmedQuery
    ? baseDances.filter((d) => matchesDanceName(d.name, trimmedQuery))
    : baseDances;

  const handleShare = async () => {
    const danced = entry.dances.filter((d) => d.danced !== false).map((d) => d.name);
    const justLogged = entry.dances.filter((d) => d.danced === false).map((d) => d.name);
    const lines = [
      `${entry.venueName} — ${formatDate(entry.checkedInAt)}`,
      `${entry.dances.length} dances:`,
      "",
      ...danced,
    ];
    if (justLogged.length) {
      lines.push("", "Also playing (not danced):", ...justLogged);
    }
    try {
      const link = await getOrCreateShareLink(entry.id);
      lines.push("", link);
      await Share.share({ message: lines.join("\n") });
    } catch (err: any) {
      showError(err, "Could not create a share link.");
    }
  };

  const handleCopyLink = async () => {
    try {
      const link = await getOrCreateShareLink(entry.id);
      await Clipboard.setStringAsync(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch (err: any) {
      showError(err, "Could not create a share link.");
    }
  };

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={s.gridScreen}>
        <View style={s.gridTopRow}>
          <Pressable style={s.gridCloseButton} onPress={onClose} hitSlop={10}>
            <Text style={s.gridCloseButtonText}>✕</Text>
          </Pressable>
          <View style={s.gridTitleCopy}>
            <Text style={s.gridTitle} numberOfLines={2}>{entry.venueName}</Text>
            <Text style={s.gridSubtitle}>
              {formatDate(entry.checkedInAt)} · {baseDances.length} {baseDances.length === 1 ? "dance" : "dances"}
            </Text>
          </View>
          <Pressable style={s.gridShareButton} onPress={handleCopyLink} hitSlop={10}>
            <Text style={s.gridShareButtonText}>{copied ? "✓" : "🔗"}</Text>
          </Pressable>
          <Pressable style={s.gridShareButton} onPress={handleShare} hitSlop={10}>
            <Text style={s.gridShareButtonText}>⤴︎</Text>
          </Pressable>
        </View>

        {entry.dances.length > 5 && (
          <SearchInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search tonight's dances"
            style={s.gridSearch}
          />
        )}

        <View style={s.gridFilterRow}>
          <Pressable
            style={[s.gridFilterChip, showAll && s.gridFilterChipOn]}
            onPress={() => setShowAll((v) => !v)}
          >
            <Text style={[s.gridFilterChipText, showAll && s.gridFilterChipTextOn]}>
              {showAll ? "✓ " : ""}Show all dances
            </Text>
          </Pressable>
          <Pressable
            style={[s.gridFilterChip, newToVenueOnly && s.gridFilterChipOn]}
            onPress={() => setNewToVenueOnly((v) => !v)}
          >
            <Text style={[s.gridFilterChipText, newToVenueOnly && s.gridFilterChipTextOn]}>
              {newToVenueOnly ? "✓ " : ""}New to venue
            </Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={s.gridList}>
          <View style={s.textGrid}>
            {visibleDances.map((d, i) => (
              <Text key={`${d.danceId}-${i}`} style={s.textGridCell} numberOfLines={2}>
                {d.name}
              </Text>
            ))}
          </View>
          {!visibleDances.length && (
            <Text style={s.empty}>
              {trimmedQuery.length > 0
                ? `No dances match "${trimmedQuery}".`
                : "No dances match the selected filters."}
            </Text>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  page: { padding: 20, paddingBottom: 115 },
  headingRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  heading: {
    color: colors.ink,
    fontSize: 25,
    fontWeight: "900",
  },
  addNightButton: {
    borderWidth: 1,
    borderColor: colors.pink,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  addNightButtonText: { color: colors.pink, fontWeight: "800", fontSize: 12 },
  hint: { color: colors.muted, fontSize: 13, lineHeight: 18, marginBottom: 20 },
  search: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    color: colors.ink,
    padding: 13,
    fontSize: 15,
    marginBottom: 18,
  },
  loader: { marginTop: 20 },
  error: { color: "#ff8080", fontSize: 13, marginTop: 10 },
  card: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 14,
    padding: 16,
    marginBottom: 14,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  venueName: { color: colors.ink, fontSize: 17, fontWeight: "800", flex: 1, paddingRight: 10 },
  date: { color: colors.muted, fontSize: 12 },
  statsRow: { flexDirection: "row", gap: 20 },
  stat: { alignItems: "flex-start" },
  statValue: { color: colors.gold, fontSize: 18, fontWeight: "900" },
  statValueMuted: { color: colors.muted, fontSize: 14, fontWeight: "800" },
  statLabel: { color: colors.muted, fontSize: 11, marginTop: 2 },
  autoEnded: { color: colors.muted, fontSize: 11, marginTop: 10, fontStyle: "italic" },
  livePercentPill: {
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginTop: 10,
  },
  livePercentText: { color: colors.gold, fontSize: 12, fontWeight: "700", lineHeight: 17 },
  chartRow: {
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  cardActionsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 12,
  },
  viewDancesButton: { alignSelf: "flex-start" },
  viewDancesButtonText: { color: colors.pink, fontSize: 12.5, fontWeight: "800" },
  addDanceButton: { alignSelf: "flex-start", marginLeft: "auto" },
  addDanceButtonText: { color: colors.gold, fontSize: 12.5, fontWeight: "800" },
  newDancesRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 8,
  },
  empty: { color: colors.muted, fontSize: 14, marginTop: 14, lineHeight: 20 },
  gridScreen: { flex: 1, backgroundColor: colors.bg, paddingTop: 60 },
  gridTopRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    paddingHorizontal: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  gridCloseButton: {
    width: 36,
    height: 36,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: "center",
    justifyContent: "center",
  },
  gridCloseButtonText: { color: colors.muted, fontSize: 15, fontWeight: "800" },
  gridTitleCopy: { flex: 1 },
  gridTitle: { color: colors.ink, fontSize: 19, fontWeight: "900", lineHeight: 23 },
  gridSubtitle: { color: colors.muted, fontSize: 12, marginTop: 3 },
  gridShareButton: {
    width: 36,
    height: 36,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.pink,
    alignItems: "center",
    justifyContent: "center",
  },
  gridShareButtonText: { color: colors.pink, fontSize: 16, fontWeight: "800" },
  gridSearch: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    color: colors.ink,
    padding: 11,
    fontSize: 14,
    marginHorizontal: 20,
    marginTop: 14,
  },
  gridFilterRow: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 20,
    paddingTop: 14,
  },
  gridFilterChip: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 16,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  gridFilterChipOn: { borderColor: colors.pink, backgroundColor: "#ff4e9b22" },
  gridFilterChipText: { color: colors.muted, fontSize: 12, fontWeight: "700" },
  gridFilterChipTextOn: { color: colors.pink },
  gridList: { padding: 20, paddingBottom: 50 },
  // Plain text, no card chrome — three columns via flexBasis so a
  // long night's list (60-100+ dances) still reads at a glance
  // instead of scrolling a single column forever.
  textGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  textGridCell: {
    flexBasis: "33.333%",
    color: colors.ink,
    fontSize: 13,
    fontWeight: "600",
    textAlign: "center",
    paddingVertical: 10,
    paddingHorizontal: 4,
  },
});
