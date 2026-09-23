-- Just One More Dance: My List -> YouTube playlist sync (reference videos).
--
-- Run ONCE. Idempotent. Third provider, same shape as
-- migration_playlist_sync.sql's Spotify tables -- see
-- supabase/functions/youtube-sync for the only code that ever touches
-- user_youtube_accounts.

-- OAuth tokens. No RLS policies at all for `authenticated` (RLS defaults
-- to deny with no matching policy) -- only the youtube-sync edge
-- function's service-role client ever reads/writes this table, so a
-- refresh token can never reach the client.
create table if not exists user_youtube_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  google_user_id text not null,
  refresh_token text not null,
  access_token text,
  access_token_expires_at timestamptz,
  connected_at timestamptz not null default now()
);
alter table user_youtube_accounts enable row level security;

-- Narrow, safe read surface for the client to answer "am I connected" --
-- same pattern as my_spotify_account. Never add refresh_token/access_token
-- here.
create or replace view my_youtube_account as
  select user_id, google_user_id, connected_at
  from user_youtube_accounts
  where user_id = auth.uid();
grant select on my_youtube_account to authenticated;

create table if not exists user_youtube_playlists (
  user_id uuid primary key references auth.users(id) on delete cascade,
  playlist_id text not null,
  playlist_url text,
  -- video ids JOMD is actively managing in this playlist -- NOT a
  -- snapshot of what's live. See supabase/functions/_shared/playlistDiff.ts.
  last_synced_video_ids jsonb not null default '[]'::jsonb,
  last_synced_at timestamptz,
  created_at timestamptz not null default now()
);
alter table user_youtube_playlists enable row level security;

drop policy if exists "read own youtube playlist" on user_youtube_playlists;
create policy "read own youtube playlist" on user_youtube_playlists
  for select using (auth.uid() = user_id);
-- insert/update/delete: none -- service-role only, so a client can't
-- forge last_synced_video_ids and corrupt the diff.

-- Separate from profiles.playlist_sync_scope (which stays Spotify/Apple-
-- Music-only) -- a user may reasonably want e.g. "Learned only" for music
-- but "Everything" for reference videos.
alter table profiles add column if not exists youtube_sync_scope text
  not null default 'learning_learned'
  check (youtube_sync_scope in ('all', 'learning_learned', 'learned'));
