-- Supersedes migration_venue_details.sql's flat line_dancing_nights /
-- cover_details / age_details columns with a venue_nights table, one
-- row per day of the week — a single free-text field couldn't support
-- "show me every venue dancing Wednesday," and real schedules vary
-- cover/age/time by night anyway. Nothing had been submitted through
-- the old fields yet, so this is a clean swap, not a backfill.

drop policy if exists "fill venue details" on venues;
alter table venues drop column if exists line_dancing_nights;
alter table venues drop column if exists cover_details;
alter table venues drop column if exists age_details;

-- details_locked stays on venues (added in migration_venue_details.sql)
-- — now means "this venue's schedule is locked, no more day
-- submissions accepted." Still admin-only, same as before:
--   update venues set details_locked = true where id = '<venue id>';

-- Free text per day keeps this flexible for irregular cases ("last
-- Sunday of month, family day, no cover") without a rigid
-- start/end-time/age/cover column set.
create table if not exists venue_nights (
  venue_id text not null references venues(id) on delete cascade,
  day_of_week text not null check (day_of_week in ('sun','mon','tue','wed','thu','fri','sat')),
  details text not null,
  added_by uuid references auth.users(id) on delete set null,
  added_at timestamptz not null default now(),
  primary key (venue_id, day_of_week)
);

alter table venue_nights enable row level security;

drop policy if exists "read venue nights" on venue_nights;
create policy "read venue nights" on venue_nights for select to authenticated using (true);

-- First-submission-wins by construction: the primary key blocks a
-- second row for the same (venue, day). No update/delete grant at all —
-- a correction always goes through "Submit a revision"
-- (VenueRevisionModal.tsx), and the owner applies it by hand via SQL,
-- same as every other crowdsourced field in this app.
drop policy if exists "add venue night" on venue_nights;
create policy "add venue night" on venue_nights for insert to authenticated
  with check (
    not exists (select 1 from venues v where v.id = venue_id and v.details_locked)
  );

grant select, insert on venue_nights to authenticated;
