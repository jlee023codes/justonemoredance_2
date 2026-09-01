-- Run this ONCE against an existing Supabase project that already has
-- venues/profiles/user_dance_progress from an earlier version of this app
-- (i.e. you already ran schema.sql or migration_bootstepper.sql before).
-- If you're setting up a brand new project, just run the new schema.sql
-- instead — you don't need this file.

-- user_dance_progress is now venue-independent — venue association moved
-- to the new user_venues / user_venue_dances tables below.
alter table user_dance_progress drop column if exists personal_venue_id;
alter table user_dance_progress drop column if exists personal_song_swap;

-- Which venues a user has added to their "My Venues" tab.
create table if not exists user_venues (
  user_id uuid references profiles(id) on delete cascade,
  venue_id text references venues(id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (user_id, venue_id)
);

-- Which dances a user has tied to which of their venues, with an optional
-- song swap for that dance at that venue.
create table if not exists user_venue_dances (
  user_id uuid references profiles(id) on delete cascade,
  venue_id text references venues(id) on delete cascade,
  dance_id text not null,
  dance_name text,
  dance_song text,
  dance_difficulty text,
  song_swap text,
  added_at timestamptz not null default now(),
  primary key (user_id, venue_id, dance_id)
);

alter table user_venues enable row level security;
alter table user_venue_dances enable row level security;

drop policy if exists "read own venues" on user_venues;
drop policy if exists "write own venues" on user_venues;
drop policy if exists "read own venue dances" on user_venue_dances;
drop policy if exists "write own venue dances" on user_venue_dances;
create policy "read own venues" on user_venues for select using (auth.uid() = user_id);
create policy "write own venues" on user_venues for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "read own venue dances" on user_venue_dances for select using (auth.uid() = user_id);
create policy "write own venue dances" on user_venue_dances for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Users can now add new venues to the shared catalog (used by the "find or
-- add a venue" picker). Existing venues still can't be edited/renamed from
-- the app — no update policy is added.
drop policy if exists "insert venues" on venues;
create policy "insert venues" on venues for insert to authenticated with check (true);
