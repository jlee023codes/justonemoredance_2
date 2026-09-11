-- Just One More Dance: make "Premium" actually mean something at the
-- database level for venues, not just a client-side screen gate.
--
-- Run ONCE, after the earlier migrations. Idempotent.
--
--  1. profiles.is_premium — a real (if temporary) server-side flag. Until
--     RevenueCat is wired up, the app writes this to the signed-in user's
--     own row when the local dev-preview toggle changes (see
--     src/lib/entitlements.ts). That's fine as a stand-in but is NOT a
--     real entitlement check — a client can always assert anything about
--     itself. Once RevenueCat exists, this column should be written only
--     by a server-side webhook handler, never by the app directly.
--  2. venue_dance_reports now only counts a *premium* user's venue-tagged
--     dances. A free user's own tags stay invisible to the shared
--     aggregate (and they can't read the aggregate at all — that's the
--     existing Venues-tab paywall) until they go Premium, at which point
--     their history counts immediately since this is a live view.

alter table profiles add column if not exists is_premium boolean not null default false;

create or replace view venue_dance_reports as
select
  d.venue_id,
  d.dance_id,
  max(d.dance_name) as dance_name,
  max(d.dance_song) as dance_song,
  max(d.dance_difficulty) as dance_difficulty,
  count(distinct d.user_id)::int as reported_by
from user_venue_dances d
join profiles p on p.id = d.user_id and p.is_premium
group by d.venue_id, d.dance_id;

grant select on venue_dance_reports to authenticated;
notify pgrst, 'reload schema';
