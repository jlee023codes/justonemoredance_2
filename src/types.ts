export type LearningStatus = 'none' | 'maybe' | 'want' | 'learned';

// BootStepper's "commonly swapped songs" for a dance — every song beyond
// the primary one.
export type SongSwap = {
  id: string;
  songName: string;
};

/** A dance is unique by id; its display name can contain spaces. */
export type Dance = {
  id: string;
  name: string;
  defaultSong: string;
  difficulty: 'Beginner' | 'Improver' | 'Intermediate' | 'Advanced';
  details: string;
  songSwaps: SongSwap[];
  // Structural facts from BootStepper, kept as raw numbers so My List can
  // filter/sort on them (the human-readable `details` string is built from
  // these too). Undefined on snapshot dances until BootStepper resolves them.
  counts?: number;
  walls?: number;
  tags?: number;
  restarts?: number;
  // Choreographer name(s), from BootStepper. Empty for locally-made Dance
  // objects (e.g. offline fallbacks).
  choreographers?: string[];
  // True for a Dance reconstructed from a saved snapshot (a friend's
  // imported list, or a progress-row fallback) rather than fetched live
  // from BootStepper — so `details`, `choreographers` and `songSwaps` are
  // missing. App.tsx treats these as still-unresolved and upgrades them
  // from BootStepper when it can.
  snapshot?: boolean;
};

// Overall want/learned status for a dance — venue-independent. Which
// venues a dance is tied to (and any song swap at each) lives separately,
// in user_venue_dances (see src/services/venues.ts).
export type DanceProgress = {
  danceId: string;
  status: LearningStatus;
  // A friend's username when this dance was imported from their list;
  // "self" or undefined for the user's own.
  fromFriend?: string;
  // Snapshot of the BootStepper dance at the time it was saved. Used as a
  // fallback for rendering Want/Learned cards if a live re-fetch from
  // BootStepper fails (offline, dance removed upstream, etc).
  danceName?: string;
  danceSong?: string;
  danceDifficulty?: Dance['difficulty'];
  // A reference link (YouTube / TikTok / …) kept alongside the dance —
  // currently only set by the Apple Notes import.
  link?: string;
  // When this row was last written — bumped on every status change. Drives
  // the "Date added" (most-recently-updated) ordering in My List.
  updatedAt?: string;
};
