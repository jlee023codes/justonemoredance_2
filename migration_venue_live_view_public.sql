-- Lets anyone browsing the Venues screen see "View Live Logging" for
-- a venue that currently has an active session, and open a read-only
-- view of what's being logged there — without being checked in
-- themselves. Previously, venue_live_presence/venue_live_dances/
-- venue_live_dance_marks were only readable by someone with their own
-- active check-in at that same venue (is_live_at_venue,
-- migration_venue_live_sessions.sql). That gate stays exactly as it
-- is for everything participation-related (logging a dance, marking
-- "danced", the live session screen itself) — this migration only
-- adds a second, read-only, no-check-in-required path for browsing.
--
-- Postgres ORs multiple permissive SELECT policies together, so these
-- are additive: they widen who can read, never narrow the existing
-- checked-in users' access.

drop policy if exists "read live presence publicly" on venue_checkins;
create policy "read live presence publicly" on venue_checkins for select
  using (ended_at is null);

drop policy if exists "read live dances publicly" on venue_live_dances;
create policy "read live dances publicly" on venue_live_dances for select
  using (true);

drop policy if exists "read live marks publicly" on venue_live_dance_marks;
create policy "read live marks publicly" on venue_live_dance_marks for select
  using (true);

-- Display names/avatars for whoever's logging, same reasoning as the
-- existing "read live venue profiles" policy — just not limited to
-- people who share a live venue with the viewer.
drop policy if exists "read live logger profiles publicly" on profiles;
create policy "read live logger profiles publicly" on profiles for select
  using (
    exists (
      select 1 from venue_live_dances d
      where d.logged_by = profiles.id
    )
  );

notify pgrst, 'reload schema';
