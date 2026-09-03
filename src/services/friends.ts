import { supabase } from "../lib/supabase";

export type Friend = {
  id: string;
  displayName: string;
  username: string;
};

export type FriendDance = {
  danceId: string;
  name: string;
  song: string;
  difficulty: "Beginner" | "Improver" | "Intermediate" | "Advanced";
  status: "maybe" | "want" | "learned";
};

function labelFor(profile: { display_name: string | null; username: string }): string {
  return profile.display_name?.trim() || `@${profile.username}`;
}

export async function getMyProfile(
  userId: string,
): Promise<{ username: string | null; displayName: string | null }> {
  const { data, error } = await supabase
    .from("profiles")
    .select("username, display_name")
    .eq("id", userId)
    .single();
  if (error) throw error;
  return { username: data.username, displayName: data.display_name };
}

const USERNAME_PATTERN = /^[a-zA-Z0-9_]{3,20}$/;

export async function setUsername(userId: string, username: string): Promise<string> {
  const trimmed = username.trim();
  if (!USERNAME_PATTERN.test(trimmed)) {
    throw new Error("Usernames are 3–20 characters: letters, numbers, underscores only.");
  }
  const { error } = await supabase
    .from("profiles")
    .update({ username: trimmed })
    .eq("id", userId);
  if (error) {
    if (error.code === "23505") throw new Error(`"${trimmed}" is already taken.`);
    throw error;
  }
  return trimmed;
}

export async function setDisplayName(userId: string, name: string): Promise<void> {
  const { error } = await supabase
    .from("profiles")
    .update({ display_name: name.trim() || null })
    .eq("id", userId);
  if (error) throw error;
}

/** Looks up a dancer by their username and creates a mutual friendship
 *  (both directions) via a SECURITY DEFINER function, since a normal RLS
 *  policy can't let one person write a row owned by someone else. */
export async function addFriendByUsername(username: string): Promise<Friend> {
  const { data, error } = await supabase.rpc("add_friend", {
    p_username: username.trim(),
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("Could not add that friend.");
  return {
    id: row.id,
    displayName: labelFor({ display_name: row.display_name, username: row.username }),
    username: row.username,
  };
}

export async function removeFriend(friendId: string): Promise<void> {
  const { error } = await supabase.rpc("remove_friend", {
    p_friend_id: friendId,
  });
  if (error) throw error;
}

export async function loadFriends(userId: string): Promise<Friend[]> {
  const { data: rows, error } = await supabase
    .from("friendships")
    .select("friend_id")
    .eq("user_id", userId);
  if (error) throw error;

  const friendIds = (rows ?? []).map((r: any) => r.friend_id as string);
  if (!friendIds.length) return [];

  const { data: profiles, error: profileError } = await supabase
    .from("profiles")
    .select("id, display_name, username")
    .in("id", friendIds);
  if (profileError) throw profileError;

  return (profiles ?? [])
    .map((p: any) => ({
      id: p.id as string,
      displayName: labelFor({ display_name: p.display_name, username: p.username }),
      username: p.username as string,
    }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

/** A friend's overall dance list ("My List" equivalent) — relies on the
 *  RLS policy that lets friends read each other's user_dance_progress. */
export async function loadFriendDances(friendUserId: string): Promise<FriendDance[]> {
  const { data, error } = await supabase
    .from("user_dance_progress")
    .select("dance_id, status, dance_name, dance_song, dance_difficulty")
    .eq("user_id", friendUserId);
  if (error) throw error;
  return (data ?? []).map((row: any) => ({
    danceId: row.dance_id,
    name: row.dance_name ?? "Dance",
    song: row.dance_song ?? "",
    difficulty: row.dance_difficulty ?? "Beginner",
    status: row.status,
  }));
}
