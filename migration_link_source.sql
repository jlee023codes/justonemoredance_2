-- Just One More Dance: track whether a dance's video link came from
-- BootStepper's own teach video or was added/edited by the user.
--
-- Run ONCE. Idempotent.
--
-- Existing rows are left null (unknown/legacy) here — see the follow-up
-- one-off reclassification pass (same shape as
-- supabase/functions/backfill-teach-video-links, run once and deleted)
-- that fills these in by re-checking each dance against BootStepper.

alter table user_dance_progress add column if not exists link_source text
  check (link_source in ('bootstepper', 'user'));
