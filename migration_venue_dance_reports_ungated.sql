-- Drops the premium gate on venue_dance_reports entirely. Today's view
-- (see migration_comped_premium_rename.sql) joins on
-- `p.comped_premium`, which means a non-premium user's own tagged
-- dances never count toward a venue's shared "What's Playing" list —
-- for anyone, not just that user. Venues is a free-for-everyone part
-- of the app now; dance-reporting should be too.
--
-- Not the same thing as the free-tier display cap in
-- VenueDancesModal.tsx (top 20 reported dances per venue for free
-- accounts) — that's a separate, already-decided viewer-side cap and
-- is untouched here. This migration is about which CONTRIBUTIONS get
-- counted at all, regardless of who's viewing.

create or replace view venue_dance_reports as
select
  d.venue_id,
  d.dance_id,
  max(d.dance_name) as dance_name,
  max(d.dance_song) as dance_song,
  max(d.dance_difficulty) as dance_difficulty,
  count(distinct d.user_id)::int as reported_by
from user_venue_dances d
group by d.venue_id, d.dance_id;

grant select on venue_dance_reports to authenticated;
notify pgrst, 'reload schema';
