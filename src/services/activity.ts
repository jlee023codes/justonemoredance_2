import { supabase } from "../lib/supabase";
import { Friend } from "./friends";

// A friend activity feed, recomputed live from the same rows the rest of
// the app already reads/writes (user_dance_progress, user_venues) — no
// separate activity-log table, and no "seen" tracking, so it's always
// just "what's happened in the last week", not "what's new since you
// last looked". Requires the friends-read policy on user_venues from
// migration_friends_page.sql (user_dance_progress's is already there via
// migration_friend_requests.sql).

const WINDOW_DAYS = 7;

export type ActivityDance = {
  id: string;
  name: string;
  song: string;
  difficulty: "Beginner" | "Improver" | "Intermediate" | "Advanced";
};

export type ActivityItem =
  | {
      kind: "dances";
      friend: Friend;
      action: "learned" | "added";
      dances: ActivityDance[];
      when: string;
    }
  | {
      kind: "venues";
      friend: Friend;
      venues: { id: string; name: string }[];
      when: string;
    };

export async function loadFriendActivity(
  friends: Friend[],
): Promise<ActivityItem[]> {
  if (!friends.length) return [];
  const byId = new Map(friends.map((f) => [f.id, f]));
  const ids = [...byId.keys()];
  const since = new Date(
    Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  const [progressRes, venuesRes] = await Promise.all([
    supabase
      .from("user_dance_progress")
      .select(
        "user_id,dance_id,status,dance_name,dance_song,dance_difficulty,updated_at",
      )
      .in("user_id", ids)
      .gte("updated_at", since),
    supabase
      .from("user_venues")
      .select("user_id,venue_id,added_at,venues(name)")
      .in("user_id", ids)
      .gte("added_at", since),
  ]);
  if (progressRes.error) throw progressRes.error;
  if (venuesRes.error) throw venuesRes.error;

  // One feed line per (friend, learned-vs-added) — that's what lets "3
  // dances" collapse into a single "click to see which ones" line.
  const danceGroups = new Map<
    string,
    {
      friend: Friend;
      action: "learned" | "added";
      dances: ActivityDance[];
      when: string;
    }
  >();
  for (const row of (progressRes.data ?? []) as {
    user_id: string;
    dance_id: string;
    status: string;
    dance_name: string | null;
    dance_song: string | null;
    dance_difficulty: string | null;
    updated_at: string;
  }[]) {
    const friend = byId.get(row.user_id);
    if (!friend) continue;
    const action = row.status === "learned" ? "learned" : "added";
    const key = `${row.user_id}:${action}`;
    const group = danceGroups.get(key) ?? {
      friend,
      action,
      dances: [] as ActivityDance[],
      when: row.updated_at,
    };
    group.dances.push({
      id: row.dance_id,
      name: row.dance_name ?? "a dance",
      song: row.dance_song ?? "",
      difficulty:
        (row.dance_difficulty as ActivityDance["difficulty"]) ?? "Beginner",
    });
    if (row.updated_at > group.when) group.when = row.updated_at;
    danceGroups.set(key, group);
  }

  const venueGroups = new Map<
    string,
    { friend: Friend; venues: { id: string; name: string }[]; when: string }
  >();
  for (const row of (venuesRes.data ?? []) as any[]) {
    const friend = byId.get(row.user_id);
    if (!friend) continue;
    const group = venueGroups.get(row.user_id) ?? {
      friend,
      venues: [] as { id: string; name: string }[],
      when: row.added_at,
    };
    group.venues.push({ id: row.venue_id, name: row.venues?.name ?? "a venue" });
    if (row.added_at > group.when) group.when = row.added_at;
    venueGroups.set(row.user_id, group);
  }

  const items: ActivityItem[] = [
    ...[...danceGroups.values()].map((g) => ({ kind: "dances" as const, ...g })),
    ...[...venueGroups.values()].map((g) => ({ kind: "venues" as const, ...g })),
  ];
  items.sort((a, b) => (a.when < b.when ? 1 : -1));
  return items;
}
