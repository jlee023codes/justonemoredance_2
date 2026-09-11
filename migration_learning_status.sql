-- Just One More Dance: replace "Save for Later" (maybe) with "Learning now"
-- (learning).
--
-- The status model becomes Want -> Learning -> Learned instead of
-- Later/Want/Learned: adding a dance means you Want it, moving it to
-- Learning means you're actively working on it, Learned means you've got
-- it. "Review" (going back to practice a Learned dance) now lands it back
-- in Learning, not Want.
--
-- Run ONCE, after the earlier migrations. Idempotent.

-- Existing "Later" rows become "Want" — the user picked the dance, so it
-- belongs on their list; "learning" is new, not a renaming of "maybe", so
-- there's nothing to backfill into it.
update user_dance_progress set status = 'want' where status = 'maybe';

alter table user_dance_progress drop constraint if exists user_dance_progress_status_check;
alter table user_dance_progress add constraint user_dance_progress_status_check
  check (status in ('want','learning','learned'));
