// supabase/functions/bootstepper-proxy/index.ts
//
// Secure proxy between the app and the BootStepper API.
//
// WHY THIS EXISTS: BootStepper's Terms of Use say API keys must not be
// exposed in client-side code (public repos, app bundles, etc). A React
// Native app ships as client-side code, so the key can never live in
// App.tsx / .env / EXPO_PUBLIC_*. It lives only here, as a Supabase
// secret, and this function is the only thing that ever sees it.
//
// Deploy:
//   supabase functions deploy bootstepper-proxy
// Set the key (never commit this):
//   supabase secrets set BOOTSTEPPER_API_KEY=your-key-here
//
// The app calls this via supabase.functions.invoke("bootstepper-proxy", ...),
// which automatically attaches the signed-in user's auth token — this
// function checks that token before forwarding anything upstream, so it
// can't be used as an open relay by someone outside your app.

import { createClient } from "jsr:@supabase/supabase-js@2";

const BOOTSTEPPER_BASE = "https://api.bootstepper.com";

// Allow-list of upstream paths. Add to this as you use more of the API —
// don't just forward `path` blindly, or this becomes a general-purpose
// proxy for anything, which is both a security and a ToS problem.
const ALLOWED_PATHS = new Set([
  "/dances/search",
  "/dances/getById",
  "/dances/getByIds",
]);

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const apiKey = Deno.env.get("BOOTSTEPPER_API_KEY");
  if (!supabaseUrl || !anonKey || !apiKey) {
    return json({ error: "Server misconfiguration: missing env vars" }, 500);
  }

  // Require a real (or anonymous) Supabase session before spending
  // BootStepper quota on someone's behalf.
  const authHeader = req.headers.get("Authorization") ?? "";
  const supabase = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    return json({ error: "Not authenticated" }, 401);
  }

  let body: { path?: string; params?: Record<string, string> };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const path = body.path ?? "";
  if (!ALLOWED_PATHS.has(path)) {
    return json({ error: `Path not allowed: ${path}` }, 400);
  }

  const url = new URL(BOOTSTEPPER_BASE + path);
  for (const [key, value] of Object.entries(body.params ?? {})) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, value);
    }
  }

  let upstream: Response;
  try {
    upstream = await fetch(url.toString(), {
      headers: { "X-BootStepper-API-Key": apiKey },
    });
  } catch (err) {
    return json({ error: `Could not reach BootStepper: ${String(err)}` }, 502);
  }

  const text = await upstream.text();
  return new Response(text, {
    status: upstream.status,
    headers: { "Content-Type": "application/json" },
  });
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
