import { Ref, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { colors } from "../styles";
import { BackToTopHandle, BackToTopScrollView } from "./BackToTopScrollView";
import { DifficultyPieChart } from "./DifficultyPieChart";
import { LoggedDanceRow } from "./LoggedDanceRow";
import { SearchInput } from "./SearchInput";
import { matchesDanceName } from "../lib/danceListView";
import { loadSessionHistory, SessionHistoryEntry } from "../services/checkinSessions";

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
}: {
  userId: string;
  // Bumped by the parent whenever a session ends, to pick up the new entry.
  refreshKey: number;
  scrollRef?: Ref<BackToTopHandle>;
}) {
  const [entries, setEntries] = useState<SessionHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [viewingDancesFor, setViewingDancesFor] = useState<SessionHistoryEntry | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    setLoading(true);
    setError("");
    loadSessionHistory(userId)
      .then(setEntries)
      .catch((err: any) => setError(err?.message ?? "Could not load your stats."))
      .finally(() => setLoading(false));
  }, [userId, refreshKey]);

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
      <Text style={s.heading}>Stats</Text>
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
              {entry.stepCount != null && (
                <View style={s.stat}>
                  <Text style={s.statValue}>{entry.stepCount.toLocaleString()}</Text>
                  <Text style={s.statLabel}>steps</Text>
                </View>
              )}
            </View>
            {entry.endReason === "geofence" && (
              <Text style={s.autoEnded}>Auto-ended when you left the area</Text>
            )}

            {entry.dances.length > 0 && (
              <>
                <View style={s.chartRow}>
                  <DifficultyPieChart dances={entry.dances} />
                </View>
                <Pressable
                  style={s.viewDancesButton}
                  onPress={() => setViewingDancesFor(entry)}
                >
                  <Text style={s.viewDancesButtonText}>
                    View dances ({entry.dances.length}) →
                  </Text>
                </Pressable>
              </>
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
    </BackToTopScrollView>
  );
}

/** Pop-out list of everything logged during one session — a plain
 *  inline expansion gets unwieldy fast (avid dancers can log 60-100+
 *  in a night), so this is its own scrollable modal instead. */
function SessionDancesModal({
  entry,
  onClose,
}: {
  entry: SessionHistoryEntry | null;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (entry) setQuery("");
  }, [entry]);

  if (!entry) return null;

  const trimmedQuery = query.trim();
  const visibleDances = trimmedQuery
    ? entry.dances.filter((d) => matchesDanceName(d.name, trimmedQuery))
    : entry.dances;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.modalOverlay}>
        <View style={s.modalCard}>
          <Pressable style={s.modalCloseButton} onPress={onClose} hitSlop={10}>
            <Text style={s.modalCloseButtonText}>✕</Text>
          </Pressable>
          <Text style={s.modalTitle} numberOfLines={1}>{entry.venueName}</Text>
          <Text style={s.modalSubtitle}>
            {formatDate(entry.checkedInAt)} · {entry.dances.length}{" "}
            {entry.dances.length === 1 ? "dance" : "dances"}
          </Text>
          {entry.dances.length > 5 && (
            <SearchInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search tonight's dances"
              style={s.modalSearch}
            />
          )}
          <ScrollView style={s.modalList} contentContainerStyle={s.modalListContent}>
            {visibleDances.map((d, i) => (
              <LoggedDanceRow key={`${d.danceId}-${i}`} dance={d} />
            ))}
            {trimmedQuery.length > 0 && !visibleDances.length && (
              <Text style={s.empty}>No dances match "{trimmedQuery}".</Text>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
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
  statLabel: { color: colors.muted, fontSize: 11, marginTop: 2 },
  autoEnded: { color: colors.muted, fontSize: 11, marginTop: 10, fontStyle: "italic" },
  chartRow: {
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  viewDancesButton: { marginTop: 12, alignSelf: "flex-start" },
  viewDancesButtonText: { color: colors.pink, fontSize: 12.5, fontWeight: "800" },
  empty: { color: colors.muted, fontSize: 14, marginTop: 14, lineHeight: 20 },
  modalOverlay: {
    flex: 1,
    backgroundColor: "#000000aa",
    justifyContent: "center",
    padding: 20,
  },
  modalCard: {
    backgroundColor: "#2b1f35",
    borderRadius: 28,
    maxHeight: "80%",
    paddingTop: 25,
    paddingHorizontal: 25,
    paddingBottom: 20,
  },
  modalCloseButton: {
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
  modalCloseButtonText: { color: colors.ink, fontSize: 15, fontWeight: "800" },
  modalTitle: { color: colors.ink, fontSize: 22, fontWeight: "900", paddingRight: 36 },
  modalSubtitle: { color: colors.muted, fontSize: 13, marginTop: 4, marginBottom: 14 },
  modalSearch: {
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    color: colors.ink,
    padding: 11,
    fontSize: 14,
    marginBottom: 12,
  },
  modalList: { flexGrow: 0 },
  modalListContent: { paddingBottom: 10 },
});
