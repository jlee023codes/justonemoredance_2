// supabase/functions/delete-account/index.ts
//
// Apple App Review 5.1.1(v): an app that supports account creation must
// also offer in-app account deletion — deactivation isn't enough.
//
// WHY THIS IS A FUNCTION AND NOT A CLIENT CALL: deleting a row from
// auth.users requires the Supabase Admin API (auth.admin.deleteUser),
// which needs the service-role key. That key must never ship in the app —
// it bypasses RLS entirely. This function verifies the caller's own
// session, then deletes *that same user's* auth.users row as the admin
// client, server-side only.
//
// Deploy:
//   supabase functions deploy delete-account
// No extra secrets to set — SUPABASE_URL / SUPABASE_ANON_KEY /
// SUPABASE_SERVICE_ROLE_KEY are auto-injected into every Edge Function.
//
// Deleting auth.users cascades to profiles and, from there, to every
// other table (user_dance_progress, user_venues, user_venue_dances,
// venue_votes, friendships, friend_requests, events, event_rsvps,
// notes_import_queue, shared_lists, …) via `on delete cascade` — see
// schema.sql and the migration_*.sql files. Nothing else to clean up here.

import { createClient } from "jsr:@supabase/supabase-js@2";

// Browsers preflight any cross-origin call that carries a JSON body and an
// Authorization header (which supabase.functions.invoke always sends) with
// an OPTIONS request first. Without these headers on every response —
// including OPTIONS itself — the browser blocks the real request before it
// ever leaves, which surfaces client-side as a generic "failed to send a
// request to the Edge Function", not a proper error from this code.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return json({ error: "Server misconfiguration: missing env vars" }, 500);
  }

  // Who is calling, verified from their own token — never trust a
  // client-supplied user id for a delete like this.
  const authHeader = req.headers.get("Authorization") ?? "";
  const asCaller = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userError } = await asCaller.auth.getUser();
  if (userError || !userData.user) {
    return json({ error: "Not authenticated" }, 401);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey);
  const { error: deleteError } = await admin.auth.admin.deleteUser(
    userData.user.id,
  );
  if (deleteError) {
    return json({ error: deleteError.message }, 500);
  }

  return json({ ok: true });
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}
