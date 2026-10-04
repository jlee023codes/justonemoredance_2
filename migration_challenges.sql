-- Friend challenges: pick one or more friends + a date range, compete
-- on total dances logged and total steps over that window (two
-- separate leaderboards, no combined score). Floor-Boss-exclusive —
-- gated client-side same as the rest of FriendsScreen.
--
-- Shape is modeled on events/event_rsvps (migration_friends_page.sql)
-- but 1:1-recipient with an explicit accept/decline per invitee,
-- mirroring friend_requests' pending-row shape instead of events'
-- implicit-visibility-to-all-friends shape — a challenge needs a real
-- answer from each person invited, not just "everyone sees it."

create table if not exists challenges (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references profiles(id) on delete cascade,
  starts_on date not null,
  ends_on date not null check (ends_on >= starts_on),
  created_at timestamptz not null default now()
);
create index if not exists challenges_creator_idx on challenges (creator_id);

create table if not exists challenge_participants (
  challenge_id uuid not null references challenges(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted','declined')),
  responded_at timestamptz,
  primary key (challenge_id, user_id)
);
create index if not exists challenge_participants_user_idx on challenge_participants (user_id);

alter table challenges enable row level security;
alter table challenge_participants enable row level security;

-- Both policies below need to check membership in the OTHER table
-- (challenges' policy checks challenge_participants; that table's own
-- policy checks challenges right back) — a plain subquery either
-- direction makes Postgres re-evaluate the other table's RLS policy,
-- which re-evaluates this one, infinitely. Both checks go through
-- SECURITY DEFINER helper functions instead: each one runs with the
-- function owner's privileges, bypassing RLS internally, so neither
-- policy's subquery ever triggers the other's RLS evaluation.
create or replace function is_challenge_creator(p_challenge_id uuid, p_user_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from challenges c
    where c.id = p_challenge_id and c.creator_id = p_user_id
  );
$$;

create or replace function is_challenge_participant(p_challenge_id uuid, p_user_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from challenge_participants cp
    where cp.challenge_id = p_challenge_id and cp.user_id = p_user_id
  );
$$;

create or replace function is_accepted_challenge_participant(p_challenge_id uuid, p_user_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from challenge_participants cp
    where cp.challenge_id = p_challenge_id
      and cp.user_id = p_user_id
      and cp.status = 'accepted'
  );
$$;

grant execute on function is_challenge_creator(uuid, uuid) to authenticated;
grant execute on function is_challenge_participant(uuid, uuid) to authenticated;
grant execute on function is_accepted_challenge_participant(uuid, uuid) to authenticated;

-- Visible to the creator and anyone invited to it.
drop policy if exists "read my challenges" on challenges;
create policy "read my challenges" on challenges for select using (
  auth.uid() = creator_id
  or is_challenge_participant(id, auth.uid())
);

drop policy if exists "create own challenges" on challenges;
create policy "create own challenges" on challenges for insert
  with check (auth.uid() = creator_id);

-- A participant row is visible to the person it belongs to, the
-- challenge's creator, and any OTHER accepted participant in the same
-- challenge (so the leaderboard can show everyone's status/scores) —
-- but only once that other participant has themselves accepted
-- (declined/pending rows of other people aren't anyone else's business).
drop policy if exists "read challenge participants" on challenge_participants;
create policy "read challenge participants" on challenge_participants for select using (
  auth.uid() = user_id
  or is_challenge_creator(challenge_id, auth.uid())
  or (
    status = 'accepted'
    and is_accepted_challenge_participant(challenge_id, auth.uid())
  )
);

drop policy if exists "respond to own invite" on challenge_participants;
create policy "respond to own invite" on challenge_participants for update
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

grant select, insert on challenges to authenticated;
grant select, insert, update on challenge_participants to authenticated;

-- Invite flow needs SECURITY DEFINER because it writes
-- challenge_participants rows owned by the invited friends — same
-- reasoning as send_friend_request: a normal RLS policy can't let one
-- person write a row that belongs to someone else. Does the challenge
-- insert + creator's own 'accepted' row + each friend's 'pending' row,
-- all in one call, returning the new challenge id.
create or replace function create_challenge(
  p_friend_ids uuid[],
  p_starts_on date,
  p_ends_on date
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_challenge_id uuid;
  v_friend_id uuid;
begin
  if v_me is null then
    raise exception 'Not authenticated';
  end if;
  if p_friend_ids is null or array_length(p_friend_ids, 1) is null then
    raise exception 'Pick at least one friend to challenge.';
  end if;
  if p_ends_on < p_starts_on then
    raise exception 'End date must be on or after the start date.';
  end if;

  insert into challenges (creator_id, starts_on, ends_on)
  values (v_me, p_starts_on, p_ends_on)
  returning id into v_challenge_id;

  insert into challenge_participants (challenge_id, user_id, status, responded_at)
  values (v_challenge_id, v_me, 'accepted', now());

  foreach v_friend_id in array p_friend_ids loop
    -- Only actually friends — a normal RLS check couldn't verify this
    -- (it needs to read someone else's row to confirm), so the
    -- SECURITY DEFINER function enforces it explicitly instead.
    if exists (
      select 1 from friendships f
      where f.user_id = v_me and f.friend_id = v_friend_id
    ) and v_friend_id <> v_me then
      insert into challenge_participants (challenge_id, user_id, status)
      values (v_challenge_id, v_friend_id, 'pending')
      on conflict do nothing;
    end if;
  end loop;

  return v_challenge_id;
end;
$$;

grant execute on function create_challenge(uuid[], date, date) to authenticated;

-- Leaderboard numbers. A bare view over venue_checkins (like
-- venue_dance_reports/venue_checkin_counts) would bypass that table's
-- RLS for EVERY caller, not just challenge participants — since a view
-- owner's privileges apply regardless of who's querying it, anyone
-- could pass arbitrary user ids and read their aggregated stats,
-- challenge or no challenge. A SECURITY DEFINER function instead,
-- which checks the caller is actually an accepted participant of
-- *this* challenge before aggregating anyone's rows — the aggregation
-- itself still only ever returns "N dances, N steps" per person, never
-- raw venue/location/time detail.
create or replace function get_challenge_scores(p_challenge_id uuid)
returns table (user_id uuid, dance_count bigint, step_count bigint)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from challenge_participants cp
    where cp.challenge_id = p_challenge_id
      and cp.user_id = auth.uid()
      and cp.status = 'accepted'
  ) then
    raise exception 'Not a participant in this challenge.';
  end if;

  return query
    select
      vc.user_id,
      coalesce(sum(jsonb_array_length(vc.logged_dances)), 0)::bigint as dance_count,
      coalesce(sum(vc.step_count), 0)::bigint as step_count
    from venue_checkins vc
    join challenge_participants cp
      on cp.user_id = vc.user_id and cp.challenge_id = p_challenge_id and cp.status = 'accepted'
    join challenges c on c.id = p_challenge_id
    where vc.ended_at is not null
      and vc.checked_in_at::date between c.starts_on and c.ends_on
    group by vc.user_id;
end;
$$;

grant execute on function get_challenge_scores(uuid) to authenticated;

notify pgrst, 'reload schema';
