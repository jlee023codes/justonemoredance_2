-- Just One More Dance: My List -> Spotify / Apple Music playlist sync.
--
-- Run ONCE. Idempotent.
--
-- Two providers, two account tables (locked down, service-role only) and
-- two playlist tables (owner-readable, service-role writable). See
-- supabase/functions/spotify-sync and supabase/functions/apple-music-sync
-- for the only code that ever touches the account tables.

-- ---------------------------------------------------------------------
-- Spotify
-- ---------------------------------------------------------------------

-- OAuth tokens. No RLS policies at all for `authenticated` (RLS defaults
-- to deny with no matching policy) -- only the spotify-sync edge
-- function's service-role client (same pattern as
-- supabase/functions/delete-account/index.ts) ever reads/writes this table, so
-- a refresh token can never reach the client.
create table if not exists user_spotify_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  spotify_user_id text not null,
  refresh_token text not null,
  access_token text,
  access_token_expires_at timestamptz,
  connected_at timestamptz not null default now()
);
alter table user_spotify_accounts enable row level security;

-- Narrow, safe read surface for the client to answer "am I connected" --
-- no policy exposes the base table to `authenticated` at all (see above),
-- but a plain view (not security_invoker) runs as its owner, which
-- bypasses RLS on the table it selects from -- so this view's own `where
-- user_id = auth.uid()` is what scopes it per-user, not the base table's
-- (nonexistent) policy. Never add refresh_token/access_token here.
create or replace view my_spotify_account as
  select user_id, spotify_user_id, connected_at
  from user_spotify_accounts
  where user_id = auth.uid();
grant select on my_spotify_account to authenticated;

create table if not exists user_spotify_playlists (
  user_id uuid primary key references auth.users(id) on delete cascade,
  playlist_id text not null,
  playlist_url text,
  -- ids JOMD is actively managing in this playlist -- NOT a snapshot of
  -- what's live. See src/lib/playlistDiff.ts for how this is diffed.
  last_synced_track_ids jsonb not null default '[]'::jsonb,
  last_synced_at timestamptz,
  created_at timestamptz not null default now()
);
alter table user_spotify_playlists enable row level security;

drop policy if exists "read own spotify playlist" on user_spotify_playlists;
create policy "read own spotify playlist" on user_spotify_playlists
  for select using (auth.uid() = user_id);
-- insert/update/delete: none -- service-role only, so a client can't
-- forge last_synced_track_ids and corrupt the diff.

-- ---------------------------------------------------------------------
-- Apple Music
-- ---------------------------------------------------------------------

-- No refresh-token model -- the Music User Token comes from MusicKit's
-- authorize() client-side. Still locked down the same way: no RLS
-- policies for `authenticated`, service-role only.
create table if not exists user_apple_music_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  music_user_token text not null,
  connected_at timestamptz not null default now()
);
alter table user_apple_music_accounts enable row level security;

-- Same narrow-view pattern as my_spotify_account above -- never add
-- music_user_token here.
create or replace view my_apple_music_account as
  select user_id, connected_at
  from user_apple_music_accounts
  where user_id = auth.uid();
grant select on my_apple_music_account to authenticated;

create table if not exists user_apple_music_playlists (
  user_id uuid primary key references auth.users(id) on delete cascade,
  playlist_id text not null,
  last_synced_track_ids jsonb not null default '[]'::jsonb,
  last_synced_at timestamptz,
  created_at timestamptz not null default now()
);
alter table user_apple_music_playlists enable row level security;

drop policy if exists "read own apple music playlist" on user_apple_music_playlists;
create policy "read own apple music playlist" on user_apple_music_playlists
  for select using (auth.uid() = user_id);

-- ---------------------------------------------------------------------
-- Resolved Apple Music catalog track ids, cached per dance (Apple's API
-- needs a catalog id, not the share URL BootStepper gives us -- see
-- src/lib/appleMusicSync.ts for its resolution/fallback logic).
-- ---------------------------------------------------------------------

alter table user_dance_progress add column if not exists
  dance_apple_music_track_id text;

-- ---------------------------------------------------------------------
-- Profile preferences
-- ---------------------------------------------------------------------

-- Which My List statuses go into the playlist. Read by both providers'
-- sync-plan step.
alter table profiles add column if not exists playlist_sync_scope text
  not null default 'learning_learned'
  check (playlist_sync_scope in ('all', 'learning_learned', 'learned'));

-- Manual per-user allowlist for Spotify's 5-user developer-mode cap, same
-- pattern as comped_premium (see migration_comped_premium_rename.sql /
-- src/lib/entitlements.ts). Flip true by hand here for each of the 5
-- testers whose Spotify email you've also allowlisted in Spotify's own
-- dashboard:
--   update profiles set spotify_beta_enabled = true where id = '<their user id>';
-- "Connect Spotify" stays hidden in Profile until this is true. Apple
-- Music has no such gate.
alter table profiles add column if not exists spotify_beta_enabled boolean
  not null default false;
