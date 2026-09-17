// supabase/functions/backfill-teach-video-links/index.ts
//
// ONE-OFF. Not part of normal app operation — run it once, confirm the
// result, then `supabase functions delete backfill-teach-video-links`.
//
// Fills in user_dance_progress.link (for every user, every dance) from
// BootStepper's own teach video, but ONLY where link is still null — never
// overwrites a link a user (or the Apple Notes import) already set. Going
// forward, new dances seed this at add-time instead (see handleQuickStatus
// in App.tsx); this is purely to backfill everything added before that
// existed.
//
// IMPORTANT: /dances/getByIds does NOT return teachVideos (confirmed live —
// 0/332 found on the first run of this function). Only /dances/search
// does. So this searches by each dance's saved name and only accepts a
// result whose id matches the dance_id we're looking for, to avoid
// grabbing a different, similarly-named dance.
//
// Run: curl -X POST https://<project>.supabase.co/functions/v1/backfill-teach-video-links -H "Authorization: Bearer <anon key>"

import { createClient } from "jsr:@supabase/supabase-js@2";

const BOOTSTEPPER_BASE = "https://api.bootstepper.com";
const CONCURRENCY = 8;

type RawDanceVideo = { url?: string; sourceViewCount?: number; isPinned?: boolean };
type RawDance = { id: string; teachVideos?: RawDanceVideo[] };

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

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function searchTeachVideoUrl(
  apiKey: string,
  danceId: string,
  danceName: string,
): Promise<string | undefined> {
  const url = new URL(`${BOOTSTEPPER_BASE}/dances/search`);
  url.searchParams.set("query", danceName);
  url.searchParams.set("limit", "5");
  const resp = await fetch(url, { headers: { "X-BootStepper-API-Key": apiKey } });
  if (!resp.ok) return undefined;
  const data = await resp.json();
  const dances: RawDance[] = Array.isArray(data)
    ? data
    : (data?.results ?? data?.items ?? data?.dances ?? []);
  // Only accept an exact id match — a name search can surface similarly
  // named dances, and we don't want to attach the wrong video.
  const match = dances.find((d) => d.id === danceId);
  return match ? teachVideoUrlFor(match) : undefined;
}

Deno.serve(async (_req: Request) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const apiKey = Deno.env.get("BOOTSTEPPER_API_KEY");
  if (!supabaseUrl || !serviceRoleKey || !apiKey) {
    return json({ error: "Server misconfiguration: missing env vars" }, 500);
  }
  const admin = createClient(supabaseUrl, serviceRoleKey);

  const { data: rows, error: readError } = await admin
    .from("user_dance_progress")
    .select("dance_id,dance_name")
    .is("link", null);
  if (readError) return json({ error: readError.message }, 500);

  const byDance = new Map<string, string>(); // dance_id -> dance_name
  for (const row of rows ?? []) {
    if (row.dance_name) byDance.set(row.dance_id as string, row.dance_name as string);
  }
  const entries = [...byDance.entries()];

  const videoByDance: Record<string, string> = {};
  for (const batch of chunk(entries, CONCURRENCY)) {
    const results = await Promise.all(
      batch.map(([danceId, danceName]) =>
        searchTeachVideoUrl(apiKey, danceId, danceName)
          .then((url) => [danceId, url] as const)
          .catch(() => [danceId, undefined] as const),
      ),
    );
    for (const [danceId, url] of results) {
      if (url) videoByDance[danceId] = url;
    }
  }

  let updatedRows = 0;
  for (const [danceId, teachVideoUrl] of Object.entries(videoByDance)) {
    const { error, count } = await admin
      .from("user_dance_progress")
      .update({ link: teachVideoUrl }, { count: "exact" })
      .eq("dance_id", danceId)
      .is("link", null);
    if (!error) updatedRows += count ?? 0;
  }

  return json({
    distinctDancesMissingLink: entries.length,
    dancesWithVideoFound: Object.keys(videoByDance).length,
    rowsUpdated: updatedRows,
  });
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
