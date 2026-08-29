import { Dance } from './types';

export const venues = [
  { id: 'anywhere', name: 'Everywhere' },
  { id: 'starlight', name: 'Starlight Saloon' },
  { id: 'boot-scoot', name: 'Boot Scoot Social' },
  { id: 'copper', name: 'The Copper Room' },
];

export const dances: Dance[] = [
  { id: 'electric-slide', name: 'Electric Slide', defaultSong: 'Electric Boogie — Marcia Griffiths', difficulty: 'Beginner', details: 'A classic 18-count, 4-wall social line dance.', venueSongs: [{ venueId: 'starlight', venueName: 'Starlight Saloon', song: 'Electric Boogie — Marcia Griffiths' }], songSwaps: [] },
  { id: 'watermelon-crawl', name: 'Watermelon Crawl', defaultSong: 'Watermelon Crawl — Tracy Byrd', difficulty: 'Beginner', details: '32-count, 4-wall country favorite with heel steps.', venueSongs: [{ venueId: 'boot-scoot', venueName: 'Boot Scoot Social', song: 'Watermelon Crawl — Tracy Byrd' }], songSwaps: [] },
  { id: 'copperhead-road', name: 'Copperhead Road', defaultSong: 'Copperhead Road — Steve Earle', difficulty: 'Improver', details: '32-count, 4-wall energetic stomp and kick dance.', venueSongs: [{ venueId: 'copper', venueName: 'The Copper Room', song: 'Copperhead Road — Steve Earle' }], songSwaps: [{ id: 'chs-1', songName: 'Sold (The Grundy County Auction Incident) — John Michael Montgomery', venueId: 'boot-scoot', venueName: 'Boot Scoot Social' }] },
  { id: 'shivers', name: 'Shivers', defaultSong: 'Shivers — Ed Sheeran', difficulty: 'Intermediate', details: '32-count, 4-wall dance with lively syncopated turns.', venueSongs: [{ venueId: 'starlight', venueName: 'Starlight Saloon', song: 'Shivers — Ed Sheeran' }], songSwaps: [] },
  { id: 'footloose', name: 'Footloose', defaultSong: 'Footloose — Kenny Loggins', difficulty: 'Improver', details: '32-count, 4-wall party-starter with grapevines and kicks.', venueSongs: [], songSwaps: [] },
];
