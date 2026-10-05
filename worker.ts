// Cloudflare Worker entry point for justonemoredance.com. Everything
// except /s/* falls straight through to the static dist/ assets
// (the Expo web export + public/how-to-use, /whats-new, etc.) exactly
// as it did before this file existed — this only adds one new route:
// proxying a session share link to the share-session Supabase Edge
// Function. See migration_session_shares.sql and
// supabase/functions/share-session/index.ts.
//
// Runs under the Workers runtime, not React Native/Expo — the ASSETS
// binding's type isn't in this repo's RN-flavored TypeScript setup
// (no @cloudflare/workers-types dependency), so it's declared inline
// below rather than pulling in a whole new type package for one file.

interface Fetcher {
  fetch(request: Request): Promise<Response>;
}

export interface Env {
  ASSETS: Fetcher;
  SUPABASE_URL: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/s/")) {
      const target = `${env.SUPABASE_URL}/functions/v1/share-session${url.pathname}`;
      const upstream = await fetch(target, { method: request.method, headers: request.headers });
      // Supabase's Edge Function gateway overrides whatever
      // Content-Type the function itself sets (always comes back as
      // text/plain, even for a 200 with real HTML) — rewrite it here
      // so the browser actually renders the page instead of showing
      // raw markup as text.
      const headers = new Headers(upstream.headers);
      headers.set("Content-Type", "text/html; charset=utf-8");
      return new Response(upstream.body, { status: upstream.status, headers });
    }

    return env.ASSETS.fetch(request);
  },
};
