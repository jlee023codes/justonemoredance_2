-- Fixes a real bug: the live session's dance list was scoped to "the
-- earliest check-in among people CURRENTLY still active at the
-- venue" — which shrinks the moment anyone leaves, since their row
-- drops out of that calculation. User1 ends their session -> the
-- window start jumps forward to whoever's left -> everything user1
-- logged before that point silently disappears for user2.
--
-- The dance list belongs to the venue's ongoing collaborative
-- session, not to any one user's check-in timing. A venue's live
-- session only "ends" (for the purpose of starting a fresh list)
-- once there's been a gap of more than an hour since the last dance
-- was logged there — not when any particular person leaves. Anyone
-- checking in at any time sees the whole current streak back to
-- wherever that gap last occurred, even if everyone who logged those
-- earlier dances has since left (user4 arriving 10 minutes after
-- users 1-3 all dropped still sees everything they logged).
--
-- This needs a gap-detection query (compare each row's logged_at to
-- the previous row's via a window function) that Supabase's JS query
-- builder can't express — a small SQL function is the natural fit.
-- No elevated privileges needed: NOT security definer, so it runs
-- under the caller's own RLS, same as any other query against
-- venue_live_dances (the existing "read live dances at my venue"
-- policy already requires the caller to be currently checked in at
-- that venue — this function can't be used to read a venue's dance
-- history from outside that gate).

create or replace function venue_live_session_window_start(p_venue_id text)
returns timestamptz
language sql
stable
set search_path = public
as $$
  select logged_at
  from (
    select
      logged_at,
      logged_at - lag(logged_at) over (order by logged_at) as gap
    from venue_live_dances
    where venue_id = p_venue_id
  ) gaps
  where gap is null or gap > interval '1 hour'
  order by logged_at desc
  limit 1;
$$;

grant execute on function venue_live_session_window_start(text) to authenticated;

notify pgrst, 'reload schema';
