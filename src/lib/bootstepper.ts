import { supabase } from "./supabase";
import { Dance, VenueSong } from "../types";

/**
 * Client for the BootStepper public API (https://api.bootstepper.com),
 * always called through the `bootstepper-proxy` Supabase Edge Function so
 * the API key never ships inside the app. See
 * supabase/functions/bootstepper-proxy/index.ts.
 *
 * A NOTE ON FIELD NAMES: BootStepper's docs page describes *capabilities*
 * (full-text search; filter by difficulty, labels, counts, walls; sort by
 * relevance, views, favorites) but their site blocks automated fetching,
 * so I couldn't confirm the exact JSON field names of a live response.
 * Everything that depends on those names is isolated in `adaptDance`
 * below. Once you have a key, log a raw response once:
 *
 *   const raw = await searchDances("cupid"); console.log(JSON.stringify(raw));
 *
 * and adjust `RawDance` + `adaptDance` to match what actually comes back.
 */

// Confirmed shape of a raw BootStepper dance (from a real /dances/search
// response, Aug 2026 — BootStepper reserves the right to change this).
type RawDance = {
  id: string;
  title: string;
  difficultyLevel?: string; // "beginner" | "improver" | "intermediate" | "advanced" | "unknown"
  counts?: number;
  walls?: number;
  tags?: number;
  restarts?: number;
  danceSongs?: { song?: { id?: string; title?: string; artist?: string } }[];
  danceChoreographers?: { choreographer?: { name?: string } }[];
};

// Search/getByIds responses wrap results in an `items` array.
type RawListResponse<T> = {
  results?: T[];
  items?: T[];
  dances?: T[];
  total?: number;
};

async function callProxy<T>(
  path: string,
  params: Record<string, string | number | undefined> = {},
): Promise<T> {
  const stringParams: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) stringParams[key] = String(value);
  }
  const { data, error } = await supabase.functions.invoke("bootstepper-proxy", {
    body: { path, params: stringParams },
  });
  if (error) throw error;
  return data as T;
}

const KNOWN_DIFFICULTIES: Dance["difficulty"][] = [
  "Beginner",
  "Improver",
  "Intermediate",
  "Advanced",
];

function difficultyFor(raw?: string): Dance["difficulty"] {
  const match = KNOWN_DIFFICULTIES.find(
    (level) => level.toLowerCase() === (raw ?? "").toLowerCase(),
  );
  return match ?? "Beginner"; // covers BootStepper's "unknown" too
}

function songNameFor(raw: RawDance): string {
  const song = raw.danceSongs?.[0]?.song;
  if (!song) return "";
  return [song.title, song.artist].filter(Boolean).join(" — ");
}

// BootStepper's "commonly swapped songs" — every song beyond the primary
// one (danceSongs[0], already used as defaultSong).
function songSwapsFor(raw: RawDance): Dance["songSwaps"] {
  return (raw.danceSongs ?? [])
    .slice(1)
    .filter((entry) => entry.song)
    .map((entry, index) => ({
      id: entry.song!.id ?? `${raw.id}-swap-${index}`,
      songName: [entry.song!.title, entry.song!.artist]
        .filter(Boolean)
        .join(" — "),
    }));
}

function choreographersFor(raw: RawDance): string[] {
  return (raw.danceChoreographers ?? [])
    .map((entry) => entry.choreographer?.name)
    .filter((name): name is string => Boolean(name));
}

function detailsFor(raw: RawDance): string {
  const parts = [
    raw.counts ? `${raw.counts} count` : null,
    raw.walls ? `${raw.walls} wall` : null,
    raw.restarts ? `${raw.restarts} restart${raw.restarts > 1 ? "s" : ""}` : null,
    raw.tags ? `${raw.tags} tag${raw.tags > 1 ? "s" : ""}` : null,
  ].filter(Boolean) as string[];
  return parts.join(" • ");
}

/** Maps a raw BootStepper dance to the app's Dance type. venueSongs is
 *  always empty here — that's personal to each user and lives in
 *  `user_dance_progress`, not in the BootStepper catalog. songSwaps, by
 *  contrast, comes straight from BootStepper's own song list for the
 *  dance ("commonly swapped songs"). */
function adaptDance(raw: RawDance): Dance {
  return {
    id: raw.id,
    name: raw.title,
    defaultSong: songNameFor(raw),
    difficulty: difficultyFor(raw.difficultyLevel),
    details: detailsFor(raw),
    venueSongs: [] as VenueSong[],
    songSwaps: songSwapsFor(raw),
    choreographers: choreographersFor(raw),
  };
}

/** Searches BootStepper. Pass an empty query to get their default/trending
 *  ordering — used for the Home tab before the user types anything. */
export async function searchDances(
  query: string,
  opts: { searchScope?: number } = {},
): Promise<Dance[]> {
  const data = await callProxy<RawListResponse<RawDance>>("/dances/search", {
    query: query || undefined,
    limit: opts.limit ?? 25,
    sortBy: "relevance", // BootStepper's param is `sortBy`, not `sort`
  });
  const raw = data.results ?? data.items ?? data.dances ?? [];
  return raw.map(adaptDance);
}

export async function getDanceById(id: string): Promise<Dance | null> {
  const data = await callProxy<RawDance | null>("/dances/getById", { id });
  return data ? adaptDance(data) : null;
}

/** Batch fetch — used to resolve dances saved in "Want to learn" / "Learned"
 *  that aren't in the current search results. */
export async function getDancesByIds(ids: string[]): Promise<Dance[]> {
  if (!ids.length) return [];
  const data = await callProxy<RawListResponse<RawDance>>("/dances/getByIds", {
    ids: ids.join(","),
  });
  const raw = data.results ?? data.items ?? data.dances ?? [];
  return raw.map(adaptDance);
}

export async function getStepSheet(
  danceId: string,
  language?: string,
): Promise<string | null> {
  const data = await callProxy<{ steps?: string; text?: string }>(
    "/dances/getStepSheet",
    { id: danceId, language },
  );
  return data.steps ?? data.text ?? null;
}
