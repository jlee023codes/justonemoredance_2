import { useEffect, useMemo, useState } from "react";
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
import { confirmAction } from "../lib/alerts";
import { DanceCard, QuickStatus } from "./DanceCard";
import { BulkRemoveBar, SelectToRemoveButton } from "./BulkRemoveBar";
import { MyListToolsModal } from "./MyListToolsModal";
import { loadUserVenues, loadVenueLinks, VenueOption } from "../services/venues";
import {
  buildMyList,
  DEFAULT_SORT,
  EMPTY_FILTERS,
  MyListFilters,
  MyListSort,
  SORT_LABELS,
  StatusFilter,
  activeFilterCount,
} from "../lib/danceListView";

// Falls back to whatever was snapshotted on the progress row if BootStepper
// hasn't resolved the full dance yet.
function danceFromProgress(progress: DanceProgress): Dance {
  return {
    id: progress.danceId,
    name: progress.danceName ?? "Dance",
    defaultSong: progress.danceSong ?? "",
    difficulty: progress.danceDifficulty ?? "Beginner",
    details: "",
    songSwaps: [],
    snapshot: true,
  };
}

const STATUS_CHIPS: { status: StatusFilter; icon: string; label: string }[] = [
  { status: "maybe", icon: "🔖", label: "Saved for Later" },
  { status: "want", icon: "♡", label: "Want to Learn" },
  { status: "learned", icon: "★", label: "Learned" },
];

