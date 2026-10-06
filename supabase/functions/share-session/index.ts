// supabase/functions/share-session/index.ts
//
// Renders a public, read-only HTML page for one shared dance session —
// justonemoredance.com/s/<token>, proxied here by worker.ts (see repo
// root). No auth check: this is the one deliberately public,
// unauthenticated endpoint in the app. The session_shares table (see
// migration_session_shares.sql) maps an unguessable token to exactly
// one venue_checkins row; the service-role key below bypasses RLS,
// but only ever to fetch that single looked-up row — no other table
// or row becomes reachable through this function, and no RLS policy
// anywhere else in the app grants anonymous read access.
//
// Deploy (note --no-verify-jwt — required every time, or Supabase's
// gateway rejects every request with UNAUTHORIZED_NO_AUTH_HEADER
// before it ever reaches this code, since a public link visitor has
// no Supabase session/JWT to send):
//   supabase functions deploy share-session --no-verify-jwt
// No extra secrets to set — SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
// are auto-injected into every Edge Function (same as delete-account,
// spotify-sync, etc.). This deliberately uses the service-role key,
// never the anon key, since it must bypass RLS to read someone
// else's session by token.

import { createClient } from "jsr:@supabase/supabase-js@2";

type LoggedDance = {
  danceId: string;
  name: string;
  song: string;
  details: string | null;
  difficulty: "Beginner" | "Improver" | "Intermediate" | "Advanced" | null;
  danced?: boolean;
};

const DIFFICULTY_COLOR: Record<string, string> = {
  Beginner: "#77d9a4",
  Improver: "#ffc75a",
  Intermediate: "#ff4e9b",
  Advanced: "#ff4e9b",
};

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const token = url.pathname.split("/").filter(Boolean).pop() ?? "";
  if (!token) return html(notFoundPage(), 404);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return html(errorPage(), 500);

  const supabase = createClient(supabaseUrl, serviceKey);

  const { data: share } = await supabase
    .from("session_shares")
    .select("checkin_id")
    .eq("token", token)
    .maybeSingle();
  if (!share) return html(notFoundPage(), 404);

  const { data: checkin } = await supabase
    .from("venue_checkins")
    .select(
      "venue_id,checked_in_at,ended_at,paused_seconds,step_count,logged_dances,live_danced_count,live_total_count",
    )
    .eq("id", share.checkin_id)
    .maybeSingle();
  if (!checkin) return html(notFoundPage(), 404);

  const { data: venue } = await supabase
    .from("venues")
    .select("name")
    .eq("id", checkin.venue_id)
    .maybeSingle();

  return html(renderSessionPage(venue?.name ?? "Unknown venue", checkin));
});

