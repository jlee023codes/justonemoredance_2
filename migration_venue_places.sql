-- Just One More Dance: real coordinates + a Google Place id for venues,
-- so "Add a venue" can use Google Places autocomplete instead of a bare
-- free-text name, and a venue with an address can offer Get Directions.
--
-- Run ONCE.

alter table venues add column if not exists latitude double precision;
alter table venues add column if not exists longitude double precision;
alter table venues add column if not exists google_place_id text;
create unique index if not exists venues_google_place_id_uniq
  on venues (google_place_id) where google_place_id is not null;

-- Same "first submission wins" trust model as address
-- (migration_venue_address.sql) — fill once, locked after.
drop policy if exists "fill venue location" on venues;
create policy "fill venue location" on venues for update to authenticated
  using (latitude is null)
  with check (true);

-- venues already has, from migration_venue_address.sql:
--   revoke update on venues from authenticated;
--   grant update (address) on venues to authenticated;
-- Widen that same grant rather than issuing a second revoke/grant pair.
grant update (latitude, longitude, google_place_id) on venues to authenticated;
