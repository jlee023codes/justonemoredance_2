export type LearningStatus = 'none' | 'want' | 'learned';

export type VenueSong = {
  venueId: string;
  venueName: string;
  song: string;
};

export type SongSwap = {
  id: string;
  songName: string;
  venueId: string;
  venueName: string;
};

/** A dance is unique by id; its display name can contain spaces. */
export type Dance = {
  id: string;
  name: string;
  defaultSong: string;
  difficulty: 'Beginner' | 'Improver' | 'Intermediate' | 'Advanced';
  details?: string;
  venueSongs: VenueSong[];
  songSwaps: SongSwap[];
};

export type DanceProgress = {
  danceId: string;
  status: LearningStatus;
  personalVenueId?: string;
  personalSongSwap?: string;
  fromFriend?: boolean;
};
