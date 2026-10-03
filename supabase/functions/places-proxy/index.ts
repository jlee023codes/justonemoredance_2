// supabase/functions/places-proxy/index.ts
//
// Secure proxy between the app and Google's Places API (New) — used for
// venue search autocomplete when adding a venue (see
// src/components/VenuePicker.tsx). Same reasoning as
// bootstepper-proxy/index.ts: the API key is billed, server-side-only,
// never shipped in client code. This app has both a native and a web
// build, so proxying one secret key here is simpler than managing two
// platform-restricted keys (iOS bundle id vs. web HTTP referrer) for a
// key embedded client-side.
//
// Deploy:
//   supabase functions deploy places-proxy
// Set the key (never commit this):
//   supabase secrets set GOOGLE_PLACES_API_KEY=your-key-here
//
// Only autocomplete + place-details are needed for the shipped feature
// (Places search when adding a venue). A `nearby` action (Places Nearby
// Search, for reverse-looking-up "what's at this GPS point") belongs to
// the deferred check-in feature — see the venue-checkin-deferred memory
// note — not built here.

import { createClient } from "jsr:@supabase/supabase-js@2";

const PLACES_BASE = "https://places.googleapis.com/v1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const apiKey = Deno.env.get("GOOGLE_PLACES_API_KEY");
  if (!supabaseUrl || !anonKey || !apiKey) {
    return json({ error: "Server misconfiguration: missing env vars" }, 500);
  }

  // Require a real (or anonymous) Supabase session before spending
  // Places API quota on someone's behalf.
  const authHeader = req.headers.get("Authorization") ?? "";
  const supabase = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    return json({ error: "Not authenticated" }, 401);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  try {
    switch (body.action) {
      case "autocomplete":
        return json(await autocomplete(apiKey, body as { input: string; sessionToken: string }));
      case "place-details":
        return json(await placeDetails(apiKey, body as { placeId: string; sessionToken: string }));
      default:
        return json({ error: `Unknown action: ${body.action}` }, 400);
    }
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

export type PlaceSuggestion = { placeId: string; description: string };

async function autocomplete(
  apiKey: string,
  args: { input: string; sessionToken: string },
): Promise<{ suggestions: PlaceSuggestion[] }> {
  const input = (args.input ?? "").trim();
  if (!input) return { suggestions: [] };

  const res = await fetch(`${PLACES_BASE}/places:autocomplete`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
    },
    body: JSON.stringify({ input, sessionToken: args.sessionToken }),
  });
  if (!res.ok) throw new Error(`Google Places autocomplete failed: ${await res.text()}`);
  const data = await res.json();

  const suggestions: PlaceSuggestion[] = (data.suggestions ?? [])
    .map((s: any) => s.placePrediction)
    .filter(Boolean)
    .map((p: any) => ({
      placeId: p.placeId as string,
      description: (p.text?.text as string) ?? "",
    }));
  return { suggestions };
}

async function placeDetails(
  apiKey: string,
  args: { placeId: string; sessionToken: string },
): Promise<{ name: string; formattedAddress: string | null; latitude: number | null; longitude: number | null }> {
  const url = new URL(`${PLACES_BASE}/places/${encodeURIComponent(args.placeId)}`);
  if (args.sessionToken) url.searchParams.set("sessionToken", args.sessionToken);

  const res = await fetch(url.toString(), {
    headers: {
      "X-Goog-Api-Key": apiKey,
      // Field mask is required by the New Places API — only ask for
      // what's actually used, both to keep the response small and
      // because Google bills some fields at a higher tier.
      "X-Goog-FieldMask": "displayName,formattedAddress,location",
    },
  });
  if (!res.ok) throw new Error(`Google Place Details failed: ${await res.text()}`);
  const data = await res.json();

  return {
    name: data.displayName?.text ?? "",
    formattedAddress: data.formattedAddress ?? null,
    latitude: data.location?.latitude ?? null,
    longitude: data.location?.longitude ?? null,
  };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}
