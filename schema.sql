-- Just One More Dance: PostgreSQL schema for Supabase's free tier.
--
-- The dance catalog lives in BootStepper (https://api.bootstepper.com),
-- fetched live through the bootstepper-proxy Edge Function.
--
-- Venue association is per-user and per-venue, not a single "personal
-- venue" per dance: a user can tie the same dance to several venues (each
-- with its own optional song swap). `user_venues` is which venues a user
-- has added to their "My Venues" tab; `user_venue_dances` is which dances
-- they've tied to each of those venues. `venues` itself is a shared
-- catalog — anyone can search it or add a new venue to it.

-- name_key is a normalized (lowercase, alphanumeric-only) form of name — it
-- carries the uniqueness so "Neon Boots" / "neon boots" / "Neon  Boots!"
-- collapse to one row. The app sets it on insert (see venueKey in
-- src/services/venues.ts); public.venue_key() is the SQL twin.
create or replace function public.venue_key(name text)
returns text language sql immutable as $$
  select regexp_replace(lower(coalesce(name, '')), '[^a-z0-9]+', '', 'g')
$$;
create table venues (
  id text primary key,
  name text not null,
  name_key text not null
);
create unique index venues_name_key_uniq on venues (name_key);
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  default_venue_id text references venues(id) on delete set null,
  -- A manual "I comped this person" flag — NOT a real RevenueCat
  -- entitlement (the app checks that live via the SDK, see
  -- src/lib/entitlements.ts). Set it directly in the SQL editor:
  --   update profiles set comped_premium = true where id = '<user id>';
  -- The app never writes this itself. If a RevenueCat webhook is ever
  -- built to also flip this on real purchases, it should be a
  -- server-side handler (a Supabase Edge Function verifying the
  -- RevenueCat event) — never the client.
  comped_premium boolean not null default false
);

-- One thumbs-up per user per venue — a community "this is a real venue"
-- signal shown in the picker. Adding a venue to your list also endorses it.
create table venue_votes (
  user_id uuid references profiles(id) on delete cascade,
  venue_id text references venues(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, venue_id)
);

-- Overall want/learned status for a dance — venue-independent.
-- dance_id is a BootStepper dance id, not a local foreign key — the
-- catalog it refers to lives outside this database, so it can't be a real
-- FK. dance_name/dance_song/dance_difficulty are a snapshot for offline /
-- fallback display; the app prefers a live BootStepper fetch when it can.
create table user_dance_progress (
  user_id uuid references profiles(id) on delete cascade,
  dance_id text not null,
  status text not null check (status in ('want','learned')),
  source text not null default 'self' check (source in ('self','friend')),
  dance_name text,
  dance_song text,
  dance_difficulty text,
  -- created_at is set once, when the dance first enters the list (any
  -- source); updated_at moves on every status change. My List sorts on
  -- both ("Date added" vs "Last updated").
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, dance_id)
);

