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
  status: "want" | "learning" | "learned";
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

/** A friend request waiting on someone: `incoming` ones are yours to
 *  accept or decline, `outgoing` ones are yours to cancel. */
export type FriendRequest = {
  requestId: string;
  direction: "incoming" | "outgoing";
  from: Friend;
  createdAt: string;
};

/** Result of asking to be someone's friend. `accepted` happens when they
 *  already had a request out to you — adding each other shouldn't leave
 *  both of you waiting on the other. */
export type FriendRequestResult = {
  status: "pending" | "accepted";
  friend: Friend;
  requestId: string;
};

/** Looks a dancer up by username and opens a *pending* friend request.
 *  Nobody can see anybody's list until the other side accepts — see
 *  respondToFriendRequest. Goes through a SECURITY DEFINER function
 *  because a normal RLS policy can't let one person write a row that
 *  belongs to someone else. */
export async function sendFriendRequest(
  username: string,
): Promise<FriendRequestResult> {
  const { data, error } = await supabase.rpc("send_friend_request", {
    p_username: username.trim(),
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("Could not send that friend request.");
  return {
    status: row.status,
    requestId: row.request_id,
    friend: {
      id: row.id,
      displayName: labelFor({
        display_name: row.display_name,
        username: row.username,
      }),
      username: row.username,
    },
  };
}

/** Both directions of still-pending requests, already joined to the other
 *  person's profile. */
export async function loadFriendRequests(): Promise<FriendRequest[]> {
  const { data, error } = await supabase.rpc("get_friend_requests");
  if (error) throw error;
  return ((data ?? []) as any[]).map((row) => ({
    requestId: row.request_id as string,
    direction: row.direction as "incoming" | "outgoing",
    createdAt: row.created_at as string,
    from: {
      id: row.other_id as string,
      displayName: labelFor({
        display_name: row.display_name,
        username: row.username,
      }),
      username: row.username as string,
    },
  }));
}

/** Accept or decline an incoming request. Accepting is what actually
 *  creates the friendship — in both directions, so each of you can see
 *  the other's list. */
export async function respondToFriendRequest(
  requestId: string,
  accept: boolean,
): Promise<Friend> {
  const { data, error } = await supabase.rpc("respond_to_friend_request", {
    p_request_id: requestId,
    p_accept: accept,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("That request is no longer waiting for an answer.");
  return {
    id: row.id,
    displayName: labelFor({
      display_name: row.display_name,
      username: row.username,
    }),
    username: row.username,
  };
}

/** Withdraw a request you sent, before they've answered it. */
export async function cancelFriendRequest(requestId: string): Promise<void> {
  const { error } = await supabase.rpc("cancel_friend_request", {
    p_request_id: requestId,
  });
  if (error) throw error;
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
