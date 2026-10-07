-- One-off fix: firehorse-saloon ended up with created_by = null
-- despite being added through the app's normal Check In / Venues-add
-- flow, which always passes a real userId into
-- findOrCreateGlobalVenue(FromPlace) and sets created_by: userId on
-- insert. The exact mechanism that produced the null wasn't
-- reproducible, but the practical effect is severe: the "read
-- venues" policy (migration_venue_lock_threshold_3.sql) requires
-- created_by = auth.uid() OR a user_venues row OR public_count >= 3
-- — a row with created_by null and no user_venues link becomes
-- invisible to EVERYONE, including whoever actually added it, with no
-- way to recover it from inside the app (you can't add a night,
-- can't tag a dance there, can't even see it in search — it's simply
-- gone, as reported).
--
-- Run this once to recover the specific venue, replacing both the id
-- and the user id with the real values.
update venues
set created_by = 'YOUR_USER_ID_HERE'
where id = 'firehorse-saloon' and created_by is null;

notify pgrst, 'reload schema';
