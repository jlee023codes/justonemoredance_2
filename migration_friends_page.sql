-- Just One More Dance: Friends page — activity feed + "Make Event" / RSVP.
--
-- Run ONCE, after the earlier migrations (needs friendships from
-- migration_friend_requests.sql). Idempotent.
--
-- 1. Extends read access on `user_venues` to friends (mirrors the existing
--    "read friends progress" policy on user_dance_progress) so "added a
--    new venue" can show up in a friend's activity feed.
-- 2. `events` + `event_rsvps`: a friend creates an event (venue + time);
--    every one of their friends can see it and RSVP going/maybe/can't.
--    There's no separate invite list — an event is visible to whoever was
--    already your friend when you made it. No push notifications: friends
--    see new/updated events next time they open the Friends tab.

-- ---------------------------------------------------------------------
-- 1. Friends can see which venues you've added, not just their own.
-- ---------------------------------------------------------------------
drop policy if exists "read own venues" on user_venues;
create policy "read own or friends venues" on user_venues
  for select using (
    auth.uid() = user_id
    or exists (
      select 1 from friendships f
      where f.user_id = auth.uid() and f.friend_id = user_venues.user_id
    )
  );

-- ---------------------------------------------------------------------
-- 2. Events + RSVPs
-- ---------------------------------------------------------------------
create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references profiles(id) on delete cascade,
  venue_id text references venues(id) on delete set null,
  -- Snapshot so the event still reads sensibly if the venue is ever merged
  -- away by the dedup migration or otherwise changes.
  venue_name text not null,
  starts_at timestamptz not null,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists events_creator_idx on events (creator_id);
create index if not exists events_starts_at_idx on events (starts_at);

create table if not exists event_rsvps (
  event_id uuid references events(id) on delete cascade,
  user_id uuid references profiles(id) on delete cascade,
  status text not null check (status in ('going','maybe','cant')),
  updated_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

alter table events enable row level security;
alter table event_rsvps enable row level security;

drop policy if exists "read visible events" on events;
create policy "read visible events" on events
  for select using (
    auth.uid() = creator_id
    or exists (
      select 1 from friendships f
      where f.user_id = auth.uid() and f.friend_id = events.creator_id
    )
  );

drop policy if exists "create own events" on events;
create policy "create own events" on events
  for insert with check (auth.uid() = creator_id);

-- Anyone who can see the event can see the full RSVP headcount — that's
-- the point (who's going).
drop policy if exists "read visible rsvps" on event_rsvps;
create policy "read visible rsvps" on event_rsvps
  for select using (
    exists (
      select 1 from events e
      where e.id = event_rsvps.event_id
        and (
          e.creator_id = auth.uid()
          or exists (
            select 1 from friendships f
            where f.user_id = auth.uid() and f.friend_id = e.creator_id
          )
        )
    )
  );

-- You can only ever write your own RSVP, and only on an event you're
-- actually allowed to see.
drop policy if exists "write own rsvp" on event_rsvps;
create policy "write own rsvp" on event_rsvps
  for all using (auth.uid() = user_id) with check (
    auth.uid() = user_id
    and exists (
      select 1 from events e
      where e.id = event_rsvps.event_id
        and (
          e.creator_id = auth.uid()
          or exists (
            select 1 from friendships f
            where f.user_id = auth.uid() and f.friend_id = e.creator_id
          )
        )
    )
  );
