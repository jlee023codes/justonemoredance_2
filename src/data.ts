import { Dance } from "./types";

export const dances: Dance[] = [
  {
    id: "a-bar-song",
    name: "A Bar Song",
    defaultSong: "A Bar Song (Tipsy) — Shaboozey",
    difficulty: "Beginner",
    details: "32 count • 4 wall",
    venueSongs: [
      {
        venueId: "cancun-cantina",
        venueName: "Cancun Cantina",
        song: "A Bar Song (Tipsy) — Shaboozey",
      },
    ],
    songSwaps: [],
  },
  {
    id: "walk-the-line",
    name: "Walk the Line",
    defaultSong: "Freight Train",
    difficulty: "Improver",
    details: "26 count • 2 wall",
    venueSongs: [
      {
        venueId: "cancun-cantina",
        venueName: "Cancun Cantina",
        song: "Freight Train",
      },
    ],
    songSwaps: [
      {
        id: "chs-1",
        songName: "Sin Wagon",
        venueId: "neon-boots",
        venueName: "Neon Boots",
      },
    ],
  },
  {
    id: "domino",
    name: "Domino",
    difficulty: "Intermediate",
    defaultSong: "Domino — Jessie J",

    details: "64 count • 4 wall • 1 restart ",
    venueSongs: [
      {
        venueId: "cancun-cantina",
        venueName: "Cancun Cantina",
        song: "Domino - Jessie J",
      },
    ],
    songSwaps: [],
  },
  {
    id: "red-high-heels",
    name: "Red High Heels",
    difficulty: "Beginner",
    defaultSong: "Red High Heels - Kellie Pickler.",
    details: "32 count • 4 walls ",
    venueSongs: [
      {
        venueId: "cancun-cantina",
        venueName: "Cancun Cantina",
        song: "Kerosene by Miranda Lambert",
      },
    ],
    songSwaps: [],
  },
  {
    id: "redneck-angel",
    name: "Redneck Angel",
    defaultSong: "Redneck Angel - Dean Crawford & the Dunn's River band",
    difficulty: "Beginner",
    details: "16 count • 4 walls ",

    venueSongs: [
      {
        venueId: "cancun-cantina",
        venueName: "Cancun Cantina",
        song: "T-Pain Ft. B.o.B - Up Down Morgan Wallen - Im The Problem",
      },
      {
        venueId: "neon-boots",
        venueName: "Neon Boots",
        song: "Like Jennie",
      },
    ],
    songSwaps: [],
  },
  {
    id: "electric-slide",
    name: "Electric Slide",
    defaultSong: "Electric Boogie — Marcia Griffiths",
    difficulty: "Beginner",
    details: "18-count + 4-wall",
    venueSongs: [
      {
        venueId: "starlight",
        venueName: "Starlight Saloon",
        song: "Electric Boogie — Marcia Griffiths",
      },
    ],
    songSwaps: [],
  },
  {
    id: "watermelon-crawl",
    name: "Watermelon Crawl",
    defaultSong: "Watermelon Crawl — Tracy Byrd",
    difficulty: "Beginner",
    details: "32-count, 4-wall country favorite with heel steps.",
    venueSongs: [
      {
        venueId: "boot-scoot",
        venueName: "Boot Scoot Social",
        song: "Watermelon Crawl — Tracy Byrd",
      },
    ],
    songSwaps: [],
  },
  {
    id: "copperhead-road",
    name: "Copperhead Road",
    defaultSong: "Copperhead Road — Steve Earle",
    difficulty: "Improver",
    details: "32-count, 4-wall energetic stomp and kick dance.",
    venueSongs: [
      {
        venueId: "copper",
        venueName: "The Copper Room",
        song: "Copperhead Road — Steve Earle",
      },
    ],
    songSwaps: [
      {
        id: "chs-1",
        songName:
          "Sold (The Grundy County Auction Incident) — John Michael Montgomery",
        venueId: "boot-scoot",
        venueName: "Boot Scoot Social",
      },
    ],
  },
  {
    id: "shivers",
    name: "Shivers",
    defaultSong: "Shivers — Ed Sheeran",
    difficulty: "Intermediate",
    details: "32-count, 4-wall dance with lively syncopated turns.",
    venueSongs: [
      {
        venueId: "starlight",
        venueName: "Starlight Saloon",
        song: "Shivers — Ed Sheeran",
      },
    ],
    songSwaps: [],
  },
  {
    id: "footloose",
    name: "Footloose",
    defaultSong: "Footloose — Kenny Loggins",
    difficulty: "Improver",
    details: "32-count, 4-wall party-starter with grapevines and kicks.",
    venueSongs: [],
    songSwaps: [],
  },
];

/** Derived from venue-specific songs and swaps in the dance catalog. */
export const venues = [
  { id: "anywhere", name: "Everywhere" },
  ...Array.from(
    new Map(
      dances
        .flatMap((dance) => [
          ...dance.venueSongs.map(({ venueId, venueName }) => [venueId, venueName] as const),
          ...dance.songSwaps.map(({ venueId, venueName }) => venueId ? [venueId, venueName] as const : null),
        ])
        .filter((venue): venue is readonly [string, string] => venue !== null),
    ).entries(),
  )
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name)),
];
