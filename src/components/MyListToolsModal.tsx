import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { colors } from "../styles";
import { Dance } from "../types";
import { VenueOption } from "../services/venues";
import {
  CountBucket,
  EMPTY_FILTERS,
  MyListFilters,
  MyListSort,
  SORT_DIR_LABELS,
  SORT_LABELS,
  SortKey,
  TagsFilter,
  WallFilter,
  activeFilterCount,
} from "../lib/danceListView";

const DIFFICULTIES: Dance["difficulty"][] = [
  "Beginner",
  "Improver",
  "Intermediate",
  "Advanced",
];
const SORT_KEYS: SortKey[] = [
  "dateAdded",
  "dateUpdated",
  "danceName",
  "songName",
  "difficulty",
  "counts",
  "choreographer",
];
const COUNT_OPTIONS: { value: CountBucket; label: string }[] = [
  { value: "eq32", label: "32 counts only" },
  { value: "lt32", label: "Less than 32" },
  { value: "gt32", label: "More than 32" },
];

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value)
    ? list.filter((v) => v !== value)
    : [...list, value];
}

function Chip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={[s.chip, active && s.chipOn]}
      onPress={onPress}
      hitSlop={4}
    >
      <Text style={[s.chipText, active && s.chipTextOn]}>{label}</Text>
    </Pressable>
  );
}

