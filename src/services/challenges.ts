import { supabase } from "../lib/supabase";
import { Friend } from "./friends";

// Friend challenges — pick friends + a date range, compete on total
// dances logged and total steps over that window. See
// migration_challenges.sql for the tables/RLS/RPCs. No push
// notifications, same as events/friend requests: a new challenge or
// response just shows up next time someone opens the Friends tab.

export type ChallengeStatus = "pending" | "accepted" | "declined";

export type Challenge = {
  id: string;
  creator: Friend;
  startsOn: string; // "YYYY-MM-DD"
  endsOn: string;
  myStatus: ChallengeStatus;
  // Non-null means this is a group challenge, named at creation —
  // this IS the group/individual discriminant, no separate boolean.
  groupName: string | null;
  participants: { friend: Friend; status: ChallengeStatus }[];
};

/** What to show as a challenge's title — its group name if it has
 *  one, else a "vs. so-and-so" fallback built from the other
 *  participants. Shared between the leaderboard header and
 *  FriendsScreen's challenge card. */
export function challengeDisplayLabel(challenge: Challenge, myUserId: string): string {
  if (challenge.groupName) return challenge.groupName;
  const others = challenge.participants.filter((p) => p.friend.id !== myUserId);
  return others.map((p) => p.friend.displayName).join(", ") || "…";
}

export type ChallengeScore = {
  userId: string;
  danceCount: number;
  stepCount: number;
};

function labelFor(profile: { display_name: string | null; username: string }): string {
  return profile.display_name?.trim() || `@${profile.username}`;
}

function toFriend(p: {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
}): Friend {
  return {
    id: p.id,
    displayName: labelFor(p),
    username: p.username,
    avatarUrl: p.avatar_url ?? null,
  };
}

/** Invites one or more friends to a challenge over a date range.
 *  Goes through a SECURITY DEFINER function — a normal RLS policy
 *  can't let you write a pending-invite row that belongs to someone
 *  else. Non-friends in the list are silently skipped server-side. */
export async function createChallenge(
  friendIds: string[],
  startsOn: Date,
  endsOn: Date,
  groupName?: string | null,
): Promise<string> {
  const toDateOnly = (d: Date) => d.toISOString().slice(0, 10);
  const { data, error } = await supabase.rpc("create_challenge", {
    p_friend_ids: friendIds,
    p_starts_on: toDateOnly(startsOn),
    p_ends_on: toDateOnly(endsOn),
    p_group_name: groupName ?? null,
  });
  if (error) throw error;
  return data as string;
}

/** Every challenge you're a participant in (creator or invitee),
 *  pending or accepted, with the full roster and everyone's answer so
 *  far. Two round-trips, same shape as loadUpcomingEvents: fetch
 *  challenges, then a second query for every participant row. */
export async function loadMyChallenges(userId: string): Promise<Challenge[]> {
  const { data: participantRows, error: pError } = await supabase
    .from("challenge_participants")
    .select("challenge_id,status")
    .eq("user_id", userId);
  if (pError) throw pError;
  const myRows = participantRows ?? [];
  if (!myRows.length) return [];

  const challengeIds = myRows.map((r: any) => r.challenge_id as string);
  const myStatusByChallenge = new Map(
    myRows.map((r: any) => [r.challenge_id as string, r.status as ChallengeStatus]),
  );

  const { data: challengeRows, error: cError } = await supabase
    .from("challenges")
    // `!creator_id` pins the embed to that one FK path, same reasoning
    // as loadUpcomingEvents in services/events.ts.
    .select(
      "id,creator_id,starts_on,ends_on,group_name,creator:profiles!creator_id(id,username,display_name,avatar_url)",
    )
    .in("id", challengeIds)
    .order("created_at", { ascending: false });
  if (cError) throw cError;

  const { data: allParticipants, error: allPError } = await supabase
    .from("challenge_participants")
    .select("challenge_id,user_id,status,profiles(id,username,display_name,avatar_url)")
    .in("challenge_id", challengeIds);
  if (allPError) throw allPError;

  const participantsByChallenge = new Map<
    string,
    { friend: Friend; status: ChallengeStatus }[]
  >();
  for (const row of (allParticipants ?? []) as any[]) {
    const profile = row.profiles;
    if (!profile) continue;
    const list = participantsByChallenge.get(row.challenge_id) ?? [];
    list.push({ friend: toFriend(profile), status: row.status });
    participantsByChallenge.set(row.challenge_id, list);
  }

  return (challengeRows ?? []).map((row: any) => ({
    id: row.id,
    creator: row.creator
      ? toFriend({ id: row.creator_id, ...row.creator })
      : toFriend({ id: row.creator_id, username: "someone", display_name: null, avatar_url: null }),
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    groupName: row.group_name ?? null,
    myStatus: myStatusByChallenge.get(row.id) ?? "pending",
    participants: participantsByChallenge.get(row.id) ?? [],
  }));
}

/** Accept or decline an invite — a plain RLS update, no RPC needed
 *  (the "respond to own invite" policy already scopes writes to your
 *  own participant row regardless). The explicit user_id filter here
 *  is just belt-and-suspenders clarity, not what actually enforces it. */
export async function respondToChallenge(
  challengeId: string,
  userId: string,
  accept: boolean,
): Promise<void> {
  const { error } = await supabase
    .from("challenge_participants")
    .update({ status: accept ? "accepted" : "declined", responded_at: new Date().toISOString() })
    .eq("challenge_id", challengeId)
    .eq("user_id", userId);
  if (error) throw error;
}

/** Each accepted participant's total dances/steps over the challenge's
 *  date range. The server-side function checks you're actually an
 *  accepted participant before returning anyone's numbers — someone
 *  with zero sessions in the window just doesn't appear in the result,
 *  not a zero row. */
export async function loadChallengeScores(challengeId: string): Promise<ChallengeScore[]> {
  const { data, error } = await supabase.rpc("get_challenge_scores", {
    p_challenge_id: challengeId,
  });
  if (error) throw error;
  return ((data ?? []) as any[]).map((row) => ({
    userId: row.user_id,
    danceCount: Number(row.dance_count),
    stepCount: Number(row.step_count),
  }));
}
