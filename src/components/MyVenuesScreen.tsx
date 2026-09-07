import { useEffect, useState } from "react";
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
import { VenuePicker } from "./VenuePicker";
import {
  addUserVenue,
  loadUserVenues,
  loadVenueDances,
  VenueOption,
} from "../services/venues";

// A synthetic "venue" pinned at the top of the dropdown — not a real row in
// the venues table, just an aggregate view over every dance the user has
// acted on from Home (any status: maybe/want/learned), venue or no venue.
const MY_LIST_ID = "__my_list__";
const MY_LIST_OPTION: VenueOption = { id: MY_LIST_ID, name: "My List" };

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

export function MyVenuesScreen({
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
  // Full BootStepper dances resolved by the parent — lets My List cards
  // show choreographer / counts / swaps like the Want / Learned tabs.
  catalogCache: Record<string, Dance>;
  onOpenDance: (dance: Dance) => void;
  // Same quick-add row as the Home cards — set/clear a status inline.
  onQuickStatus: (dance: Dance, status: QuickStatus) => void;
  // Removes dances from every list + venue (My List quick-delete / bulk).
  onRemoveDances: (danceIds: string[]) => Promise<void>;
  // Bumped by the parent whenever a dance is removed elsewhere, so the
  // currently-selected venue's (locally cached) dance list refetches.
  refreshKey: number;
}) {
  const [myVenues, setMyVenues] = useState<VenueOption[]>([]),
    [venuesLoading, setVenuesLoading] = useState(true),
    [venuesError, setVenuesError] = useState(""),
    [selectedVenueId, setSelectedVenueId] = useState<string>(MY_LIST_ID),
    [venueQuery, setVenueQuery] = useState(""),
    [dropdownOpen, setDropdownOpen] = useState(false),
    [addPickerOpen, setAddPickerOpen] = useState(false),
    [venueDances, setVenueDances] = useState<
      { dance: Dance; songSwap?: string }[]
    >([]),
    [dancesLoading, setDancesLoading] = useState(false),
    [dancesError, setDancesError] = useState(""),
    [danceQuery, setDanceQuery] = useState(""),
    // "Select to remove" mode (My List view only).
    [selectMode, setSelectMode] = useState(false),
    [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

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
    setVenuesLoading(true);
    setVenuesError("");
    loadUserVenues(userId)
      .then((venues) => {
        setMyVenues(venues);
        setVenuesLoading(false);
      })
      .catch((err) => {
        setVenuesLoading(false);
        setVenuesError(err.message ?? "Could not load your venues.");
      });
  }, [userId]);

  const isMyList = selectedVenueId === MY_LIST_ID;

  // Real venues need a fetch; "My List" is derived straight from the
  // `progress` map in render below, so it stays live as quick actions
  // add/clear a status without waiting on this effect.
  useEffect(() => {
    setDanceQuery("");
    exitSelect();
    if (isMyList) return;

    setDancesLoading(true);
    setDancesError("");
    loadVenueDances(userId, selectedVenueId)
      .then((dances) => {
        setVenueDances(dances);
        setDancesLoading(false);
      })
      .catch((err) => {
        setDancesLoading(false);
        setDancesError(err.message ?? "Could not load dances for this venue.");
      });
  }, [userId, selectedVenueId, refreshKey, isMyList]);

  // Prefer the parent's fully-resolved BootStepper dance; fall back to the
  // saved snapshot until it arrives.
  const dances: { dance: Dance; songSwap?: string }[] = isMyList
    ? Object.values(progress).map((p) => ({
        dance: catalogCache[p.danceId] ?? danceFromProgress(p),
      }))
    : venueDances.map((vd) => ({
        ...vd,
        dance: catalogCache[vd.dance.id] ?? vd.dance,
      }));

  const filteredVenueDances = danceQuery.trim()
    ? dances.filter(({ dance }) =>
        [dance.name, dance.defaultSong]
          .join(" ")
          .toLowerCase()
          .includes(danceQuery.trim().toLowerCase()),
      )
    : dances;

  const canManage = isMyList && dances.length > 0;

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
      setDancesError(err.message ?? "Could not remove.");
    }
  };

  const dropdownOptions = [MY_LIST_OPTION, ...myVenues];
  const selectedVenue = dropdownOptions.find((v) => v.id === selectedVenueId);
  const filteredVenues = venueQuery.trim()
    ? dropdownOptions.filter((v) =>
        v.name.toLowerCase().includes(venueQuery.trim().toLowerCase()),
      )
    : dropdownOptions;

  const handleAddVenue = async (venue: VenueOption) => {
    setAddPickerOpen(false);
    try {
      await addUserVenue(userId, venue.id);
      setMyVenues((current) =>
        current.some((v) => v.id === venue.id)
          ? current
          : [...current, venue].sort((a, b) => a.name.localeCompare(b.name)),
      );
      setSelectedVenueId(venue.id);
      setVenueQuery("");
      setDropdownOpen(false);
    } catch (err: any) {
      setVenuesError(err.message ?? "Could not add that venue.");
    }
  };

  return (
    <>
      <ScrollView
        contentContainerStyle={[s.page, selectMode && s.pageSelecting]}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={s.heading}>My List</Text>

        <Text style={s.dropdownLabel}>MY VENUES</Text>
        <View style={s.venueRow}>
          <View style={s.dropdownWrap}>
            <Pressable
              style={s.dropdownField}
              onPress={() => setDropdownOpen((open) => !open)}
            >
              <TextInput
                value={dropdownOpen ? venueQuery : (selectedVenue?.name ?? "")}
                onChangeText={(text) => {
                  setVenueQuery(text);
                  setDropdownOpen(true);
                }}
                onFocus={() => {
                  setVenueQuery("");
                  setDropdownOpen(true);
                }}
                placeholder="Search your venues"
                placeholderTextColor={colors.muted}
                style={s.dropdownInput}
              />
              <Text style={s.caret}>{dropdownOpen ? "▴" : "▾"}</Text>
            </Pressable>

            {dropdownOpen && (
              <View style={s.dropdownList}>
                {filteredVenues.map((venue) => (
                  <Pressable
                    key={venue.id}
                    style={s.dropdownOption}
                    onPress={() => {
                      setSelectedVenueId(venue.id);
                      setVenueQuery("");
                      setDropdownOpen(false);
                    }}
                  >
                    <Text style={s.dropdownOptionText}>{venue.name}</Text>
                    {selectedVenueId === venue.id && (
                      <Text style={s.check}>✓</Text>
                    )}
                  </Pressable>
                ))}
                {!filteredVenues.length && (
                  <Text style={s.dropdownEmpty}>No matching venues.</Text>
                )}
              </View>
            )}
          </View>

          <Pressable style={s.addButton} onPress={() => setAddPickerOpen(true)}>
            <Text style={s.addButtonText}>＋</Text>
          </Pressable>
        </View>

        {venuesError ? <Text style={s.error}>{venuesError}</Text> : null}

        {venuesLoading && !myVenues.length && (
          <ActivityIndicator color={colors.gold} style={s.loader} />
        )}

        {!venuesLoading && !myVenues.length && (
          <Text style={s.hint}>
            You haven't added a specific venue yet — tap ＋ to add one. Until
            then, "My List" below has every dance you've marked from Home.
          </Text>
        )}

        <View style={s.listHead}>
          <View style={s.listHeadLeft}>
            <Text style={s.section}>
              {isMyList
                ? "YOUR DANCES"
                : `DANCES AT ${selectedVenue?.name.toUpperCase()}`}
            </Text>
            {!dancesLoading && (
              <Text style={s.listHeadCount}>
                {dances.length} {dances.length === 1 ? "dance" : "dances"}
              </Text>
            )}
          </View>
          {canManage &&
            (selectMode ? (
              <Text style={s.selectCount}>{selectedIds.size} selected</Text>
            ) : (
              <SelectToRemoveButton onPress={() => setSelectMode(true)} />
            ))}
        </View>
        {dances.length > 0 && !selectMode && (
          <TextInput
            value={danceQuery}
            onChangeText={setDanceQuery}
            placeholder="Search dances"
            placeholderTextColor={colors.muted}
            style={s.danceSearch}
          />
        )}
        {dancesError ? <Text style={s.error}>{dancesError}</Text> : null}
        {dancesLoading && (
          <ActivityIndicator color={colors.gold} style={s.loader} />
        )}
        {!dancesLoading &&
          filteredVenueDances.map(({ dance, songSwap }) => (
            <DanceCard
              key={dance.id}
              dance={dance}
              song={songSwap ? `${songSwap} (swap)` : dance.defaultSong}
              progress={progress[dance.id]}
              selected={selectMode ? selectedIds.has(dance.id) : undefined}
              onPress={
                selectMode
                  ? () => toggleSelected(dance.id)
                  : () => onOpenDance(dance)
              }
              onQuickStatus={(status) => onQuickStatus(dance, status)}
              onDelete={
                isMyList
                  ? () =>
                      removeWithConfirm(
                        [dance.id],
                        `Remove "${dance.name}" from your lists and every venue you've tagged it to?`,
                      )
                  : undefined
              }
            />
          ))}
        {!dancesLoading && !dances.length && !dancesError && (
          <Text style={s.empty}>
            {selectedVenueId === MY_LIST_ID
              ? "Nothing yet — find a dance on Home and mark it maybe/want/learned."
              : "No dances added to this venue yet — find one on Home and add it."}
          </Text>
        )}
        {!dancesLoading && dances.length > 0 && !filteredVenueDances.length && (
          <Text style={s.empty}>No dances match “{danceQuery}”.</Text>
        )}

        <VenuePicker
          visible={addPickerOpen}
          title="Add a venue"
          onSelect={handleAddVenue}
          onClose={() => setAddPickerOpen(false)}
        />
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
    </>
  );
}