function html(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function pageShell(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="icon" href="/favicon.ico">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Unbounded:wght@700;800;900&family=Manrope:wght@500;600;700;800&display=swap">
<style>
  :root {
    --bg: #16101d; --card: #241b2d; --ink: #fff8ee; --muted: #c9bacd;
    --pink: #ff4e9b; --gold: #ffc75a; --line: #43364d; --green: #77d9a4;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; }
  body {
    background: var(--bg); color: var(--ink);
    font-family: 'Manrope', sans-serif; line-height: 1.5;
    -webkit-font-smoothing: antialiased;
  }
  .wrap { max-width: 560px; margin-inline: auto; padding: 24px 20px 60px; }
  h1 { font-family: 'Unbounded', sans-serif; font-size: 22px; margin: 0 0 4px; }
  .sub { color: var(--muted); font-size: 13px; margin: 0 0 20px; }
  .card {
    background: var(--card); border: 1px solid var(--line);
    border-radius: 16px; padding: 18px; margin-bottom: 16px;
  }
  .stats-row { display: flex; gap: 24px; flex-wrap: wrap; }
  .stat-value { color: var(--gold); font-size: 18px; font-weight: 900; }
  .stat-value.muted { color: var(--muted); font-size: 14px; }
  .stat-label { color: var(--muted); font-size: 11px; margin-top: 2px; }
  .percent-pill {
    background: var(--bg); border: 1px solid var(--line); border-radius: 10px;
    padding: 10px 12px; margin-top: 14px; color: var(--gold);
    font-size: 12.5px; font-weight: 700;
  }
  .difficulty-row { display: flex; align-items: center; gap: 8px; margin-top: 8px; font-size: 13px; }
  .difficulty-dot { width: 10px; height: 10px; border-radius: 5px; flex-shrink: 0; }
  .legend { display: flex; gap: 16px; margin-bottom: 10px; }
  .legend-item { display: flex; align-items: center; gap: 6px; color: var(--muted); font-size: 11.5px; font-weight: 700; }
  .legend-swatch { width: 12px; height: 12px; border-radius: 3px; }
  .grid {
    display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px;
  }
  @media (max-width: 420px) { .grid { grid-template-columns: repeat(2, 1fr); } }
  .grid-cell {
    background: var(--card); border: 1.5px solid var(--line); border-radius: 10px;
    padding: 10px 8px; min-height: 52px; display: flex; align-items: center;
    justify-content: center; text-align: center; font-size: 12.5px; font-weight: 700;
  }
  .grid-cell.danced { border-color: var(--gold); }
  .cta {
    display: block; text-align: center; margin-top: 28px;
    background: var(--pink); color: #fff; text-decoration: none;
    font-weight: 800; font-size: 14px; padding: 14px; border-radius: 12px;
  }
  .empty { color: var(--muted); font-size: 14px; text-align: center; padding: 40px 20px; }
</style>
</head>
<body>
<div class="wrap">
${body}
</div>
</body>
</html>`;
}

function renderSessionPage(
  venueName: string,
  checkin: {
    checked_in_at: string;
    ended_at: string | null;
    paused_seconds: number | null;
    step_count: number | null;
    logged_dances: LoggedDance[] | null;
    live_danced_count: number | null;
    live_total_count: number | null;
  },
): string {
  const dances = checkin.logged_dances ?? [];
  const startedAt = new Date(checkin.checked_in_at).getTime();
  const endedAt = checkin.ended_at ? new Date(checkin.ended_at).getTime() : startedAt;
  const durationSeconds = Math.max(
    0,
    Math.floor((endedAt - startedAt) / 1000) - (checkin.paused_seconds ?? 0),
  );

  const difficultyCounts = new Map<string, number>();
  for (const d of dances) {
    if (!d.difficulty) continue;
    difficultyCounts.set(d.difficulty, (difficultyCounts.get(d.difficulty) ?? 0) + 1);
  }

  const showPercent = checkin.live_total_count != null && checkin.live_total_count > 1;
  const percent = showPercent
    ? Math.round(((checkin.live_danced_count ?? 0) / checkin.live_total_count!) * 100)
    : 0;

  const body = `
    <h1>${escapeHtml(venueName)}</h1>
    <p class="sub">${formatDate(checkin.checked_in_at)} · ${dances.length} ${dances.length === 1 ? "dance" : "dances"}</p>

    <div class="card">
      <div class="stats-row">
        <div>
          <div class="stat-value">${formatDuration(durationSeconds)}</div>
          <div class="stat-label">time there</div>
        </div>
        <div>
          <div class="stat-value">${dances.length}</div>
          <div class="stat-label">${dances.length === 1 ? "dance" : "dances"}</div>
        </div>
        ${
          checkin.step_count != null
            ? `<div><div class="stat-value">${checkin.step_count.toLocaleString()}</div><div class="stat-label">steps</div></div>`
            : ""
        }
      </div>

      ${
        difficultyCounts.size
          ? `<div style="margin-top:16px;padding-top:16px;border-top:1px solid var(--line)">
              ${[...difficultyCounts.entries()]
                .map(
                  ([diff, count]) => `
                <div class="difficulty-row">
                  <span class="difficulty-dot" style="background:${DIFFICULTY_COLOR[diff] ?? "#c9bacd"}"></span>
                  <span>${escapeHtml(diff)} (${count})</span>
                </div>`,
                )
                .join("")}
            </div>`
          : ""
      }

      ${
        showPercent
          ? `<div class="percent-pill">⚔️ Danced ${checkin.live_danced_count ?? 0} of ${checkin.live_total_count} logged while there (${percent}%)</div>`
          : ""
      }
    </div>

    ${
      dances.length
        ? `<div class="legend">
            <div class="legend-item"><span class="legend-swatch" style="background:var(--gold)"></span>Danced</div>
            <div class="legend-item"><span class="legend-swatch" style="background:var(--line)"></span>Logged / playing</div>
          </div>
          <div class="grid">
            ${dances
              .map(
                (d) =>
                  `<div class="grid-cell${d.danced === false ? "" : " danced"}">${escapeHtml(d.name)}</div>`,
              )
              .join("")}
          </div>`
        : `<p class="empty">No dances logged this session.</p>`
    }

    <a class="cta" href="https://justonemoredance.com" target="_blank" rel="noopener">Track your own nights — Just One More Dance →</a>
  `;

  return pageShell(`${venueName} — Just One More Dance`, body);
}

function notFoundPage(): string {
  return pageShell(
    "Not found — Just One More Dance",
    `<h1>This link doesn't point to anything</h1>
     <p class="sub">The session it was shared from may have been removed.</p>
     <a class="cta" href="https://justonemoredance.com" target="_blank" rel="noopener">Just One More Dance →</a>`,
  );
}

function errorPage(): string {
  return pageShell(
    "Something went wrong — Just One More Dance",
    `<h1>Something went wrong</h1>
     <p class="sub">Try the link again in a moment.</p>`,
  );
}
