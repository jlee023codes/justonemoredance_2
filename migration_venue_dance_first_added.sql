-- Just One More Dance: fix "What Was New" flagging dances the venue
-- already knew about.
--
-- Two bugs in how a session decided "new to the venue"
-- (loadDancesAlreadyAtVenue, src/services/venues.ts):
--
--  1. It checked user_venue_dances.added_at < session start — but
--     saveVenueDance's upsert bumps added_at to now() on every re-log.
--     Logging a known dance during the session moved its only earlier
--     row to tonight, so at "Done Dancing" it looked brand new.
--  2. RLS on user_venue_dances only lets a user read their OWN rows, so
--     "did anyone tag this here before" was really "did I" — dances
--     other people had put on the venue's playlist also looked new.
--
-- Fix: a first_added_at column that the app's upsert never touches
-- (it only sends the columns it sets, so ON CONFLICT leaves this one
-- alone), plus a security definer function that answers the question
-- across everyone — returning only dance ids, same exposure as the
-- public venue_dance_reports view. added_at keeps its "last logged"
-- meaning, which the activity feed (src/services/activity.ts) relies on.
--
-- Run ONCE, in the Supabase SQL editor.

-- 1. The column. Backfilled from the earliest evidence we still have:
--    the row's own added_at, any live-session log of that dance at
--    that venue by that user, and any saved session's logged_dances.
--    (A tag made outside a session and later re-logged can't be fully
--    recovered — added_at was the only record and it was overwritten.)
alter table user_venue_dances add column if not exists first_added_at timestamptz;

update user_venue_dances d
set first_added_at = least(
  d.added_at,
  (
    select min(l.logged_at)
    from venue_live_dances l
    where l.venue_id = d.venue_id
      and l.dance_id = d.dance_id
      and l.logged_by = d.user_id
  ),
  (
    select min((e->>'loggedAt')::timestamptz)
    from venue_checkins c
    cross join lateral jsonb_array_elements(c.logged_dances) e
    where c.user_id = d.user_id
      and c.venue_id = d.venue_id
      and e->>'danceId' = d.dance_id
      and e->>'loggedAt' ~ '^\d{4}-\d{2}-\d{2}T'
  )
)
where d.first_added_at is null;

alter table user_venue_dances alter column first_added_at set default now();
alter table user_venue_dances alter column first_added_at set not null;

-- 2. "Which of these dances were on this venue's playlist before
--    p_before?" — across all users.
create or replace function venue_dances_known_before(
  p_venue_id text,
  p_dance_ids text[],
  p_before timestamptz
)
returns setof text
language sql
stable
security definer
set search_path = public
as $$
  select distinct dance_id
  from user_venue_dances
  where venue_id = p_venue_id
    and dance_id = any(p_dance_ids)
    and first_added_at < p_before;
$$;

revoke execute on function venue_dances_known_before(text, text[], timestamptz) from public;
grant execute on function venue_dances_known_before(text, text[], timestamptz) to authenticated;

-- 3. Repair already-saved sessions. newToVenue is snapshotted into
--    venue_checkins.logged_dances at "Done Dancing", so past sessions
--    keep their wrong flags unless recomputed. Only touches entries
--    that already carry a newToVenue flag; everything else in each
--    entry is left as-is.
update venue_checkins c
set logged_dances = (
  select jsonb_agg(
    case
      when e ? 'newToVenue' then jsonb_set(
        e,
        '{newToVenue}',
        to_jsonb(not exists (
          select 1
          from user_venue_dances d
          where d.venue_id = c.venue_id
            and d.dance_id = e->>'danceId'
            and d.first_added_at < c.checked_in_at
        ))
      )
      else e
    end
    order by ord
  )
  from jsonb_array_elements(c.logged_dances) with ordinality as t(e, ord)
)
where c.ended_at is not null
  and jsonb_array_length(c.logged_dances) > 0
  and exists (
    select 1 from jsonb_array_elements(c.logged_dances) e where e ? 'newToVenue'
  );

notify pgrst, 'reload schema';
