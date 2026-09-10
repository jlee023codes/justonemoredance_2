-- =====================================================================
-- Venue catalog hardening. Run ONCE, after the earlier migrations.
-- Idempotent.
--
--  1. `name_key` — a normalized (lowercase, alphanumeric-only) form of the
--     venue name, unique, so "Neon Boots", "neon boots" and "Neon  Boots!"
--     can't become three rows.
--  2. Collapses any duplicates that already exist, repointing every
--     user_venues / user_venue_dances / shared_list_dances reference.
--  3. `venue_votes` — one thumbs-up per user per venue, a community signal
--     for "this is a real venue" shown in the picker. Adding a venue to
--     your list counts as an endorsement.
-- =====================================================================

create or replace function public.venue_key(name text)
returns text language sql immutable as $$
  select regexp_replace(lower(coalesce(name, '')), '[^a-z0-9]+', '', 'g')
$$;

alter table venues add column if not exists name_key text;
update venues set name_key = public.venue_key(name) where name_key is null;

-- ---- 1. Collapse existing duplicates --------------------------------
-- One DO block so the working table survives across the statements even
-- when the SQL editor runs through a connection pooler (no session-level
-- temp tables to lose). Canonical row per key: prefer the seeded venues,
-- then the shortest id.
do $$
begin
  drop table if exists _venue_map;
  create temporary table _venue_map on commit drop as
  with canon as (
    select distinct on (name_key) name_key, id as keep_id
    from venues
    order by name_key,
             (id = any (array['cancun-cantina','neon-boots','starlight',
                              'boot-scoot','copper'])) desc,
             length(id), id
  )
  select v.id, c.keep_id
  from venues v
  join canon c using (name_key)
  where v.id <> c.keep_id;

  -- user_venues (PK user_id, venue_id): drop would-be collisions, remap rest.
  delete from user_venues uv using _venue_map m
  where uv.venue_id = m.id
    and exists (select 1 from user_venues k
                where k.user_id = uv.user_id and k.venue_id = m.keep_id);
  update user_venues uv set venue_id = m.keep_id
  from _venue_map m where uv.venue_id = m.id;

  -- user_venue_dances (PK user_id, venue_id, dance_id): same.
  delete from user_venue_dances d using _venue_map m
  where d.venue_id = m.id
    and exists (select 1 from user_venue_dances k
                where k.user_id = d.user_id and k.venue_id = m.keep_id
                  and k.dance_id = d.dance_id);
  update user_venue_dances d set venue_id = m.keep_id
  from _venue_map m where d.venue_id = m.id;

  -- shared_list_dances.venue_id is a nullable FK — just repoint.
  update shared_list_dances s set venue_id = m.keep_id
  from _venue_map m where s.venue_id = m.id;

  delete from venues v using _venue_map m where v.id = m.id;
end $$;

-- ---- 2. Enforce normalized uniqueness ------------------------------
alter table venues alter column name_key set not null;
alter table venues drop constraint if exists venues_name_key;   -- old exact-name unique
create unique index if not exists venues_name_key_uniq on venues (name_key);

-- ---- 3. Community validation -------------------------------------
create table if not exists venue_votes (
  user_id uuid references profiles(id) on delete cascade,
  venue_id text references venues(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, venue_id)
);
alter table venue_votes enable row level security;
drop policy if exists "read venue votes" on venue_votes;
drop policy if exists "write own venue votes" on venue_votes;
create policy "read venue votes" on venue_votes
  for select to authenticated using (true);
create policy "write own venue votes" on venue_votes
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Every venue already on someone's list is, implicitly, endorsed by them.
insert into venue_votes (user_id, venue_id)
select user_id, venue_id from user_venues
on conflict do nothing;
