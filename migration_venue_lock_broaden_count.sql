-- Broadens what counts toward the 5-person unlock threshold: tagging
-- a dance to a venue from a dance card (user_venue_dances — no GPS,
-- no session, much lower-friction and more common) now counts
-- alongside an actual GPS check-in (venue_checkins), not just
-- check-ins alone. Kept as a NEW view rather than changing
-- venue_checkin_counts itself — that view backs the separate
-- "Verified" badge (VERIFIED_THRESHOLD = 3 in src/services/venues.ts),
-- which should stay a stronger, check-ins-only signal.

create or replace view venue_public_counts as
select venue_id, count(distinct user_id)::int as public_count
from (
  select venue_id, user_id from venue_checkins
  union
  select venue_id, user_id from user_venue_dances
) combined
group by venue_id;

grant select on venue_public_counts to authenticated;

drop policy if exists "read venues" on venues;
create policy "read venues" on venues for select
  using (
    created_by = auth.uid()
    or exists (
      select 1 from user_venues uv
      where uv.venue_id = venues.id and uv.user_id = auth.uid()
    )
    or exists (
      select 1 from venue_public_counts c
      where c.venue_id = venues.id and c.public_count >= 5
    )
  );

notify pgrst, 'reload schema';
