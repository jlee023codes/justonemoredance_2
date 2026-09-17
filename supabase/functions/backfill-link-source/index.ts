// supabase/functions/backfill-link-source/index.ts
//
// ONE-OFF. Not part of normal app operation — run it once, confirm the
// result, then `supabase functions delete backfill-link-source`.
//
// Classifies every existing user_dance_progress row that has a `link` but
// no `link_source` yet (i.e., everything saved before link_source existed —
// the earlier teach-video backfill included) as either 'bootstepper' or
// 'user': re-look up each distinct dance's teach video from BootStepper
// (search-by-name, exact id match — see backfill-teach-video-links, same
// approach) and compare it against what's actually stored. An exact match
// means it's (almost certainly) BootStepper's own video; anything else —
// including dances BootStepper has no video for at all — must be something
// the user added or edited themselves.
//
// Run: curl -X POST https://<project>.supabase.co/functions/v1/backfill-link-source -H "Authorization: Bearer <anon key>"

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
    .not("link", "is", null)
    .is("link_source", null);
  if (readError) return json({ error: readError.message }, 500);

  const byDance = new Map<string, string>(); // dance_id -> dance_name
  for (const row of rows ?? []) {
    if (row.dance_name) byDance.set(row.dance_id as string, row.dance_name as string);
  }
  const entries = [...byDance.entries()];

  const videoByDance: Record<string, string | undefined> = {};
  for (const batch of chunk(entries, CONCURRENCY)) {
    const results = await Promise.all(
      batch.map(([danceId, danceName]) =>
        searchTeachVideoUrl(apiKey, danceId, danceName)
          .then((url) => [danceId, url] as const)
          .catch(() => [danceId, undefined] as const),
      ),
    );
    for (const [danceId, url] of results) videoByDance[danceId] = url;
  }

  let taggedBootstepper = 0;
  let taggedUser = 0;
  for (const [danceId] of entries) {
    const teachVideoUrl = videoByDance[danceId];

    if (teachVideoUrl) {
      const { error, count } = await admin
        .from("user_dance_progress")
        .update({ link_source: "bootstepper" }, { count: "exact" })
        .eq("dance_id", danceId)
        .is("link_source", null)
        .eq("link", teachVideoUrl);
      if (!error) taggedBootstepper += count ?? 0;
    }

    // Everything else still unclassified for this dance — either
    // BootStepper has no video for it, or the stored link doesn't match
    // what BootStepper has, so it must be user-added/edited.
    const { error, count } = await admin
      .from("user_dance_progress")
      .update({ link_source: "user" }, { count: "exact" })
      .eq("dance_id", danceId)
      .is("link_source", null)
      .not("link", "is", null);
    if (!error) taggedUser += count ?? 0;
  }

  return json({
    distinctDancesChecked: entries.length,
    rowsTaggedBootstepper: taggedBootstepper,
    rowsTaggedUser: taggedUser,
  });
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
