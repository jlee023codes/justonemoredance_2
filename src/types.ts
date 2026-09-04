export type LearningStatus = 'none' | 'maybe' | 'want' | 'learned';

// venueSongs (a catalog concept — "what song does venue X use for this
// dance") never got populated from BootStepper and is unused now that venue
// association is tracked per-user in user_venue_dances. Left in place only
// so Dance's shape doesn't change if it's reintroduced later.
export type VenueSong = {
  venueId: string;
  venueName: string;
  song: string;
};

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
  venueSongs: VenueSong[];
  songSwaps: SongSwap[];
  sharedFrom?: string;
  // Choreographer name(s), from BootStepper. Empty for locally-made Dance
  // objects (e.g. the sample friend dance, or offline fallbacks).
  choreographers?: string[];
};

// Overall want/learned status for a dance — venue-independent. Which
// venues a dance is tied to (and any song swap at each) lives separately,
// in user_venue_dances (see src/services/venues.ts).
export type DanceProgress = {
  danceId: string;
  status: LearningStatus;
  fromFriend?: string; //boolean;
  // Snapshot of the BootStepper dance at the time it was saved. Used as a
  // fallback for rendering Want/Learned cards if a live re-fetch from
  // BootStepper fails (offline, dance removed upstream, etc).
  danceName?: string;
  danceSong?: string;
  danceDifficulty?: Dance['difficulty'];
};
