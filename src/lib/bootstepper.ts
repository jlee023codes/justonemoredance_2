import { supabase } from "./supabase";
import { Dance } from "../types";

/**
 * Client for the BootStepper public API (https://api.bootstepper.com),
 * always called through the `bootstepper-proxy` Supabase Edge Function so
 * the API key never ships inside the app. See
 * supabase/functions/bootstepper-proxy/index.ts.
 *
 * Everything that depends on BootStepper's exact JSON field names is
 * isolated in `adaptDance` below.
 */

// Shape of a raw BootStepper dance (from a real response, Aug 2026 —
// BootStepper reserves the right to change this).
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

// /dances/search wraps results in `{ items: [...] }`; /dances/getByIds
// returns a bare array. `unwrapList` normalises both.
type RawListResponse<T> = {
  results?: T[];
  items?: T[];
  dances?: T[];
};

// A non-2xx from the Edge Function comes back as a generic
// "Edge Function returned a non-2xx status code" — the useful detail (our
// proxy's `{ error: "..." }`, the upstream status) is on `error.context`,
// the raw Response. Pull it out so failures are diagnosable.
async function describeFunctionError(error: any): Promise<string> {
  const base = error?.message ?? "Unknown error";
  const ctx = error?.context;
  try {
    if (ctx && typeof ctx.text === "function") {
      const body = (await ctx.text())?.trim();
      if (body) {
        let detail = body;
        try {
          detail = JSON.parse(body)?.error ?? body;
        } catch {
          /* not JSON — use the raw text */
        }
        const status = ctx.status ? ` (HTTP ${ctx.status})` : "";
        return `${detail}${status}`;
      }
      if (ctx.status) return `${base} (HTTP ${ctx.status})`;
    }
  } catch {
    /* fall through to base */
  }
  return base;
}

async function callProxy<T>(
  path: string,
  params: Record<string, string | number | undefined> = {},
): Promise<T> {
  const stringParams: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) stringParams[key] = String(value);
  }

  // The proxy requires a signed-in user. functions.invoke reuses whatever
  // access token the client last cached, which can be stale after the tab
  // sat idle / went offline; getSession() refreshes an expired one first,
  // and we pass the token explicitly so there's no propagation race.
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    throw new Error("You're signed out — sign in again to load dances.");
  }

  const { data, error } = await supabase.functions.invoke("bootstepper-proxy", {
    body: { path, params: stringParams },
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  if (error) {
    // BootStepper answers 200 with an *empty body* for a lookup that
    // matches nothing (e.g. getById / getByIds with an id it doesn't
    // know). supabase-js can't parse that and surfaces it here as a JSON
    // error — treat it as "no result", not a hard failure.
    if (/JSON|Unexpected end of (JSON )?input/i.test(error.message ?? "")) {
      return null as T;
    }
    throw new Error(await describeFunctionError(error));
  }
  return (data ?? null) as T;
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

/** Maps a raw BootStepper dance to the app's Dance type. */
function adaptDance(raw: RawDance): Dance {
  return {
    id: raw.id,
    name: raw.title,
    defaultSong: songNameFor(raw),
    difficulty: difficultyFor(raw.difficultyLevel),
    details: detailsFor(raw),
    counts: raw.counts,
    walls: raw.walls,
    tags: raw.tags,
    restarts: raw.restarts,
    songSwaps: songSwapsFor(raw),
    choreographers: choreographersFor(raw),
  };
}

/** Searches BootStepper. Pass an empty query to get their default/trending
 *  ordering — used for the Home tab before the user types anything. */
// BootStepper isn't consistent about envelopes: /dances/search wraps
// results in `{ items: [...] }`, but /dances/getByIds returns a bare
// array. Accept either shape everywhere.
function unwrapList<T>(data: RawListResponse<T> | T[] | null): T[] {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  return data.results ?? data.items ?? data.dances ?? [];
}

export async function searchDances(
  query: string,
  opts: { limit?: number } = {},
): Promise<Dance[]> {
  const data = await callProxy<RawListResponse<RawDance> | null>(
    "/dances/search",
    {
      query: query || undefined,
      limit: opts.limit ?? 25,
      sortBy: "relevance", // BootStepper's param is `sortBy`, not `sort`
    },
  );
  return unwrapList(data).map(adaptDance);
}

export async function getDanceById(id: string): Promise<Dance | null> {
  const data = await callProxy<RawDance | null>("/dances/getById", { id });
  return data ? adaptDance(data) : null;
}

/** Batch fetch — used to resolve dances saved in "Want to learn" / "Learned"
 *  that aren't in the current search results. */
export async function getDancesByIds(ids: string[]): Promise<Dance[]> {
  if (!ids.length) return [];

  let resolved: Dance[] = [];
  try {
    const data = await callProxy<RawListResponse<RawDance> | RawDance[] | null>(
      "/dances/getByIds",
      { ids: ids.join(",") },
    );
    resolved = unwrapList(data).map(adaptDance);
  } catch {
    // Fall through to per-id lookups below.
  }

  // The batch endpoint returns *nothing* (empty body) if even one id is
  // unknown, so a single stale id — an old friend sample, a dance deleted
  // upstream — would otherwise sink the whole request. Retry the missing
  // ones individually and just drop whatever still doesn't resolve.
  const found = new Set(resolved.map((d) => d.id));
  const missing = ids.filter((id) => !found.has(id));
  if (missing.length) {
    const singles = await Promise.all(
      missing.map((id) => getDanceById(id).catch(() => null)),
    );
    resolved = resolved.concat(
      singles.filter((d): d is Dance => d !== null),
    );
  }
  return resolved;
}
