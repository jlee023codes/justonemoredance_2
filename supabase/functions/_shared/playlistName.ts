import { createClient } from "jsr:@supabase/supabase-js@2";

/** Two different JOMD accounts can end up connected to the same real
 *  Spotify/Apple Music login (family plan, shared account, a tester using
 *  two JOMD accounts, etc) — each JOMD account still gets its own row and
 *  its own playlist (keyed by JOMD's own user_id, not the provider's
 *  identity), so nothing breaks, but a bare "Just One More Dance" name
 *  would leave two identical, indistinguishable playlists sitting in that
 *  one shared library. Including the JOMD display name/username avoids
 *  that — same fallback order as src/services/friends.ts's labelFor(). */
export async function playlistNameFor(
  db: ReturnType<typeof createClient>,
  userId: string,
): Promise<string> {
  const { data } = await db
    .from("profiles")
    .select("username, display_name")
    .eq("id", userId)
    .maybeSingle();
  const label = data?.display_name?.trim() || (data?.username ? `@${data.username}` : null);
  return label ? `Just One More Dance — ${label}` : "Just One More Dance";
}
