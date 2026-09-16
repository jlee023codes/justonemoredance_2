import { supabase } from "./supabase";

/** Permanently deletes the signed-in user's account and everything tied to
 *  it (progress, venues, friendships, events, …) — see
 *  supabase/functions/delete-account/index.ts for what actually runs and
 *  why this can't be a direct client call. The session is dead the moment
 *  this resolves; the caller should sign out / clear local state right
 *  after (see ProfileScreen's handleDeleteAccount). */
export async function deleteAccount(): Promise<void> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error("You're signed out.");

  const { data, error } = await supabase.functions.invoke("delete-account", {
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
}
