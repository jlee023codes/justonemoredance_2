-- Just One More Dance: drop dance_teach_video_url.
--
-- Run ONCE. Idempotent.
--
-- Superseded by a simpler approach: the teach video is now just
-- `user_dance_progress.link` (the same column the Apple Notes import and
-- the dance modal's "Video link" field already use), seeded from
-- BootStepper's own teach video the first time a dance is added (see
-- handleQuickStatus in App.tsx) instead of tracked as its own always-synced
-- snapshot column. This column (added in migration_dance_music_links.sql)
-- is now dead weight.

alter table user_dance_progress drop column if exists dance_teach_video_url;
