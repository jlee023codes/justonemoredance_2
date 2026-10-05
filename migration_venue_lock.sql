-- A newly-added venue starts "locked" — visible only to the person
-- who added it — until at least VENUE_PUBLIC_THRESHOLD (5) distinct
-- users have actually checked in there (venue_checkins, not just
-- added it to a list — a stronger "this is a real venue people
-- actually dance at" signal than a vote/add). Once that threshold is
-- crossed it unlocks permanently for everyone, same spirit as the
-- existing "Verified" badge (VERIFIED_THRESHOLD=3 check-ins) but
-- gating actual visibility, not just a badge.
--
-- Today's only SELECT policy on venues is `using (true)` — every row
-- has been globally visible to every authenticated user since the
-- table existed (confirmed: no existing per-row ACL anywhere). This
-- migration is what introduces real row-level gating for the first
-- time, so it replaces that blanket policy rather than adding beside
-- it (unlike this app's usual "additive second policy" convention —
-- here the whole point IS to narrow default visibility).

-- venue_checkin_counts (migration_venue_checkins.sql) already counts
-- distinct user_id per venue_id — exactly the signal needed, reused
-- as-is rather than adding a parallel counting mechanism.

drop policy if exists "read venues" on venues;
create policy "read venues" on venues for select
  using (
    created_by = auth.uid()
    or exists (
      select 1 from venue_checkin_counts c
      where c.venue_id = venues.id and c.checkin_count >= 5
    )
  );

-- Dedup lookups (findOrCreateGlobalVenue / findOrCreateGlobalVenueFromPlace
-- in src/services/venues.ts) need to see whether a venue already
-- exists by name_key or google_place_id REGARDLESS of lock state, or
-- a second person adding the same not-yet-unlocked venue would create
-- a duplicate row instead of attaching to (and helping unlock) the
-- real one. This SECURITY DEFINER function bypasses RLS for exactly
-- that one check, returning ONLY the id — never any of the locked
-- venue's other details (name, address, nights, etc.) to someone who
-- can't otherwise see it. The caller re-fetches full details through
-- the normal RLS-gated select afterward, which still correctly shows
-- nothing extra if the venue is locked and they're not its creator.
create or replace function find_venue_id(p_name_key text, p_google_place_id text default null)
returns text
language sql
security definer
stable
set search_path = public
as $$
  select id from venues
  where name_key = p_name_key
     or (p_google_place_id is not null and google_place_id = p_google_place_id)
  limit 1;
$$;

grant execute on function find_venue_id(text, text) to authenticated;

notify pgrst, 'reload schema';
