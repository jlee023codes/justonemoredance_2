// supabase/functions/venue-revision/index.ts
//
// Emails the app owner for two kinds of venue notification (see
// src/components/VenueRevisionModal.tsx):
//   - "revision": a free-text correction note — e.g. "the cover is
//     actually $15". venue_nights writes are locked to admins/approved
//     reps (migration_venue_reps.sql), so this is how anyone else
//     flags something wrong.
//   - "rep_request": someone asked to become a venue's representative
//     (the venue_representatives row itself is inserted client-side
//     first, see src/services/venues.ts's requestVenueRep — this just
//     notifies the owner there's a pending request to review).
//
// Deploy:
//   supabase functions deploy venue-revision
// Set the key (never commit this):
//   supabase secrets set RESEND_API_KEY=your-key-here
//
// Uses Resend's default "onboarding@resend.dev" sender, which works
// without verifying a domain — its sandbox restriction (can only send
// to the account's own verified address) is a non-issue here since the
// sole recipient already *is* the account owner's own email.

import { createClient } from "jsr:@supabase/supabase-js@2";

// Must match the email the Resend account was signed up with — without a
// verified sending domain, Resend only allows sending to that address.
const OWNER_EMAIL = "justonemoredanceapp@gmail.com";
const MAX_NOTE_LENGTH = 1000;

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
  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  if (!supabaseUrl || !anonKey || !resendApiKey) {
    return json({ error: "Server misconfiguration: missing env vars" }, 500);
  }

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

  const kind = body.kind === "rep_request" ? "rep_request" : "revision";
  const venueId = typeof body.venueId === "string" ? body.venueId.trim() : "";
  const venueName = typeof body.venueName === "string" ? body.venueName.trim() : "";
  const note = typeof body.note === "string" ? body.note.trim() : "";
  if (!venueId || !venueName) return json({ error: "Missing venue" }, 400);
  if (kind === "revision" && !note) {
    return json({ error: "Please describe what should change." }, 400);
  }
  if (note.length > MAX_NOTE_LENGTH) {
    return json({ error: `Keep it under ${MAX_NOTE_LENGTH} characters.` }, 400);
  }

  const subject =
    kind === "rep_request"
      ? `Rep request: ${venueName}`
      : `Venue revision: ${venueName}`;
  const text = [
    `Venue: ${venueName} (${venueId})`,
    `Submitted by user: ${userData.user.id}`,
    "",
    kind === "rep_request"
      ? note || "(wants to represent this venue — no note left)"
      : note,
  ].join("\n");

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${resendApiKey}`,
      },
      body: JSON.stringify({ from: "onboarding@resend.dev", to: OWNER_EMAIL, subject, text }),
    });
    if (!res.ok) throw new Error(`Resend send failed: ${await res.text()}`);
    return json({ ok: true });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}