const s = StyleSheet.create({
  page: {
    padding: 20,
    paddingBottom: 115,
  },
  pageSelecting: { paddingBottom: 190 },
  heading: {
    color: colors.ink,
    fontSize: 25,
    fontWeight: "900",
    marginBottom: 14,
  },
  dropdownLabel: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1,
    marginBottom: 7,
  },
  venueRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    position: "relative",
    zIndex: 100,
  },
  dropdownWrap: {
    flex: 1,
    position: "relative",
    zIndex: 100,
  },
  dropdownField: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
  },
  dropdownInput: {
    flex: 1,
    color: colors.ink,
    fontSize: 16,
    paddingVertical: 14,
  },
  caret: { color: colors.gold, fontSize: 16 },
  dropdownList: {
    position: "absolute",
    top: 54,
    left: 0,
    right: 0,
    backgroundColor: "#2b1f35",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    maxHeight: 220,
    overflow: "hidden",
    zIndex: 1000,
  },
  dropdownOption: {
    paddingVertical: 13,
    paddingHorizontal: 14,
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  dropdownOptionText: { color: colors.ink, fontSize: 15, flex: 1 },
  dropdownEmpty: {
    color: colors.muted,
    fontSize: 13,
    padding: 14,
    textAlign: "center",
  },
  check: { color: colors.gold, fontWeight: "900" },
  addButton: {
    width: 50,
    height: 50,
    borderRadius: 12,
    backgroundColor: colors.pink,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 10,
  },
  addButtonText: { color: "#fff", fontSize: 22, fontWeight: "900" },
  section: {
    color: colors.gold,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1.4,
    flexShrink: 1,
  },
  listHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 26,
    marginBottom: 8,
  },
  listHeadLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexShrink: 1,
  },
  listHeadCount: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "500",
    flexShrink: 0,
  },
  selectCount: { color: colors.muted, fontWeight: "800", fontSize: 12 },
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
  hint: { color: colors.muted, fontSize: 13, marginTop: 14, lineHeight: 19 },
  empty: { color: colors.muted, fontSize: 14, marginTop: 14, lineHeight: 20 },
  error: { color: "#ff8080", fontSize: 13, marginTop: 10 },
  loader: { marginTop: 20 },
});
