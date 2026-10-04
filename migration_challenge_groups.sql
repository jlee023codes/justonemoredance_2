-- Group challenges: a challenge can now carry an optional group_name.
-- group_name is not null IS the group/individual discriminant — no
-- separate boolean, so there's no invalid is_group=true/group_name=null
-- state to guard against. "Individual" challenges with multiple
-- friends fan out into N separate 1:1 rows client-side (each with
-- group_name left null); this migration doesn't need to know about
-- that fan-out at all, it only needs to let a single create_challenge
-- call optionally name its row.

alter table challenges add column if not exists group_name text;

alter table challenges drop constraint if exists group_name_not_blank;
alter table challenges add constraint group_name_not_blank
  check (group_name is null or length(trim(group_name)) > 0);

-- Same body as migration_challenges.sql's create_challenge, plus the
-- new optional p_group_name param threaded into the challenges insert.
create or replace function create_challenge(
  p_friend_ids uuid[],
  p_starts_on date,
  p_ends_on date,
  p_group_name text default null
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

  insert into challenges (creator_id, starts_on, ends_on, group_name)
  values (v_me, p_starts_on, p_ends_on, nullif(trim(p_group_name), ''))
  returning id into v_challenge_id;

  insert into challenge_participants (challenge_id, user_id, status, responded_at)
  values (v_challenge_id, v_me, 'accepted', now());

  foreach v_friend_id in array p_friend_ids loop
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

grant execute on function create_challenge(uuid[], date, date, text) to authenticated;

notify pgrst, 'reload schema';
