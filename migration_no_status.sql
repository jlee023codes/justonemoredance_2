-- Just One More Dance: allow a dance to sit in My List with no status set.
--
-- Run ONCE. Idempotent.
--
-- Deselecting a dance's active status (tapping the lit quick-status
-- button again) used to delete its progress row outright — the dance
-- disappeared from My List entirely. That's not what "deselect" should
-- do; it should just clear the status and leave the dance in the list.
-- 'none' is already the app's type-level placeholder for "no status"
-- (src/types.ts's LearningStatus) — this just teaches the database to
-- accept it as a real, storable value instead of only 'want' / 'learning'
-- / 'learned'.

alter table user_dance_progress drop constraint if exists user_dance_progress_status_check;
alter table user_dance_progress add constraint user_dance_progress_status_check
  check (status in ('none','want','learning','learned'));
