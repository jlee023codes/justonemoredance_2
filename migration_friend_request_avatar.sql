-- Just One More Dance: friend-request RPCs need to return avatar_url too
-- now that profile pictures exist (migration_profile_avatar.sql) — the
-- pending-requests list and the "you're friends now" result both render
-- an Avatar, not just a name. Postgres can't change a function's RETURNS
-- TABLE shape via CREATE OR REPLACE, so these are dropped and recreated
-- (same pattern migration_friend_requests.sql itself already used).
--
-- Run ONCE. Idempotent.

drop function if exists public.respond_to_friend_request(uuid, boolean);
create or replace function public.respond_to_friend_request(
  p_request_id uuid,
  p_accept boolean
)
returns table (
  id uuid,
  username text,
  display_name text,
  avatar_url text
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
  return query select v_them.id, v_them.username, v_them.display_name, v_them.avatar_url;
end;
$$;

drop function if exists public.get_friend_requests();
create or replace function public.get_friend_requests()
returns table (
  request_id uuid,
  direction text,
  other_id uuid,
  username text,
  display_name text,
  avatar_url text,
  created_at timestamptz
)
language sql security definer set search_path = public as $$
  select r.id,
         case when r.recipient_id = auth.uid() then 'incoming' else 'outgoing' end,
         p.id, p.username, p.display_name, p.avatar_url, r.created_at
    from friend_requests r
    join profiles p
      on p.id = case when r.recipient_id = auth.uid()
                     then r.requester_id else r.recipient_id end
   where r.status = 'pending'
     and (r.recipient_id = auth.uid() or r.requester_id = auth.uid())
   order by r.created_at desc;
$$;
