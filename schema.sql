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

create table venues (
  id text primary key,
  name text not null unique
);
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  default_venue_id text references venues(id) on delete set null
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
insert into venues (id, name) values
  ('cancun-cantina', 'Cancun Cantina'), ('neon-boots', 'Neon Boots'),
  ('starlight', 'Starlight Saloon'), ('boot-scoot', 'Boot Scoot Social'),
  ('copper', 'The Copper Room') on conflict (id) do update set name = excluded.name;

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
