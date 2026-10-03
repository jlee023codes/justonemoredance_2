alter table venues add column if not exists line_dancing_nights text;
alter table venues add column if not exists cover_details text;
alter table venues add column if not exists age_details text;
alter table venues add column if not exists details_locked boolean not null default false;

-- Same first-submission-wins shape as address/location
-- (migration_venue_address.sql, migration_venue_places.sql), gated by
-- the new lock flag. Eligible while ANY of the three fields is still
-- blank (and not locked) — the column GRANT below is what actually
-- restricts which columns can be written, same as those migrations.
drop policy if exists "fill venue details" on venues;
create policy "fill venue details" on venues for update to authenticated
  using (
    not details_locked
    and (line_dancing_nights is null or cover_details is null or age_details is null)
  )
  with check (true);

grant update (line_dancing_nights, cover_details, age_details) on venues to authenticated;
-- details_locked is deliberately NEVER granted to authenticated — same
-- admin-only-via-table-owner pattern as address_verified
-- (migration_venue_address.sql). Flip it by hand in the SQL editor:
--   update venues set details_locked = true where id = '<venue id>';

-- SUPERSEDED by migration_venue_nights.sql — line_dancing_nights/
-- cover_details/age_details turned out not to fit real schedules
-- (cover/age vary per night). This file is kept as the historical
-- record of what was actually run; don't edit it further.
