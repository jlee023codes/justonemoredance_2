import { supabase } from "../lib/supabase";

// "Make Event" / RSVP — see migration_friends_page.sql for the tables and
// RLS (an event is visible to its creator and every one of their friends;
// there's no separate invite list). No push notifications: a new event or
// RSVP change just shows up next time someone opens the Friends tab.

export type EventRsvpStatus = "going" | "maybe" | "cant";

export type FriendEvent = {
  id: string;
  venueId: string | null;
  venueName: string;
  startsAt: string;
  note?: string;
  creator: { id: string; username: string; displayName: string | null };
  counts: { going: number; maybe: number; cant: number };
  myRsvp?: EventRsvpStatus;
};

type EventRow = {
  id: string;
  creator_id: string;
  venue_id: string | null;
  venue_name: string;
  starts_at: string;
  note: string | null;
  creator: { username: string; display_name: string | null } | null;
};

/** Every upcoming event you or a friend made, with RSVP headcounts and
 *  your own answer, if you've given one. */
export async function loadUpcomingEvents(userId: string): Promise<FriendEvent[]> {
  const { data: rows, error } = await supabase
    .from("events")
    // `!creator_id` pins the embed to that one column — without it,
    // PostgREST refuses to guess when it finds more than one FK path
    // between events and profiles.
    .select(
      "id,creator_id,venue_id,venue_name,starts_at,note,creator:profiles!creator_id(username,display_name)",
    )
    // A small grace window so an event doesn't vanish mid-way through.
    .gte("starts_at", new Date(Date.now() - 60 * 60 * 1000).toISOString())
    .order("starts_at", { ascending: true });
  if (error) throw error;
  const events = (rows ?? []) as unknown as EventRow[];
  if (!events.length) return [];

  const ids = events.map((e) => e.id);
  const { data: rsvpRows, error: rsvpError } = await supabase
    .from("event_rsvps")
    .select("event_id,user_id,status")
    .in("event_id", ids);
  if (rsvpError) throw rsvpError;

  const tallies = new Map<
    string,
    { going: number; maybe: number; cant: number; mine?: EventRsvpStatus }
  >();
  for (const row of (rsvpRows ?? []) as {
    event_id: string;
    user_id: string;
    status: EventRsvpStatus;
  }[]) {
    const t = tallies.get(row.event_id) ?? { going: 0, maybe: 0, cant: 0 };
    t[row.status] += 1;
    if (row.user_id === userId) t.mine = row.status;
    tallies.set(row.event_id, t);
  }

  return events.map((e) => {
    const t = tallies.get(e.id) ?? { going: 0, maybe: 0, cant: 0 };
    return {
      id: e.id,
      venueId: e.venue_id,
      venueName: e.venue_name,
      startsAt: e.starts_at,
      note: e.note ?? undefined,
      creator: {
        id: e.creator_id,
        username: e.creator?.username ?? "someone",
        displayName: e.creator?.display_name ?? null,
      },
      counts: { going: t.going, maybe: t.maybe, cant: t.cant },
      myRsvp: t.mine,
    };
  });
}

/** Creates an event and RSVPs its creator "going" by default. */
export async function createEvent(
  creatorId: string,
  venue: { id: string; name: string },
  startsAt: Date,
  note: string,
): Promise<string> {
  const { data, error } = await supabase
    .from("events")
    .insert({
      creator_id: creatorId,
      venue_id: venue.id,
      venue_name: venue.name,
      starts_at: startsAt.toISOString(),
      note: note.trim() || null,
    })
    .select("id")
    .single();
  if (error) throw error;
  await setRsvp(creatorId, data.id, "going").catch(() => {});
  return data.id as string;
}

export async function setRsvp(
  userId: string,
  eventId: string,
  status: EventRsvpStatus,
) {
  const { error } = await supabase.from("event_rsvps").upsert({
    user_id: userId,
    event_id: eventId,
    status,
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
}

/** Un-answers an event — tapping your already-selected RSVP again clears
 *  it rather than leaving it stuck. */
export async function clearRsvp(userId: string, eventId: string) {
  const { error } = await supabase
    .from("event_rsvps")
    .delete()
    .eq("user_id", userId)
    .eq("event_id", eventId);
  if (error) throw error;
}
