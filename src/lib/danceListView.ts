import { Dance, DanceProgress, LearningStatus } from "../types";

// All of the "what shows in My List, in what order" logic, kept pure so the
// screen just renders whatever `buildMyList` returns.

export type StatusFilter = Exclude<LearningStatus, "none">; // maybe | want | learned
export type CountBucket = "eq32" | "lt32" | "gt32";
export type WallFilter = 2 | 4;
export type TagsFilter = "has" | "none";

export type SortKey =
  | "danceName"
  | "songName"
  | "difficulty"
  | "counts"
  | "choreographer"
  | "dateAdded";

export type MyListSort = { key: SortKey; dir: "asc" | "desc" };

export type MyListFilters = {
  // Quick-filter chips. Empty = every status.
  statuses: StatusFilter[];
  // Venue ids. Empty = no venue restriction.
  venueIds: string[];
  difficulties: Dance["difficulty"][];
  counts: CountBucket[];
  walls: WallFilter[];
  tags: TagsFilter[];
  hasVideo: boolean;
};

export type MyListRow = {
  dance: Dance;
  progress?: DanceProgress;
  venueIds: string[];
};

export const EMPTY_FILTERS: MyListFilters = {
  statuses: [],
  venueIds: [],
  difficulties: [],
  counts: [],
  walls: [],
  tags: [],
  hasVideo: false,
};

export const DEFAULT_SORT: MyListSort = { key: "dateAdded", dir: "desc" };

export const SORT_LABELS: Record<SortKey, string> = {
  danceName: "Dance name",
  songName: "Song name",
  difficulty: "Difficulty",
  counts: "Counts",
  choreographer: "Choreographer",
  dateAdded: "Date added",
};

// Ascending direction reads differently per key — spell it out so the
// modal can show "Beginner → Advanced" instead of a bare "Asc".
export const SORT_DIR_LABELS: Record<SortKey, { asc: string; desc: string }> = {
  danceName: { asc: "A → Z", desc: "Z → A" },
  songName: { asc: "A → Z", desc: "Z → A" },
  difficulty: { asc: "Beginner → Advanced", desc: "Advanced → Beginner" },
  counts: { asc: "Fewest → most", desc: "Most → fewest" },
  choreographer: { asc: "A → Z", desc: "Z → A" },
  dateAdded: { asc: "Oldest first", desc: "Newest first" },
};

const DIFFICULTY_RANK: Record<Dance["difficulty"], number> = {
  Beginner: 0,
  Improver: 1,
  Intermediate: 2,
  Advanced: 3,
};

export function activeFilterCount(f: MyListFilters): number {
  return (
    (f.venueIds.length ? 1 : 0) +
    (f.difficulties.length ? 1 : 0) +
    (f.counts.length ? 1 : 0) +
    (f.walls.length ? 1 : 0) +
    (f.tags.length ? 1 : 0) +
    (f.hasVideo ? 1 : 0)
  );
}

// Strip everything but letters/numbers so "TGIF" matches "T.G.I.F." and
// "bar song" matches "A Bar Song".
const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

function matchesSearch(dance: Dance, needle: string): boolean {
  if (!needle) return true;
  const haystack = [
    dance.name,
    dance.defaultSong,
    (dance.choreographers ?? []).join(" "),
  ]
    .join(" ")
    .toLowerCase();
  if (haystack.includes(needle)) return true;
  const squashed = squash(needle);
  return squashed.length > 0 && squash(haystack).includes(squashed);
}

function matchesCounts(counts: number | undefined, buckets: CountBucket[]) {
  if (!buckets.length) return true;
  if (counts == null) return false;
  return buckets.some((b) =>
    b === "eq32" ? counts === 32 : b === "lt32" ? counts < 32 : counts > 32,
  );
}

function matchesFilters(row: MyListRow, f: MyListFilters): boolean {
  const { dance, progress } = row;

  if (f.statuses.length) {
    const status = progress?.status;
    if (!status || !f.statuses.includes(status as StatusFilter)) return false;
  }
  if (f.venueIds.length && !f.venueIds.some((id) => row.venueIds.includes(id))) {
    return false;
  }
  if (f.difficulties.length && !f.difficulties.includes(dance.difficulty)) {
    return false;
  }
  if (!matchesCounts(dance.counts, f.counts)) return false;
  if (f.walls.length && !f.walls.includes(dance.walls as WallFilter)) {
    return false;
  }
  if (f.tags.length) {
    const has = (dance.tags ?? 0) > 0;
    const ok = f.tags.some((t) => (t === "has" ? has : !has));
    if (!ok) return false;
  }
  if (f.hasVideo && !progress?.link) return false;

  return true;
}

// Returns a comparable value for a row under `key`; `null` means "missing,
// sort last regardless of direction".
function sortValue(row: MyListRow, key: SortKey): string | number | null {
  const { dance, progress } = row;
  switch (key) {
    case "danceName":
      return dance.name?.toLowerCase() ?? null;
    case "songName":
      return dance.defaultSong?.toLowerCase() || null;
    case "difficulty":
      return DIFFICULTY_RANK[dance.difficulty] ?? null;
    case "counts":
      return dance.counts ?? null;
    case "choreographer":
      return (dance.choreographers ?? [])[0]?.toLowerCase() || null;
    case "dateAdded":
      return progress?.updatedAt ? Date.parse(progress.updatedAt) : null;
  }
}

function compare(a: string | number | null, b: string | number | null): number {
  if (a === b) return 0;
  if (a === null) return 1; // missing always last
  if (b === null) return -1;
  if (typeof a === "string" && typeof b === "string") return a.localeCompare(b);
  return (a as number) - (b as number);
}

export function buildMyList(
  rows: MyListRow[],
  opts: { search?: string; filters: MyListFilters; sort: MyListSort },
): MyListRow[] {
  const needle = (opts.search ?? "").trim().toLowerCase();
  const { filters, sort } = opts;

  const filtered = rows.filter(
    (row) => matchesSearch(row.dance, needle) && matchesFilters(row, filters),
  );

  const dirMul = sort.dir === "asc" ? 1 : -1;
  return filtered.sort((ra, rb) => {
    const primary = compare(sortValue(ra, sort.key), sortValue(rb, sort.key));
    if (primary !== 0) {
      // Missing values (compare returned ±1 with a null operand) stay last no
      // matter the direction; real comparisons flip with `dir`.
      const aMissing = sortValue(ra, sort.key) === null;
      const bMissing = sortValue(rb, sort.key) === null;
      if (aMissing || bMissing) return primary;
      return primary * dirMul;
    }
    // Tiebreak: most recently updated first.
    const ta = sortValue(ra, "dateAdded");
    const tb = sortValue(rb, "dateAdded");
    return compare(tb, ta);
  });
}
