import { Ref, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Dance, DanceProgress } from "../types";
import { colors } from "../styles";
import { confirmAction, showAlert } from "../lib/alerts";
import { presentPaywall } from "../lib/entitlements";
import { FREE_DANCE_LIMIT } from "../lib/planLimits";
import { DanceCard, QuickStatus } from "./DanceCard";
import { BackToTopHandle, BackToTopScrollView } from "./BackToTopScrollView";
import { BulkActionBar, SelectModeButton } from "./BulkRemoveBar";
import { MyListToolsModal } from "./MyListToolsModal";
import { SearchInput } from "./SearchInput";
import { VenuePicker } from "./VenuePicker";
import {
  loadUserVenues,
  loadVenueLinks,
  saveVenueDance,
  VenueOption,
} from "../services/venues";
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
    spotifyTrackId: progress.danceSpotifyTrackId,
    spotifyUrl: progress.danceSpotifyUrl,
    appleMusicUrl: progress.danceAppleMusicUrl,
    youtubeMusicUrl: progress.danceYoutubeMusicUrl,
    amazonMusicUrl: progress.danceAmazonMusicUrl,
    // No teachVideoUrl here — the effective video is progress.link, which
    // DanceCard already reads directly (seeded from BootStepper's teach
    // video the first time a dance is added; see handleQuickStatus).
  };
}

const STATUS_CHIPS: { status: StatusFilter; icon: string; label: string }[] = [
  { status: "want", icon: "♡", label: "Want to Learn" },
  { status: "learning", icon: "🎯", label: "Learning Now" },
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
  scrollRef,
  isPremium,
  onVenuesChanged,
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
  // Lets the header logo's "back to top" tap reach whichever screen is
  // currently mounted.
  scrollRef?: Ref<BackToTopHandle>;
  // Shows the free-tier "X of FREE_DANCE_LIMIT dances" note + upgrade prompt when false.
  isPremium: boolean;
  // Lets the parent bump its venuesRefreshKey after a bulk add-to-venue,
  // same as everywhere else a venue tie changes.
  onVenuesChanged?: () => void;
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

  const [venuePickerOpen, setVenuePickerOpen] = useState(false);
  const [addingToVenue, setAddingToVenue] = useState(false);
  const danceById = useMemo(
    () => new Map(rows.map((r) => [r.dance.id, r.dance])),
    [rows],
  );

  const handleAddSelectedToVenue = async (venue: VenueOption) => {
    setVenuePickerOpen(false);
    const danceIds = [...selectedIds];
    if (!danceIds.length) return;
    setAddingToVenue(true);
    try {
      let added = 0;
      for (const danceId of danceIds) {
        const dance = danceById.get(danceId);
        if (!dance) continue;
        await saveVenueDance(userId, venue.id, dance, "");
        added++;
      }
      onVenuesChanged?.();
      exitSelect();
      showAlert(
        "Added to venue",
        `${added} dance${added === 1 ? "" : "s"} tagged to ${venue.name}.`,
      );
    } catch (err: any) {
      setError(err?.message ?? "Could not add to that venue.");
    } finally {
      setAddingToVenue(false);
    }
  };

  const nothingSaved = rows.length === 0;
  const canManage = !nothingSaved;

  const [presentingUpgrade, setPresentingUpgrade] = useState(false);
  const handleUpgrade = async () => {
    setPresentingUpgrade(true);
    try {
      const result = await presentPaywall();
      if (result === "purchased" || result === "restored") {
        showAlert("You're in! 🎉", "Premium is unlocked — no more list limit.");
      } else if (result === "error") {
        showAlert(
          "Something went wrong",
          "Could not load the paywall. Check your connection and try again.",
        );
      }
    } finally {
      setPresentingUpgrade(false);
    }
  };

  return (
    <>
      <BackToTopScrollView
        ref={scrollRef}
        hideFab={selectMode}
        contentContainerStyle={[s.page, selectMode && s.pageSelecting]}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={s.heading}>My List</Text>

        <SearchInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search dances, songs, choreographers"
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
              <SelectModeButton onPress={() => setSelectMode(true)} />
            ))}
        </View>

        {!isPremium && (
          <View style={s.limitRow}>
            <Text style={s.limitText}>
              {rows.length} of {FREE_DANCE_LIMIT} free dances
            </Text>
            <Pressable
              onPress={handleUpgrade}
              disabled={presentingUpgrade}
              hitSlop={6}
            >
              <Text style={s.limitUpgrade}>
                {presentingUpgrade ? "Loading…" : "Upgrade ✨"}
              </Text>
            </Pressable>
          </View>
        )}

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
            Nothing saved yet — find a dance on Home and mark it Want to
            Learn, Learning Now, or Learned.
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
      </BackToTopScrollView>

      {selectMode && (
        <BulkActionBar
          count={selectedIds.size}
          onCancel={exitSelect}
          onAddToVenue={() => setVenuePickerOpen(true)}
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

      <VenuePicker
        visible={venuePickerOpen}
        title={
          addingToVenue
            ? "Adding…"
            : `Add ${selectedIds.size} dance${selectedIds.size === 1 ? "" : "s"} to a venue`
        }
        userId={userId}
        restrictToMine={!isPremium}
        onSelect={handleAddSelectedToVenue}
        onClose={() => setVenuePickerOpen(false)}
      />

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
  limitRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 10,
  },
  limitText: { color: colors.muted, fontSize: 12 },
  limitUpgrade: { color: colors.pink, fontSize: 12, fontWeight: "800" },
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
