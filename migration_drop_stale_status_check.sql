-- Just One More Dance: drop a stray duplicate check constraint on
-- user_dance_progress.status.
--
-- Run ONCE. Idempotent.
--
-- Both migration_friend_requests.sql and migration_learning_status.sql
-- manage a constraint named user_dance_progress_status_check (drop-if-
-- exists then re-add), which should always leave exactly one constraint
-- of that name. Somewhere along the way a second one ended up created
-- with a "_v2" suffix instead of being cleanly replaced — likely from an
-- edit made directly in Supabase's Table Editor, which can auto-suffix a
-- constraint name rather than erroring on a collision.
--
-- Since Postgres enforces every check constraint on a table (ANDed
-- together), that stale _v2 constraint — still requiring the old
-- ('maybe','want','learned') set — silently blocked 'learning' even
-- though the correctly-named constraint already allowed it.

alter table user_dance_progress drop constraint if exists user_dance_progress_status_check_v2;