export function MyListToolsModal({
  visible,
  onClose,
  filters,
  sort,
  userVenues,
  onFiltersChange,
  onSortChange,
}: {
  visible: boolean;
  onClose: () => void;
  filters: MyListFilters;
  sort: MyListSort;
  userVenues: VenueOption[];
  onFiltersChange: (next: MyListFilters) => void;
  onSortChange: (next: MyListSort) => void;
}) {
  const patch = (part: Partial<MyListFilters>) =>
    onFiltersChange({ ...filters, ...part });

  const pickSort = (key: SortKey) => {
    if (sort.key === key) {
      onSortChange({ key, dir: sort.dir === "asc" ? "desc" : "asc" });
    } else {
      // Sensible default direction per key: newest / hardest / most first.
      const dir =
        key === "dateAdded" ||
        key === "dateUpdated" ||
        key === "difficulty" ||
        key === "counts"
          ? "desc"
          : "asc";
      onSortChange({ key, dir });
    }
  };

  const hasAny =
    activeFilterCount(filters) > 0 ||
    filters.statuses.length > 0 ||
    sort.key !== "dateAdded" ||
    sort.dir !== "desc";

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={s.overlay}>
        <View style={s.sheet}>
          <View style={s.headerRow}>
            <Text style={s.title}>Filter &amp; sort</Text>
            {hasAny && (
              <Pressable
                onPress={() => {
                  onFiltersChange({ ...EMPTY_FILTERS });
                  onSortChange({ key: "dateAdded", dir: "desc" });
                }}
                hitSlop={8}
              >
                <Text style={s.clear}>Clear all</Text>
              </Pressable>
            )}
          </View>

          <ScrollView
            style={s.body}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <Text style={s.section}>SORT BY</Text>
            {SORT_KEYS.map((key) => {
              const active = sort.key === key;
              return (
                <Pressable
                  key={key}
                  style={[s.sortRow, active && s.sortRowOn]}
                  onPress={() => pickSort(key)}
                >
                  <Text style={[s.sortLabel, active && s.sortLabelOn]}>
                    {SORT_LABELS[key]}
                  </Text>
                  <Text style={[s.sortDir, active && s.sortDirOn]}>
                    {active
                      ? `${SORT_DIR_LABELS[key][sort.dir]}  ${
                          sort.dir === "asc" ? "▲" : "▼"
                        }`
                      : ""}
                  </Text>
                </Pressable>
              );
            })}

            <Text style={s.section}>VENUE</Text>
            {userVenues.length ? (
              <View style={s.chipWrap}>
                {userVenues.map((venue) => (
                  <Chip
                    key={venue.id}
                    label={venue.name}
                    active={filters.venueIds.includes(venue.id)}
                    onPress={() =>
                      patch({ venueIds: toggle(filters.venueIds, venue.id) })
                    }
                  />
                ))}
              </View>
            ) : (
              <Text style={s.hint}>
                No venues yet — add one in Profile → My Venues.
              </Text>
            )}
            <Text style={s.hint}>
              Add or remove venues in Profile → My Venues.
            </Text>

            <Text style={s.section}>DIFFICULTY</Text>
            <View style={s.chipWrap}>
              {DIFFICULTIES.map((level) => (
                <Chip
                  key={level}
                  label={level}
                  active={filters.difficulties.includes(level)}
                  onPress={() =>
                    patch({
                      difficulties: toggle(filters.difficulties, level),
                    })
                  }
                />
              ))}
            </View>

            <Text style={s.section}>COUNTS</Text>
            <View style={s.chipWrap}>
              {COUNT_OPTIONS.map((opt) => (
                <Chip
                  key={opt.value}
                  label={opt.label}
                  active={filters.counts.includes(opt.value)}
                  onPress={() =>
                    patch({ counts: toggle(filters.counts, opt.value) })
                  }
                />
              ))}
            </View>

            <Text style={s.section}>WALLS</Text>
            <View style={s.chipWrap}>
              {([2, 4] as WallFilter[]).map((n) => (
                <Chip
                  key={n}
                  label={`${n} wall`}
                  active={filters.walls.includes(n)}
                  onPress={() => patch({ walls: toggle(filters.walls, n) })}
                />
              ))}
            </View>

            <Text style={s.section}>TAGS</Text>
            <View style={s.chipWrap}>
              {(
                [
                  ["has", "Has tags"],
                  ["none", "No tags"],
                ] as [TagsFilter, string][]
              ).map(([value, label]) => (
                <Chip
                  key={value}
                  label={label}
                  active={filters.tags.includes(value)}
                  onPress={() => patch({ tags: toggle(filters.tags, value) })}
                />
              ))}
            </View>

            <Text style={s.section}>VIDEO</Text>
            <View style={s.chipWrap}>
              <Chip
                label="Has a video"
                active={filters.hasVideo}
                onPress={() => patch({ hasVideo: !filters.hasVideo })}
              />
            </View>
          </ScrollView>

          <Pressable style={s.done} onPress={onClose}>
            <Text style={s.doneText}>Done</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "#000000aa", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: "#2b1f35",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 24,
    paddingBottom: 30,
    maxHeight: "86%",
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  title: { color: colors.ink, fontSize: 22, fontWeight: "900" },
  clear: { color: colors.pink, fontWeight: "800", fontSize: 13 },
  body: { flexGrow: 0 },
  section: {
    color: colors.gold,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.2,
    marginTop: 20,
    marginBottom: 9,
  },
  sortRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.line,
    marginBottom: 7,
  },
  sortRowOn: { borderColor: colors.pink, backgroundColor: "#3a1f30" },
  sortLabel: { color: colors.muted, fontSize: 14, fontWeight: "700" },
  sortLabelOn: { color: colors.ink },
  sortDir: { color: colors.muted, fontSize: 12, fontWeight: "700" },
  sortDirOn: { color: colors.pink },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  chipOn: { borderColor: colors.pink, backgroundColor: "#3a1f30" },
  chipText: { color: colors.muted, fontSize: 13, fontWeight: "700" },
  chipTextOn: { color: colors.pink },
  hint: { color: colors.muted, fontSize: 12, marginTop: 8, lineHeight: 17 },
  done: {
    backgroundColor: colors.pink,
    borderRadius: 12,
    padding: 15,
    alignItems: "center",
    marginTop: 18,
  },
  doneText: { color: "#fff", fontWeight: "900", fontSize: 15 },
});
