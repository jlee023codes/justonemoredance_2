-- Lowers the public-unlock threshold from 5 to 3 distinct users
-- (check-in or dance-tag, combined — venue_public_counts), and merges
-- it with the separate "Verified" concept that used to mean something
-- narrower (3 check-ins specifically, via venue_checkin_counts). One
-- threshold, one meaning now: crossing it both unlocks the venue for
-- everyone and is what the app calls "Verified." See
-- src/services/venues.ts's VENUE_PUBLIC_THRESHOLD.

drop policy if exists "read venues" on venues;
create policy "read venues" on venues for select
  using (
    created_by = auth.uid()
    or exists (
      select 1 from user_venues uv
      where uv.venue_id = venues.id and uv.user_id = auth.uid()
    )
    or exists (
      select 1 from venue_public_counts c
      where c.venue_id = venues.id and c.public_count >= 3
    )
  );

notify pgrst, 'reload schema';
