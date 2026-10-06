-- Extends venue visibility to also cover "I've added this venue to
-- my own list" (user_venues), not just "I'm its created_by." Two
-- reasons:
--  1. Every pre-existing venue has created_by = null (that column was
--     only added later, never backfilled) — under the lock policy
--     from migration_venue_lock.sql alone, nobody could see any of
--     them anymore once the real old blanket policy was finally
--     dropped (migration_venue_lock_fix.sql), since none has a
--     creator and none has 5 check-ins yet. user_venues already
--     tracks who's added each venue, going back to whenever they
--     first did, which is the closest real signal we have for "who
--     effectively created/brought in this venue" for old rows.
--  2. It also matches the feature's original spec more closely:
--     visible to whoever added it to their own list, not only to
--     whoever's literal created_by column says — someone who adds an
--     existing-but-still-locked venue to their list should be able to
--     see it too, the same as its original adder can.

drop policy if exists "read venues" on venues;
create policy "read venues" on venues for select
  using (
    created_by = auth.uid()
    or exists (
      select 1 from user_venues uv
      where uv.venue_id = venues.id and uv.user_id = auth.uid()
    )
    or exists (
      select 1 from venue_checkin_counts c
      where c.venue_id = venues.id and c.checkin_count >= 5
    )
  );

notify pgrst, 'reload schema';