export function MyListScreen({
  userId,
  progress,
  catalogCache,
  onOpenDance,
  onQuickStatus,
  onRemoveDances,
  refreshKey,
}: {
  userId: string;
  progress: Record<string, DanceProgress>;
  // Full BootStepper dances resolved by the parent — lets the cards show
  // choreographer / counts / swaps, and lets the filters see counts/walls/tags.
  catalogCache: Record<string, Dance>;
  onOpenDance: (dance: Dance) => void;
  onQuickStatus: (dance: Dance, status: QuickStatus) => void;
  onRemoveDances: (danceIds: string[]) => Promise<void>;
  // Bumped by the parent whenever a venue tie changes elsewhere.
  refreshKey: number;
}) {
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<MyListFilters>(EMPTY_FILTERS);
  const [sort, setSort] = useState<MyListSort>(DEFAULT_SORT);
  const [toolsOpen, setToolsOpen] = useState(false);

  const [userVenues, setUserVenues] = useState<VenueOption[]>([]);
  const [venueLinks, setVenueLinks] = useState<Record<string, string[]>>({});
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const exitSelect = () => {
    setSelectMode(false);
    setSelectedIds(new Set());
  };
  const toggleSelected = (danceId: string) =>
    setSelectedIds((current) => {
      const next = new Set(current);
      next.has(danceId) ? next.delete(danceId) : next.add(danceId);
      return next;
    });

  useEffect(() => {
    setLoading(true);
    setError("");
    Promise.all([loadUserVenues(userId), loadVenueLinks(userId)])
      .then(([venues, links]) => {
        setUserVenues(venues);
        setVenueLinks(links);
      })
      .catch((err: any) =>
        setError(err?.message ?? "Could not load your venues."),
      )
      .finally(() => setLoading(false));
  }, [userId, refreshKey]);

  const rows = useMemo(
    () =>
      Object.values(progress).map((p) => ({
        dance: catalogCache[p.danceId] ?? danceFromProgress(p),
        progress: p,
        venueIds: venueLinks[p.danceId] ?? [],
      })),
    [progress, catalogCache, venueLinks],
  );

  const visible = useMemo(
    () => buildMyList(rows, { search, filters, sort }),
    [rows, search, filters, sort],
  );

  const toolsBadge = activeFilterCount(filters);
  const anyActive =
    search.trim().length > 0 ||
    filters.statuses.length > 0 ||
    toolsBadge > 0 ||
    sort.key !== DEFAULT_SORT.key ||
    sort.dir !== DEFAULT_SORT.dir;

  const toggleStatus = (status: StatusFilter) =>
    setFilters((f) => ({
      ...f,
      statuses: f.statuses.includes(status)
        ? f.statuses.filter((s) => s !== status)
        : [...f.statuses, status],
    }));

  const clearAll = () => {
    setSearch("");
    setFilters(EMPTY_FILTERS);
    setSort(DEFAULT_SORT);
  };

  const removeWithConfirm = async (danceIds: string[], message: string) => {
    if (!danceIds.length) return;
    const ok = await confirmAction(
      danceIds.length === 1 ? "Remove this dance?" : "Remove these dances?",
      message,
      "Remove",
      true,
    );
    if (!ok) return;
    try {
      await onRemoveDances(danceIds);
      exitSelect();
    } catch (err: any) {
      setError(err?.message ?? "Could not remove.");
    }
  };

  const nothingSaved = rows.length === 0;
  const canManage = !nothingSaved;

  return (
    <>
      <ScrollView
        contentContainerStyle={[s.page, selectMode && s.pageSelecting]}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={s.heading}>My List</Text>

        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search dances, songs, choreographers"
          placeholderTextColor={colors.muted}
          style={s.search}
        />

        <View style={s.quickRow}>
          {STATUS_CHIPS.map((chip) => {
            const active = filters.statuses.includes(chip.status);
            return (
              <Pressable
                key={chip.status}
                style={[s.quickChip, active && s.quickChipOn]}
                onPress={() => toggleStatus(chip.status)}
                hitSlop={4}
              >
                <Text style={[s.quickIcon, active && s.quickTextOn]}>
                  {chip.icon}
                </Text>
                <Text
                  style={[s.quickLabel, active && s.quickTextOn]}
                  numberOfLines={1}
                >
                  {chip.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <View style={s.toolsRow}>
          <Pressable
            style={[s.toolsButton, s.toolsButtonGrow]}
            onPress={() => setToolsOpen(true)}
          >
            <Text style={s.toolsButtonText}>
              ⚙ Filter &amp; sort · {SORT_LABELS[sort.key]}
            </Text>
            {toolsBadge > 0 && (
              <View style={s.toolsBadge}>
                <Text style={s.toolsBadgeText}>{toolsBadge}</Text>
              </View>
            )}
          </Pressable>
          {anyActive && (
            <Pressable style={s.clearInline} onPress={clearAll}>
              <Text style={s.clearInlineText}>Clear</Text>
            </Pressable>
          )}
        </View>

        {error ? <Text style={s.error}>{error}</Text> : null}
        {loading && !rows.length && (
          <ActivityIndicator color={colors.gold} style={s.loader} />
        )}

        <View style={s.listHead}>
          <View style={s.listHeadLeft}>
            <Text style={s.section}>YOUR DANCES</Text>
            <Text style={s.listHeadCount}>
              {visible.length} {visible.length === 1 ? "dance" : "dances"}
            </Text>
          </View>
          {canManage &&
            (selectMode ? (
              <Text style={s.selectCount}>{selectedIds.size} selected</Text>
            ) : (
              <SelectToRemoveButton onPress={() => setSelectMode(true)} />
            ))}
        </View>

        {visible.map(({ dance, progress: p }) => (
          <DanceCard
            key={dance.id}
            dance={dance}
            song={dance.defaultSong}
            progress={p}
            selected={selectMode ? selectedIds.has(dance.id) : undefined}
            onPress={
              selectMode
                ? () => toggleSelected(dance.id)
                : () => onOpenDance(dance)
            }
            onQuickStatus={(status) => onQuickStatus(dance, status)}
            onDelete={
              selectMode
                ? undefined
                : () =>
                    removeWithConfirm(
                      [dance.id],
                      `Remove "${dance.name}" from your lists and every venue you've tagged it to?`,
                    )
            }
          />
        ))}

        {!loading && nothingSaved && !error && (
          <Text style={s.empty}>
            Nothing saved yet — find a dance on Home and mark it Saved for
            Later, Want to Learn, or Learned.
          </Text>
        )}
        {!nothingSaved && visible.length === 0 && (
          <View>
            <Text style={s.empty}>No dances match your search or filters.</Text>
            <Pressable style={s.clearButton} onPress={clearAll}>
              <Text style={s.clearButtonText}>Clear search &amp; filters</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>

      {selectMode && (
        <BulkRemoveBar
          count={selectedIds.size}
          onCancel={exitSelect}
          onRemove={() =>
            removeWithConfirm(
              [...selectedIds],
              `Remove ${selectedIds.size} dance${
                selectedIds.size === 1 ? "" : "s"
              } from your lists and every venue you've tagged them to?`,
            )
          }
        />
      )}

      <MyListToolsModal
        visible={toolsOpen}
        onClose={() => setToolsOpen(false)}
        filters={filters}
        sort={sort}
        userVenues={userVenues}
        onFiltersChange={setFilters}
        onSortChange={setSort}
      />
    </>
  );
}

const s = StyleSheet.create({
  page: { padding: 20, paddingBottom: 115 },
  pageSelecting: { paddingBottom: 190 },
  heading: {
    color: colors.ink,
    fontSize: 25,
    fontWeight: "900",
    marginBottom: 14,
  },
  search: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    color: colors.ink,
    padding: 14,
    fontSize: 15,
  },
  quickRow: { flexDirection: "row", gap: 8, marginTop: 12 },
  quickChip: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    paddingVertical: 9,
    paddingHorizontal: 4,
  },
  quickChipOn: { borderColor: colors.pink, backgroundColor: "#3a1f30" },
  quickIcon: { fontSize: 12, color: colors.muted },
  quickLabel: {
    flexShrink: 1,
    fontSize: 11,
    fontWeight: "800",
    color: colors.muted,
  },
  quickTextOn: { color: colors.pink },
  toolsRow: {
    marginTop: 10,
    flexDirection: "row",
    alignItems: "stretch",
    gap: 8,
  },
  toolsButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    paddingVertical: 11,
    paddingHorizontal: 12,
  },
  toolsButtonGrow: { flex: 1 },
  toolsButtonText: { color: colors.ink, fontSize: 13, fontWeight: "800" },
  clearInline: {
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.pink,
    borderRadius: 10,
    paddingHorizontal: 16,
  },
  clearInlineText: { color: colors.pink, fontSize: 13, fontWeight: "800" },
  toolsBadge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 5,
    backgroundColor: colors.pink,
    alignItems: "center",
    justifyContent: "center",
  },
  toolsBadgeText: { color: "#fff", fontSize: 10, fontWeight: "900" },
  listHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 24,
    marginBottom: 8,
  },
  listHeadLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexShrink: 1,
  },
  section: {
    color: colors.gold,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1.4,
    flexShrink: 1,
  },
  listHeadCount: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "500",
    flexShrink: 0,
  },
  selectCount: { color: colors.muted, fontWeight: "800", fontSize: 12 },
  empty: { color: colors.muted, fontSize: 14, marginTop: 14, lineHeight: 20 },
  clearButton: {
    alignSelf: "flex-start",
    marginTop: 12,
    borderWidth: 1,
    borderColor: colors.pink,
    borderRadius: 10,
    paddingVertical: 9,
    paddingHorizontal: 14,
  },
  clearButtonText: { color: colors.pink, fontWeight: "800", fontSize: 13 },
  error: { color: "#ff8080", fontSize: 13, marginTop: 10 },
  loader: { marginTop: 20 },
});
