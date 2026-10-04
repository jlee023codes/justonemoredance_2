-- Manual/backfilled sessions: a night the user forgot to check in for
-- at all, added after the fact from Stats. Reuses venue_checkins
-- (already "one row per check-in event") rather than a new table —
-- same "extend this row" convention as migration_checkin_sessions.sql
-- and migration_checkin_session_dances.sql. A backfilled row is
-- inserted already closed out (ended_at set immediately), with no
-- real GPS fix, so latitude/longitude need to become nullable.
--
-- end_reason gains a third value, 'backfilled', distinct from
-- 'manual' (today's meaning: "a live session the user ended normally
-- via Done Dancing") — Stats needs to tell the two apart (e.g. to
-- show "steps: N/A — not live tracked" only for a session that was
-- never live, not one that just didn't get a pedometer reading).

alter table venue_checkins alter column latitude drop not null;
alter table venue_checkins alter column longitude drop not null;

notify pgrst, 'reload schema';
