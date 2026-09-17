-- Just One More Dance: snapshot BootStepper's music/video links onto each
-- saved dance, same as dance_name/dance_song/dance_difficulty already are.
--
-- Run ONCE. Idempotent.
--
-- Why snapshot these at all, when Dance is normally resolved fresh from
-- BootStepper every time (see src/lib/bootstepper.ts)? Two reasons:
--   1. My List's offline/fallback rendering (danceFromProgress in
--      MyListScreen.tsx) only has what's on the progress row — without
--      this, a dance's video/music links would vanish whenever a live
--      BootStepper re-fetch hasn't happened yet (cold start, offline).
--   2. The planned "create a playlist" feature (Spotify/Apple Music) needs
--      to read every saved dance's track link in bulk — pulling that from
--      a live BootStepper round-trip per dance, for a list that could be
--      hundreds of dances long, isn't something to build on.
--
-- No RLS changes needed — "write own progress" / "read own progress" /
-- "read friends progress" (migration_friend_requests.sql) already cover
-- every column on user_dance_progress, these included.
--
-- Existing rows backfill themselves: App.tsx already re-resolves any dance
-- it only has a stale/snapshot copy of from BootStepper on every app open
-- (see the "Resolve dance ids saved in progress" effect) — that same pass
-- now also writes these columns, so every user's existing dances pick up
-- their links the next time they open the app. No bulk backfill script.

alter table user_dance_progress add column if not exists dance_spotify_track_id text;
alter table user_dance_progress add column if not exists dance_spotify_url text;
alter table user_dance_progress add column if not exists dance_apple_music_url text;
alter table user_dance_progress add column if not exists dance_youtube_music_url text;
alter table user_dance_progress add column if not exists dance_amazon_music_url text;
alter table user_dance_progress add column if not exists dance_teach_video_url text;
