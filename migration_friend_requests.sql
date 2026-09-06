-- Just One More Dance: friend *requests* + auth helpers.
--
-- Run this in the Supabase SQL editor after schema.sql. It is idempotent,
-- so it's safe to re-run, and it re-creates the username/friendship pieces
-- defensively in case they were only ever applied by hand.
--
-- What changes: adding a friend used to create the friendship immediately
-- and in both directions. Now `send_friend_request` creates a *pending*
-- row; the recipient sees it in Profile → Friend requests and has to
-- accept before either side can see the other's list.

-- ---------------------------------------------------------------------
-- Profiles: username + display name (no-ops if already present)
-- ---------------------------------------------------------------------
alter table profiles add column if not exists username text;
alter table profiles add column if not exists display_name text;
create unique index if not exists profiles_username_key on profiles (lower(username));

-- ---------------------------------------------------------------------
-- Progress rows: 'maybe' is a real status (Save for Later / imported from
-- a friend), and `source` holds the friend's *username*, not the literal
-- 'friend'. schema.sql's original CHECKs predate both.
-- ---------------------------------------------------------------------
alter table user_dance_progress drop constraint if exists user_dance_progress_status_check;
alter table user_dance_progress add constraint user_dance_progress_status_check
  check (status in ('maybe','want','learned'));
alter table user_dance_progress drop constraint if exists user_dance_progress_source_check;

-- ---------------------------------------------------------------------
-- Friendships: one row per direction, so "who are my friends" is a
-- single-column lookup. Both rows are written together on accept.
-- ---------------------------------------------------------------------
create table if not exists friendships (
  user_id uuid not null references profiles(id) on delete cascade,
  friend_id uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, friend_id)
);

-- ---------------------------------------------------------------------
-- Friend requests. 'pending' rows are the live ones; accepted/declined
-- are kept as history so a declined request can't be spammed back
-- instantly and an accepted one leaves a trail.
-- ---------------------------------------------------------------------
create table if not exists friend_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references profiles(id) on delete cascade,
  recipient_id uuid not null references profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted','declined')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  constraint friend_request_not_self check (requester_id <> recipient_id)
);

-- Only one *live* request per direction. Resolved rows are exempt, so the
-- pair can try again after a decline.
create unique index if not exists friend_requests_one_pending
  on friend_requests (requester_id, recipient_id)
  where status = 'pending';

create index if not exists friend_requests_recipient_idx
  on friend_requests (recipient_id) where status = 'pending';

alter table friendships enable row level security;
alter table friend_requests enable row level security;

-- Reads go straight to the table; every *write* goes through a
-- SECURITY DEFINER function below, because accepting a request has to
-- write a friendship row owned by the other person.
drop policy if exists "read own friendships" on friendships;
create policy "read own friendships" on friendships
  for select using (auth.uid() = user_id);

drop policy if exists "read own friend requests" on friend_requests;
create policy "read own friend requests" on friend_requests
  for select using (auth.uid() = requester_id or auth.uid() = recipient_id);

-- A friend's progress rows have to be readable for their list to render.
drop policy if exists "read friends progress" on user_dance_progress;
create policy "read friends progress" on user_dance_progress
  for select using (
    auth.uid() = user_id
    or exists (
      select 1 from friendships f
      where f.user_id = auth.uid() and f.friend_id = user_dance_progress.user_id
    )
  );

-- Profiles of people you're connected to (friends, or either side of a
-- pending request) so their name can be shown next to the request.
drop policy if exists "read connected profiles" on profiles;
create policy "read connected profiles" on profiles
  for select using (
    auth.uid() = id
    or exists (
      select 1 from friendships f
      where f.user_id = auth.uid() and f.friend_id = profiles.id
    )
    or exists (
      select 1 from friend_requests r
      where r.status = 'pending'
        and ((r.requester_id = auth.uid() and r.recipient_id = profiles.id)
          or (r.recipient_id = auth.uid() and r.requester_id = profiles.id))
    )
  );

-- `create or replace` refuses to change a function's return type, and
-- some of these may already exist from an earlier hand-applied version.
-- Dropping first makes the whole file safe to re-run.
drop function if exists public.send_friend_request(text);
drop function if exists public.respond_to_friend_request(uuid, boolean);
drop function if exists public.cancel_friend_request(uuid);
drop function if exists public.get_friend_requests();
drop function if exists public.remove_friend(uuid);
drop function if exists public.email_exists(text);

-- ---------------------------------------------------------------------
-- send_friend_request: look someone up by username and open a request.
--
-- If they already have a pending request out to *you*, this accepts that
-- one instead of opening a second one in the opposite direction — two
-- people adding each other shouldn't leave both stuck waiting.
-- ---------------------------------------------------------------------
create or replace function public.send_friend_request(p_username text)
returns table (
  request_id uuid,
  id uuid,
  username text,
  display_name text,
  status text
)
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_them profiles%rowtype;
  v_inbound friend_requests%rowtype;
  v_request friend_requests%rowtype;
