-- One-time venue dedup cleanup (run by hand in the Supabase SQL editor,
-- as the table owner — this bypasses RLS/column grants, which is why
-- `name` can be overwritten here even though the app itself never lets
-- users rename an existing venue).
--
-- Use case: a venue was originally added as free text (e.g. "Neon
-- Boots") before Google Places existed, and someone has since added
-- the same real place again via Places autocomplete (e.g. "Neon Boots
-- Dance Hall") — findOrCreateGlobalVenueFromPlace only dedupes on an
-- EXACT name_key or google_place_id match, so these ended up as two
-- separate, already-existing rows. This merges one into the other,
-- keeping votes/added lists/dance tags, and enriches the surviving row
-- with Google's data.
--
-- Run step 1 to find the ids you need, then fill in the variables at
-- the top of step 2 and run the whole block — once per duplicate pair.

-- ============================================================
-- STEP 0 (optional) — surface likely duplicate pairs automatically,
-- so you don't have to eyeball the full list in step 1. Catches cases
-- like "neonboots" vs "neonbootsdancehall" (one name_key contains the
-- other). Still confirm each pair is really the same place before
-- merging — a substring match isn't proof, just a shortlist.
-- ============================================================
select
  a.id as id_a, a.name as name_a, a.google_place_id as place_id_a,
  b.id as id_b, b.name as name_b, b.google_place_id as place_id_b
from venues a
join venues b
  on a.id < b.id
  and (a.name_key like '%' || b.name_key || '%' or b.name_key like '%' || a.name_key || '%')
order by a.name;

-- ============================================================
-- STEP 1 — list current venues to find duplicate pairs and ids
-- ============================================================
select
  id,
  name,
  name_key,
  address,
  address_verified,
  latitude,
  longitude,
  google_place_id,
  (select count(*) from venue_votes v where v.venue_id = venues.id) as votes,
  (select count(*) from user_venues u where u.venue_id = venues.id) as added_by
from venues
order by name;

-- ============================================================
-- STEP 2 — merge old_id into keep_id, then enrich keep_id with the
-- Google Places result for the real venue. Only edit the declare
-- block below — the logic underneath never changes.
--
--   old_id  = the duplicate's id (gets deleted)
--   keep_id = the id you're keeping (usually whichever already has
--             votes/added_by, so nothing about it needs to move)
--   v_name / v_address / v_lat / v_lng / v_place_id = the Google
--             Places result for the real venue
--
-- Example (Neon Boots): the free-text "Neon Boots" (id "neon-boots")
-- has the 2 endorsements, so it's kept; the new Google-matched "Neon
-- Boots Dance Hall" (id "neon-boots-dance-hall", no history yet) is
-- folded away:
--   old_id  := 'neon-boots-dance-hall'
--   keep_id := 'neon-boots'
--   v_name  := 'Neon Boots Dance Hall'
--   ... etc
-- ============================================================

do $$
declare
  old_id     text             := '<old_id>';
  keep_id    text             := '<keep_id>';
  v_name     text             := '<google display name>';
  v_address  text             := '<google formatted address>';
  v_lat      double precision := <google latitude>;
  v_lng      double precision := <google longitude>;
  v_place_id text             := '<google place id>';
begin
  -- Move "added to my venues" rows, skipping if that user already has
  -- the keep_id row too (PK is (user_id, venue_id)).
  insert into user_venues (user_id, venue_id, added_at)
  select user_id, keep_id, added_at
  from user_venues
  where venue_id = old_id
  on conflict (user_id, venue_id) do nothing;

  delete from user_venues where venue_id = old_id;

  -- Move endorsements the same way.
  insert into venue_votes (user_id, venue_id, created_at)
  select user_id, keep_id, created_at
  from venue_votes
  where venue_id = old_id
  on conflict (user_id, venue_id) do nothing;

  delete from venue_votes where venue_id = old_id;

  -- Move per-user dance tags at this venue.
  insert into user_venue_dances
    (user_id, venue_id, dance_id, dance_name, dance_song, dance_difficulty, song_swap, added_at)
  select user_id, keep_id, dance_id, dance_name, dance_song, dance_difficulty, song_swap, added_at
  from user_venue_dances
  where venue_id = old_id
  on conflict (user_id, venue_id, dance_id) do nothing;

  delete from user_venue_dances where venue_id = old_id;

  -- Re-point anyone's home bar if it was set to the old row.
  update profiles set default_venue_id = keep_id where default_venue_id = old_id;

  -- Enrich the surviving row with the real Google Places data —
  -- overwrite name outright so it matches Google's official listing.
  update venues set
    name = v_name,
    address = v_address,
    latitude = v_lat,
    longitude = v_lng,
    google_place_id = v_place_id
  where id = keep_id;

  -- Remove the now-empty duplicate.
  delete from venues where id = old_id;
end $$;
