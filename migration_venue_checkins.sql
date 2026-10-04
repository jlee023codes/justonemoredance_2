create table if not exists venue_checkins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  venue_id text not null references venues(id) on delete cascade,
  latitude double precision not null,
  longitude double precision not null,
  checked_in_at timestamptz not null default now()
);

alter table venue_checkins enable row level security;

drop policy if exists "manage own checkins" on venue_checkins;
create policy "manage own checkins" on venue_checkins for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

grant select, insert on venue_checkins to authenticated;

-- Same aggregate-exposure pattern as venue_dance_reports (schema.sql) —
-- a bare view exposing only a distinct-user count, never who checked
-- in. This is a NEW "Verified" signal, separate from address_verified
-- (which stays the existing admin-only manual stamp).
create or replace view venue_checkin_counts as
select venue_id, count(distinct user_id)::int as checkin_count
from venue_checkins
group by venue_id;

grant select on venue_checkin_counts to authenticated;