begin
  if v_me is null then
    raise exception 'You need to be signed in.';
  end if;

  select * into v_them from profiles p
    where lower(p.username) = lower(btrim(p_username));
  if not found then
    raise exception 'No dancer with the username "%".', btrim(p_username);
  end if;
  if v_them.id = v_me then
    raise exception 'That is your own username.';
  end if;

  if exists (select 1 from friendships f
             where f.user_id = v_me and f.friend_id = v_them.id) then
    raise exception 'You are already friends with @%.', v_them.username;
  end if;

  -- They asked first — accept theirs rather than opening a mirror request.
  select * into v_inbound from friend_requests r
    where r.requester_id = v_them.id and r.recipient_id = v_me
      and r.status = 'pending';
  if found then
    update friend_requests
      set status = 'accepted', responded_at = now()
      where friend_requests.id = v_inbound.id;
    insert into friendships (user_id, friend_id)
      values (v_me, v_them.id), (v_them.id, v_me)
      on conflict do nothing;
    return query select v_inbound.id, v_them.id, v_them.username,
                        v_them.display_name, 'accepted'::text;
    return;
  end if;

  if exists (select 1 from friend_requests r
             where r.requester_id = v_me and r.recipient_id = v_them.id
               and r.status = 'pending') then
    raise exception 'You already have a pending request to @%.', v_them.username;
  end if;

  insert into friend_requests (requester_id, recipient_id)
    values (v_me, v_them.id)
    returning * into v_request;

  return query select v_request.id, v_them.id, v_them.username,
                      v_them.display_name, 'pending'::text;
end;
$$;

-- ---------------------------------------------------------------------
-- respond_to_friend_request: accept or decline, as the recipient.
-- ---------------------------------------------------------------------
create or replace function public.respond_to_friend_request(
  p_request_id uuid,
  p_accept boolean
)
returns table (
  id uuid,
  username text,
  display_name text
)
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_request friend_requests%rowtype;
  v_them profiles%rowtype;
begin
  if v_me is null then
    raise exception 'You need to be signed in.';
  end if;

  select * into v_request from friend_requests r
    where r.id = p_request_id and r.recipient_id = v_me and r.status = 'pending';
  if not found then
    raise exception 'That request is no longer waiting for an answer.';
  end if;

  update friend_requests
    set status = case when p_accept then 'accepted' else 'declined' end,
        responded_at = now()
    where friend_requests.id = v_request.id;

  if p_accept then
    insert into friendships (user_id, friend_id)
      values (v_me, v_request.requester_id), (v_request.requester_id, v_me)
      on conflict do nothing;
  end if;

  select * into v_them from profiles p where p.id = v_request.requester_id;
  return query select v_them.id, v_them.username, v_them.display_name;
end;
$$;

-- ---------------------------------------------------------------------
-- cancel_friend_request: withdraw one you sent.
-- ---------------------------------------------------------------------
create or replace function public.cancel_friend_request(p_request_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from friend_requests r
    where r.id = p_request_id and r.requester_id = auth.uid()
      and r.status = 'pending';
end;
$$;

-- ---------------------------------------------------------------------
-- get_friend_requests: both directions in one round trip, already joined
-- to the other person's profile.
-- ---------------------------------------------------------------------
create or replace function public.get_friend_requests()
returns table (
  request_id uuid,
  direction text,
  other_id uuid,
  username text,
  display_name text,
  created_at timestamptz
)
language sql security definer set search_path = public as $$
  select r.id,
         case when r.recipient_id = auth.uid() then 'incoming' else 'outgoing' end,
         p.id, p.username, p.display_name, r.created_at
    from friend_requests r
    join profiles p
      on p.id = case when r.recipient_id = auth.uid()
                     then r.requester_id else r.recipient_id end
   where r.status = 'pending'
     and (r.recipient_id = auth.uid() or r.requester_id = auth.uid())
   order by r.created_at desc;
$$;

-- ---------------------------------------------------------------------
-- remove_friend: drop both directions of the friendship.
-- ---------------------------------------------------------------------
create or replace function public.remove_friend(p_friend_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from friendships f
    where (f.user_id = auth.uid() and f.friend_id = p_friend_id)
       or (f.user_id = p_friend_id and f.friend_id = auth.uid());
  -- Let a future request through: without this the accepted history row
  -- doesn't block anything, but a stale pending one would.
  delete from friend_requests r
    where r.status = 'pending'
      and ((r.requester_id = auth.uid() and r.recipient_id = p_friend_id)
        or (r.requester_id = p_friend_id and r.recipient_id = auth.uid()));
end;
$$;

-- The old immediate-friendship RPC is replaced by send_friend_request.
drop function if exists public.add_friend(text);

-- ---------------------------------------------------------------------
-- email_exists: lets the sign-in screen tell "no account yet" (offer to
-- create one, with a confirm-password field) apart from "wrong password".
-- Supabase deliberately returns the same "Invalid login credentials" for
-- both, so the app can't distinguish them without asking.
--
-- NOTE: this does expose whether an email is registered. That's the
-- inherent cost of the "sign in or sign up from one form" flow — if you'd
-- rather not leak it, drop this function and have AuthScreen always show
-- the confirm-password field on a failed sign-in instead.
-- ---------------------------------------------------------------------
create or replace function public.email_exists(p_email text)
returns boolean
language plpgsql security definer set search_path = public, auth as $$
begin
  return exists (
    select 1 from auth.users u where lower(u.email) = lower(btrim(p_email))
  );
end;
$$;

grant execute on function public.send_friend_request(text) to authenticated;
grant execute on function public.respond_to_friend_request(uuid, boolean) to authenticated;
grant execute on function public.cancel_friend_request(uuid) to authenticated;
grant execute on function public.get_friend_requests() to authenticated;
grant execute on function public.remove_friend(uuid) to authenticated;
grant execute on function public.email_exists(text) to anon, authenticated;
