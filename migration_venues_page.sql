-- =====================================================================
-- Venues page: browse every venue in the shared catalog and see which
-- dances people have reported dancing there. Run ONCE, after the earlier
-- migrations. Idempotent.
--
-- `venue_dance_reports` aggregates user_venue_dances across *everyone* —
-- dance + how many distinct people tagged it to that venue — without
-- exposing who. A bare view (not security_invoker) runs as its owner and
-- so bypasses the per-user RLS on user_venue_dances: the underlying rows
-- stay private, only this aggregate is public.
-- =====================================================================

create or replace view venue_dance_reports as
select
  venue_id,
  dance_id,
  max(dance_name) as dance_name,
  max(dance_song) as dance_song,
  max(dance_difficulty) as dance_difficulty,
  count(distinct user_id)::int as reported_by
from user_venue_dances
group by venue_id, dance_id;

grant select on venue_dance_reports to authenticated;

-- Nudge PostgREST to pick up the new view instead of waiting for its next
-- periodic schema poll.
notify pgrst, 'reload schema';
