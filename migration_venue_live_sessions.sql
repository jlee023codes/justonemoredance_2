-- Collaborative live sessions: anyone currently checked in at a venue
-- (ended_at is null) shares one live dance pool for that venue —
-- automatic on check-in, no separate "join" step. Logging a dance
-- writes it where every co-present user can see it immediately
-- (via Realtime); tapping "danced" on someone else's log is a
-- separate many-to-many mark. Existing per-user venue_checkins and
-- its logged_dances jsonb column are untouched — this is additive,
-- not a replacement, so Stats history keeps working exactly as today.

create table if not exists venue_live_dances (
  id uuid primary key default gen_random_uuid(),
  venue_id text not null references venues(id) on delete cascade,
  checkin_id uuid not null references venue_checkins(id) on delete cascade,
  logged_by uuid not null references profiles(id) on delete cascade,
  dance_id text not null,
  dance_name text not null,
  dance_song text,
  dance_difficulty text,
  dance_details text,
  logged_at timestamptz not null default now()
);
create index if not exists venue_live_dances_venue_idx on venue_live_dances (venue_id, logged_at desc);
create index if not exists venue_live_dances_checkin_idx on venue_live_dances (checkin_id);

-- venue_id is denormalized here (not just reachable via a join to
-- venue_live_dances) purely so the Realtime channel can filter marks
-- by venue directly, without subscribing to every mark in the app.
create table if not exists venue_live_dance_marks (
  live_dance_id uuid not null references venue_live_dances(id) on delete cascade,
  venue_id text not null references venues(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  marked_at timestamptz not null default now(),
  primary key (live_dance_id, user_id)
);
create index if not exists venue_live_dance_marks_user_idx on venue_live_dance_marks (user_id);

-- Membership tests, SECURITY DEFINER same as is_challenge_participant
-- (migration_challenges.sql) — scoped to "currently active, same
-- venue" instead of the friend graph. Neither function queries back
-- into a table whose own policy calls it, so there's no cross-table
-- recursion risk here (unlike challenges <-> challenge_participants).
create or replace function is_live_at_venue(p_venue_id text, p_user_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from venue_checkins c
    where c.venue_id = p_venue_id and c.user_id = p_user_id and c.ended_at is null
  );
$$;

create or replace function shares_live_venue(p_other_user_id uuid, p_user_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from venue_checkins mine
    join venue_checkins theirs
      on theirs.venue_id = mine.venue_id and theirs.ended_at is null
    where mine.user_id = p_user_id and mine.ended_at is null
      and theirs.user_id = p_other_user_id
  );
$$;

grant execute on function is_live_at_venue(text, uuid) to authenticated;
grant execute on function shares_live_venue(uuid, uuid) to authenticated;

-- Additive SELECT policy on venue_checkins — the existing "manage own
-- checkins" (for all, owner-only) policy is untouched; Postgres ORs
-- multiple SELECT policies together, so this only adds visibility
-- for a co-present user, never narrows the owner's own access.
drop policy if exists "read live presence at my venue" on venue_checkins;
create policy "read live presence at my venue" on venue_checkins for select
  using (
    user_id = auth.uid()
    or (ended_at is null and shares_live_venue(user_id, auth.uid()))
  );

-- Safe-columns view for discovering who else is live at a venue —
-- never exposes raw latitude/longitude. security_invoker means it
-- runs under the CALLER's RLS (the policy above), not the view
-- owner's privileges, so it can't be used to bypass that policy.
create or replace view venue_live_presence as
select id as checkin_id, venue_id, user_id, checked_in_at
from venue_checkins
where ended_at is null;
alter view venue_live_presence set (security_invoker = true);
grant select on venue_live_presence to authenticated;

-- Additive profiles policy (kept separate from the existing
-- friend-graph read policy in migration_friend_requests.sql, rather
-- than replacing it, to avoid any risk to that already-working path)
-- so a co-present stranger's display name/avatar can be resolved.
drop policy if exists "read live venue profiles" on profiles;
create policy "read live venue profiles" on profiles for select
  using (shares_live_venue(profiles.id, auth.uid()));

alter table venue_live_dances enable row level security;
alter table venue_live_dance_marks enable row level security;

drop policy if exists "read live dances at my venue" on venue_live_dances;
create policy "read live dances at my venue" on venue_live_dances for select
  using (is_live_at_venue(venue_id, auth.uid()));

drop policy if exists "log live dance at my venue" on venue_live_dances;
create policy "log live dance at my venue" on venue_live_dances for insert
  with check (logged_by = auth.uid() and is_live_at_venue(venue_id, auth.uid()));

grant select, insert on venue_live_dances to authenticated;

drop policy if exists "read marks at my venue" on venue_live_dance_marks;
create policy "read marks at my venue" on venue_live_dance_marks for select
  using (is_live_at_venue(venue_id, auth.uid()));

drop policy if exists "mark own danced" on venue_live_dance_marks;
create policy "mark own danced" on venue_live_dance_marks for insert
  with check (user_id = auth.uid() and is_live_at_venue(venue_id, auth.uid()));

drop policy if exists "unmark own danced" on venue_live_dance_marks;
create policy "unmark own danced" on venue_live_dance_marks for delete
  using (user_id = auth.uid());

grant select, insert, delete on venue_live_dance_marks to authenticated;

-- First use of Supabase Realtime in this app — under the 200-
-- connection free tier today. Any INSERT on venue_live_dances or
-- change on venue_live_dance_marks pushes to every co-present
-- subscriber within ~1s, instead of waiting on a poll interval.
alter publication supabase_realtime add table venue_live_dances;
alter publication supabase_realtime add table venue_live_dance_marks;

notify pgrst, 'reload schema';
