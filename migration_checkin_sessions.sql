-- Turns a check-in from a fire-and-forget event into a trackable
-- session: adds the columns needed to close one out (when it ended,
-- why, how much of it was paused, and steps gained). Same table as
-- migration_venue_checkins.sql — it's already "one row per check-in
-- event" with the right owner-only RLS, no new table needed.
--
-- `grant update` is new: the existing RLS policy is `for all`, but
-- only select/insert were ever granted — a session needs to be closed
-- out by its own owner, which requires an update.

alter table venue_checkins
  add column if not exists ended_at timestamptz,
  add column if not exists end_reason text, -- 'manual' | 'geofence'
  add column if not exists paused_seconds int not null default 0,
  add column if not exists step_count int;

grant update on venue_checkins to authenticated;

-- PostgREST caches the table schema and won't see the new columns
-- (or the new grant) until told to reload — without this, the client
-- keeps failing with "Could not find the 'end_reason' column" even
-- though the ALTER already succeeded.
notify pgrst, 'reload schema';
