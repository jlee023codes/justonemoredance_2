-- One-off cleanup: closes out check-ins that were never properly
-- ended (ended_at is null) because the app was killed/crashed before
-- the geofence or manual "Done Dancing" ever fired — e.g. the test
-- check-in at Cancun Cantina stuck open for 2 days. The live-
-- detection code (loadLiveVenueIds/loadLiveVenueView) now ignores
-- these via a 4-hour staleness cutoff, but the underlying rows
-- themselves were never closed — this does that, matching the same
-- "no activity in 4+ hours" definition of abandoned.
--
-- Scoped the same way loadLiveVenueIds judges staleness: a check-in
-- counts as abandoned only if BOTH its own checked_in_at AND the
-- venue's most recent logged dance (if any) are older than 4 hours —
-- so a long, still-genuinely-ongoing night doesn't get closed out
-- just because the person checked in many hours ago.
--
-- ended_at is set to checked_in_at itself (not now()) since there's
-- no real "when did they leave" signal for an abandoned session —
-- this makes it read as a near-zero-duration entry in Stats history
-- rather than implying a night-long session that never happened.
-- end_reason is a new value distinct from the existing
-- "manual"/"geofence"/"backfilled" set, so it's visibly
-- distinguishable from a real session if it ever surfaces in Stats.

update venue_checkins c
set ended_at = c.checked_in_at,
    end_reason = 'abandoned'
where c.ended_at is null
  and c.checked_in_at < now() - interval '4 hours'
  and not exists (
    select 1 from venue_live_dances d
    where d.venue_id = c.venue_id
      and d.logged_at >= now() - interval '4 hours'
  );
