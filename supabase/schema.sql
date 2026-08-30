-- Just One More Dance: PostgreSQL schema for Supabase's free tier.
-- Dance names are unique user-facing keys; `id` is a single-token, URL-safe key.
create table venues (
  id text primary key,
  name text not null unique
);
create table dances (
  id text primary key check (id ~ '^[a-z0-9-]+$'),
  name text not null unique,
  default_song text not null,
  difficulty text not null check (difficulty in ('Beginner','Improver','Intermediate','Advanced')),
  details text not null default ''
);
create table dance_venue_songs (
  dance_id text references dances(id) on delete cascade,
  venue_id text references venues(id) on delete cascade,
  song_name text not null,
  primary key (dance_id, venue_id)
);
create table song_swaps (
  id uuid primary key default gen_random_uuid(),
  dance_id text not null references dances(id) on delete cascade,
  song_name text not null,
  venue_id text references venues(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (dance_id, song_name, venue_id)
);
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  default_venue_id text references venues(id) on delete set null
);
create table user_dance_progress (
  user_id uuid references profiles(id) on delete cascade,
  dance_id text references dances(id) on delete cascade,
  status text not null check (status in ('want','learned')),
  personal_venue_id text references venues(id) on delete set null,
  personal_song_swap text,
  source text not null default 'self' check (source in ('self','friend')),
  updated_at timestamptz not null default now(),
  primary key (user_id, dance_id)
);
create table shared_lists (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);
create table shared_list_dances (
  shared_list_id uuid references shared_lists(id) on delete cascade,
  dance_id text references dances(id) on delete cascade,
  song_swap text,
  venue_id text references venues(id) on delete set null,
  primary key (shared_list_id, dance_id, song_swap)
);


-- Run this section after the schema above. It seeds the catalog IDs used by the app,
-- creates a profile for each newly registered user, and protects user data with RLS.
insert into venues (id, name) values
  ('cancun-cantina', 'Cancun Cantina'), ('neon-boots', 'Neon Boots'),
  ('starlight', 'Starlight Saloon'), ('boot-scoot', 'Boot Scoot Social'),
  ('copper', 'The Copper Room') on conflict (id) do update set name = excluded.name;
insert into dances (id, name, default_song, difficulty, details) values
  ('a-bar-song', 'A Bar Song', 'A Bar Song (Tipsy) — Shaboozey', 'Beginner', '32 count • 4 wall'),
  ('walk-the-line', 'Walk the Line', 'Freight Train', 'Improver', '26 count • 2 wall'),
  ('domino', 'Domino', 'Domino — Jessie J', 'Intermediate', '64 count • 4 wall • 1 restart'),
  ('red-high-heels', 'Red High Heels', 'Red High Heels - Kellie Pickler.', 'Beginner', '32 count • 4 walls'),
  ('redneck-angel', 'Redneck Angel', 'Redneck Angel - Dean Crawford & the Dunn''s River band', 'Beginner', '16 count • 4 walls'),
  ('electric-slide', 'Electric Slide', 'Electric Boogie — Marcia Griffiths', 'Beginner', '18-count + 4-wall'),
  ('watermelon-crawl', 'Watermelon Crawl', 'Watermelon Crawl — Tracy Byrd', 'Beginner', '32-count, 4-wall country favorite with heel steps.'),
  ('copperhead-road', 'Copperhead Road', 'Copperhead Road — Steve Earle', 'Improver', '32-count, 4-wall energetic stomp and kick dance.'),
  ('shivers', 'Shivers', 'Shivers — Ed Sheeran', 'Intermediate', '32-count, 4-wall dance with lively syncopated turns.'),
  ('footloose', 'Footloose', 'Footloose — Kenny Loggins', 'Improver', '32-count, 4-wall party-starter with grapevines and kicks.')
on conflict (id) do update set name = excluded.name, default_song = excluded.default_song, difficulty = excluded.difficulty, details = excluded.details;

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
alter table dances enable row level security;
alter table dance_venue_songs enable row level security;
alter table song_swaps enable row level security;
alter table profiles enable row level security;
alter table user_dance_progress enable row level security;
alter table shared_lists enable row level security;
alter table shared_list_dances enable row level security;

-- The catalog is readable but cannot be changed from the mobile app.
drop policy if exists "read venues" on venues;
drop policy if exists "read dances" on dances;
drop policy if exists "read venue songs" on dance_venue_songs;
drop policy if exists "read song swaps" on song_swaps;
create policy "read venues" on venues for select to authenticated using (true);
create policy "read dances" on dances for select to authenticated using (true);
create policy "read venue songs" on dance_venue_songs for select to authenticated using (true);
create policy "read song swaps" on song_swaps for select to authenticated using (true);
drop policy if exists "read own profile" on profiles;
drop policy if exists "update own profile" on profiles;
drop policy if exists "read own progress" on user_dance_progress;
drop policy if exists "write own progress" on user_dance_progress;
create policy "read own profile" on profiles for select using (auth.uid() = id);
create policy "update own profile" on profiles for update using (auth.uid() = id);
create policy "read own progress" on user_dance_progress for select using (auth.uid() = user_id);
create policy "write own progress" on user_dance_progress for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
