-- Snapshot of a session's collaborative "danced %" stat, computed
-- once at endSession time and stored alongside the other session
-- summary columns (same "extend this row" convention as
-- migration_checkin_sessions.sql / migration_checkin_session_dances.sql).
-- A snapshot, not live-recomputed, so a past Stats card stays stable
-- even if the underlying venue_live_dances rows are ever pruned later.
-- Kept in its own file, separate from migration_venue_live_sessions.sql,
-- so the core live-session infra and this Stats-history plumbing can
-- be reviewed/rolled out independently.

alter table venue_checkins
  add column if not exists live_danced_count int,
  add column if not exists live_total_count int;

notify pgrst, 'reload schema';