-- Which venues a user has added to their "My Venues" tab, independent of
-- whether they've tied any dances to it yet.
create table user_venues (
  user_id uuid references profiles(id) on delete cascade,
  venue_id text references venues(id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (user_id, venue_id)
);

-- Which dances a user has tied to which of their venues, with an optional
-- song swap for that dance at that venue.
create table user_venue_dances (
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

-- Which dances have been tagged to each venue, and by how many distinct
-- users — aggregated across *everyone*, without exposing who. Powers the
-- Venues page ("dances reported here"). A bare view (not security_invoker)
-- runs as its owner and so bypasses the per-user RLS on
-- user_venue_dances below — that's the point: the underlying rows stay
-- private, only this aggregate is public.
--
-- Only premium users' tags count. This is what makes "enroll in premium"
-- meaningful: the moment profiles.comped_premium flips true for someone, their
-- existing tags start counting here automatically (it's a live query, no
-- backfill needed) — they've added their known venue dances to the bigger
-- list, and Premium is what unlocks reading this view in the first place
-- (see the Venues tab's paywall gate).
create or replace view venue_dance_reports as
select
  d.venue_id,
  d.dance_id,
  max(d.dance_name) as dance_name,
  max(d.dance_song) as dance_song,
  max(d.dance_difficulty) as dance_difficulty,
  count(distinct d.user_id)::int as reported_by
from user_venue_dances d
join profiles p on p.id = d.user_id and p.comped_premium
group by d.venue_id, d.dance_id;

create table shared_lists (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);
create table shared_list_dances (
  shared_list_id uuid references shared_lists(id) on delete cascade,
  dance_id text not null,
  dance_name text,
  song_swap text,
  venue_id text references venues(id) on delete set null,
  primary key (shared_list_id, dance_id, song_swap)
);


-- Run this section after the schema above. It seeds the venues used by the
-- app, creates a profile for each newly registered user, and protects user
-- data with RLS.
insert into venues (id, name, name_key) values
  ('cancun-cantina', 'Cancun Cantina', public.venue_key('Cancun Cantina')),
  ('neon-boots', 'Neon Boots', public.venue_key('Neon Boots')),
  ('starlight', 'Starlight Saloon', public.venue_key('Starlight Saloon')),
  ('boot-scoot', 'Boot Scoot Social', public.venue_key('Boot Scoot Social')),
  ('copper', 'The Copper Room', public.venue_key('The Copper Room'))
  on conflict (id) do update set name = excluded.name, name_key = excluded.name_key;

create or replace function public.create_profile_for_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  return new;
end;
$$;
drop trigger if exists create_profile_on_signup on auth.users;
create trigger create_profile_on_signup after insert on auth.users for each row execute procedure public.create_profile_for_new_user();

alter table venues enable row level security;
alter table venue_votes enable row level security;
alter table profiles enable row level security;
alter table user_dance_progress enable row level security;
alter table user_venues enable row level security;
alter table user_venue_dances enable row level security;
alter table shared_lists enable row level security;
alter table shared_list_dances enable row level security;

-- Venues are a shared catalog: anyone signed in can read them, and can add
-- a new one (used by the "find or add a venue" picker). There's no update
-- policy, so existing venues can't be edited or renamed from the app.
drop policy if exists "read venues" on venues;
drop policy if exists "insert venues" on venues;
create policy "read venues" on venues for select to authenticated using (true);
create policy "insert venues" on venues for insert to authenticated with check (true);

-- Venue votes: everyone signed in can read the tally; you can only add or
-- remove your own thumbs-up.
drop policy if exists "read venue votes" on venue_votes;
drop policy if exists "write own venue votes" on venue_votes;
create policy "read venue votes" on venue_votes for select to authenticated using (true);
create policy "write own venue votes" on venue_votes for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "read own profile" on profiles;
drop policy if exists "update own profile" on profiles;
drop policy if exists "read own progress" on user_dance_progress;
drop policy if exists "write own progress" on user_dance_progress;
drop policy if exists "read own venues" on user_venues;
drop policy if exists "write own venues" on user_venues;
drop policy if exists "read own venue dances" on user_venue_dances;
drop policy if exists "write own venue dances" on user_venue_dances;
create policy "read own profile" on profiles for select using (auth.uid() = id);
create policy "update own profile" on profiles for update using (auth.uid() = id);
create policy "read own progress" on user_dance_progress for select using (auth.uid() = user_id);
create policy "write own progress" on user_dance_progress for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "read own venues" on user_venues for select using (auth.uid() = user_id);
create policy "write own venues" on user_venues for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "read own venue dances" on user_venue_dances for select using (auth.uid() = user_id);
create policy "write own venue dances" on user_venue_dances for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Views need an explicit grant even once the table they read from has RLS —
-- the view's own owner-privilege bypass only matters if a role can select
-- from the view at all.
grant select on venue_dance_reports to authenticated;
