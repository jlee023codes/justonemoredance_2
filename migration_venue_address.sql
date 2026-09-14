-- Just One More Dance: venue addresses (city/state).
--
-- Run ONCE. Idempotent.
--
-- Adds a crowdsourced "city, state" to each venue — shown as
-- "Cancun Cantina - Hanover, MD" in the Venues page's venue picker.
-- Premium-gated in the app (VenuePicker's showAddress prop), same as the
-- Venues tab itself already is; the DB side just lets anyone signed in fill
-- in a still-blank address (first submission wins), same trust level as
-- adding a venue in the first place.

alter table venues add column if not exists address text;
alter table venues add column if not exists address_verified boolean not null default false;

-- Anyone can fill in a venue's address once — but only while it's still
-- blank. Once set, it can't be overwritten from the app (matches "existing
-- venues can't be edited/renamed" for the name itself); fix a wrong one
-- directly in the SQL editor if it ever comes up:
--   update venues set address = '...' where id = '...';
drop policy if exists "fill venue address" on venues;
create policy "fill venue address" on venues for update to authenticated
  using (address is null)
  with check (true);

-- address_verified is a manual, product-owner-only stamp ("this address
-- was confirmed with the venue itself") — not something any signed-in user
-- should be able to set, even by crafting a raw request around the app's
-- own UI. RLS alone can't express "this column is off-limits" (a row-level
-- policy's `with check` can't stop a client from also including
-- address_verified in the same update as long as the row itself is
-- eligible), so this restricts it at the grant level instead: authenticated
-- users can only ever UPDATE the `address` column, full stop. Approve a
-- venue directly in the SQL editor (running as the table owner, which
-- bypasses both RLS and this grant):
--   update venues set address_verified = true where id = '<venue id>';
revoke update on venues from authenticated;
grant update (address) on venues to authenticated;
