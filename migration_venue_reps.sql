-- Just One More Dance: venue representatives.
--
-- venue_nights (migration_venue_nights.sql) was briefly open to any
-- signed-in user as first-submission-wins — too risky for real listing
-- data (wrong cover/age/times are easy to plant and hard to spot), so
-- writes are locked down: only the product owner (is_admin, same
-- manual-flag pattern as profiles.comped_premium) or an approved
-- representative for that specific venue can add/edit/remove its
-- nights. Everyone else still proposes a change via "Submit a
-- revision" (unchanged), or requests to become a venue's rep here.

alter table profiles add column if not exists is_admin boolean not null default false;
-- Manual, product-owner-only flag — the app never writes this itself.
-- Find your user id, then set it directly in the SQL editor:
--   select id from auth.users where email = '<your login email>';
--   update profiles set is_admin = true where id = '<your user id>';
-- An admin is treated as an approved rep for every venue (see
-- can_manage_venue below) — no per-venue row needed.

create table if not exists venue_representatives (
  user_id uuid not null references auth.users(id) on delete cascade,
  venue_id text not null references venues(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'approved', 'denied')),
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  primary key (user_id, venue_id)
);

alter table venue_representatives enable row level security;

-- Anyone can see their own request's status — no need to see others'.
drop policy if exists "read own rep status" on venue_representatives;
create policy "read own rep status" on venue_representatives for select to authenticated
  using (user_id = auth.uid());

-- Anyone can request to represent a venue — always lands as 'pending',
-- and can't self-approve. No update/delete grant: only the owner
-- approves or denies, directly via SQL:
--   update venue_representatives set status = 'approved', decided_at = now()
--     where user_id = '<user id>' and venue_id = '<venue id>';
drop policy if exists "request to be a rep" on venue_representatives;
create policy "request to be a rep" on venue_representatives for insert to authenticated
  with check (user_id = auth.uid() and status = 'pending');

grant select, insert on venue_representatives to authenticated;

create or replace function public.can_manage_venue(target_venue_id text)
returns boolean language sql stable as $$
  select
    exists (select 1 from profiles where id = auth.uid() and is_admin)
    or exists (
      select 1 from venue_representatives
      where venue_id = target_venue_id and user_id = auth.uid() and status = 'approved'
    )
$$;

-- Replaces migration_venue_nights.sql's fully-open insert policy.
-- Approved reps (and admins) get full manage rights on their own
-- venue's nights, not just a one-shot first-submission-wins insert —
-- they're vetted by the owner, so letting them fix their own typos
-- directly is safe.
drop policy if exists "add venue night" on venue_nights;
drop policy if exists "manage venue nights" on venue_nights;
create policy "manage venue nights" on venue_nights for all to authenticated
  using (public.can_manage_venue(venue_id))
  with check (public.can_manage_venue(venue_id));

grant update, delete on venue_nights to authenticated;
-- select, insert were already granted by migration_venue_nights.sql.
