import { supabase } from "./supabase";
import { Dance, MusicLinks } from "../types";

/**
 * Client for the BootStepper public API (https://api.bootstepper.com),
 * always called through the `bootstepper-proxy` Supabase Edge Function so
 * the API key never ships inside the app. See
 * supabase/functions/bootstepper-proxy/index.ts.
 *
 * Everything that depends on BootStepper's exact JSON field names is
 * isolated in `adaptDance` below.
 */

// Shape of a raw BootStepper dance (from a real response, Sep 2026 —
// BootStepper reserves the right to change this).
type RawSong = {
  id?: string;
  title?: string;
  artist?: string;
  spotifyTrackId?: string;
  spotifyUrl?: string;
  appleMusicUrl?: string;
  youtubeMusicUrl?: string;
  amazonMusicUrl?: string;
  // isAiGenerated deliberately not read — not useful to the app.
};

// A dance's own video, embedded directly on the dance payload — present
// when /dances/search returns it; /dances/getById seems to omit teachVideos
// for at least some dances even when videoCount says otherwise, so this
// isn't guaranteed on every endpoint (unconfirmed why).
type RawDanceVideo = {
  url?: string;
  sourceViewCount?: number;
  isPinned?: boolean;
  platform?: string;
};

type RawDance = {
  id: string;
  title: string;
  difficultyLevel?: string; // "beginner" | "improver" | "intermediate" | "advanced" | "unknown"
  counts?: number;
  walls?: number;
  tags?: number;
  restarts?: number;
  danceSongs?: { position?: number; song?: RawSong }[];
  danceChoreographers?: { choreographer?: { name?: string } }[];
  teachVideos?: RawDanceVideo[];
  // demoVideos also exists on the payload but isn't read — teachVideos is
  // the one meant for "how do I do this dance", which is what a "Watch
  // video" chip should point at.
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
      ...musicLinksFor(entry.song),
    }));
}

function choreographersFor(raw: RawDance): string[] {
  return (raw.danceChoreographers ?? [])
    .map((entry) => entry.choreographer?.name)
    .filter((name): name is string => Boolean(name));
}

function musicLinksFor(song?: RawSong): MusicLinks {
  if (!song) return {};
  return {
    spotifyTrackId: song.spotifyTrackId || undefined,
    spotifyUrl: song.spotifyUrl || undefined,
    appleMusicUrl: song.appleMusicUrl || undefined,
    youtubeMusicUrl: song.youtubeMusicUrl || undefined,
    amazonMusicUrl: song.amazonMusicUrl || undefined,
  };
}

// The pinned teach video if BootStepper has flagged one, else the
// most-viewed. Undefined when the dance has none on this payload (which
// isn't necessarily "has no video" — see the RawDanceVideo note above).
function teachVideoUrlFor(raw: RawDance): string | undefined {
  const videos = raw.teachVideos ?? [];
  if (!videos.length) return undefined;
  const pinned = videos.find((v) => v.isPinned && v.url);
  if (pinned) return pinned.url;
  const mostViewed = [...videos].sort(
    (a, b) => (b.sourceViewCount ?? 0) - (a.sourceViewCount ?? 0),
  )[0];
  return mostViewed?.url;
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
    // Primary song's streaming links (danceSongs[0] — same song defaultSong
    // is built from).
    ...musicLinksFor(raw.danceSongs?.[0]?.song),
    teachVideoUrl: teachVideoUrlFor(raw),
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

/** BootStepper's teach videos only come back on /dances/search, not
 *  /dances/getById(s) (confirmed live — see migration_link_source.sql's
 *  backfill). So a dance resolved via the by-id path (My List's own
 *  background resolver, or Venues' — anything showing a dance the viewer
 *  hasn't necessarily searched for) never gets a video that way. This
 *  fills that gap: search by name, only accept a result whose id matches
 *  the one we're after, so a similarly-named dance can't attach the wrong
 *  video. */
export async function searchTeachVideoUrl(
  danceId: string,
  danceName: string,
): Promise<string | undefined> {
  const results = await searchDances(danceName, { limit: 5 });
  return results.find((d) => d.id === danceId)?.teachVideoUrl;
}

export async function getDanceById(id: string): Promise<Dance | null> {
  const data = await callProxy<RawDance | null>("/dances/getById", { id });
  return data ? adaptDance(data) : null;
}

// Caps how many of the per-id fallback lookups below run at once. Without
// this, a My List of ~150 dances with even one stale id (the batch
// endpoint returns *nothing* if any single id is unknown — see below)
// fires 150 concurrent requests, blowing past the connection's ~100
// simultaneous-stream limit (HTTP/2 STREAMS_BLOCKED) — worst right after
// a cold start, when the edge functions being woken are all asleep at
// once. Same reasoning as the chunked writes in spotify-sync/youtube-sync.
const FALLBACK_CONCURRENCY = 8;

export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return results;
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
  // ones individually (throttled — see FALLBACK_CONCURRENCY above) and
  // just drop whatever still doesn't resolve.
  const found = new Set(resolved.map((d) => d.id));
  const missing = ids.filter((id) => !found.has(id));
  if (missing.length) {
    const singles = await mapWithConcurrency(
      missing,
      FALLBACK_CONCURRENCY,
      (id) => getDanceById(id).catch(() => null),
    );
    resolved = resolved.concat(
      singles.filter((d): d is Dance => d !== null),
    );
  }
  return resolved;
}
