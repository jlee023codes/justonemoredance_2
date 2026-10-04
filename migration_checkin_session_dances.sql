-- Stores exactly which dances were logged during a session, so Stats
-- can show "what did I dance that night" precisely — not an
-- approximation of "everything this user ever tagged to that venue"
-- (user_venue_dances has no per-session boundary, and a user can
-- check into the same venue on different nights). A small JSON array
-- on the same venue_checkins row is simplest: no new table, no new
-- RLS to write, matches the "extend this row" pattern already used
-- for ended_at/end_reason/step_count.

alter table venue_checkins
  add column if not exists logged_dances jsonb not null default '[]'::jsonb;

notify pgrst, 'reload schema';
