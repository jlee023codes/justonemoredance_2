-- Just One More Dance: rename profiles.is_premium -> comped_premium.
--
-- Run ONCE, after migration_premium_venues.sql. Idempotent.
--
-- Purely a naming clarity fix: this column was never meant to represent a
-- real RevenueCat entitlement (the app checks that live via the SDK — see
-- src/lib/entitlements.ts) — it's the manual "I comped this person in the
-- database" flag. The old name read like a general premium flag and
-- invited confusion with the real one.

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'is_premium'
  ) then
    alter table profiles rename column is_premium to comped_premium;
  end if;
end $$;

create or replace view venue_dance_reports as
select
  d.venue_id,
  d.dance_id,
  max(d.dance_name) as dance_name,
  max(d.dance_song) as dance_song,
  max(d.dance_difficulty) as dance_difficulty,
  count(distinct d.user_id)::int as reported_by
from user_venue_dances d
join profiles p on p.id = d.user_id and p.comped_premium
group by d.venue_id, d.dance_id;

grant select on venue_dance_reports to authenticated;
notify pgrst, 'reload schema';
