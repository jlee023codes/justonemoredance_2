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
