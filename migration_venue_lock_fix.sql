-- migration_venue_lock.sql tried to replace the blanket "every venue
-- is visible to everyone" SELECT policy with a narrowed one, but its
-- `drop policy if exists "read venues" on venues` missed the mark:
-- the real policy in the live database is actually named
-- "Authenticated users can read venues" (schema.sql's own
-- "read venues" name was stale/out of date, not what's actually
-- there), so that drop silently no-op'd. Postgres ORs multiple
-- permissive SELECT policies together — with the original
-- always-true policy still active, it alone made every row visible
-- regardless of the new narrower policy sitting right next to it.
-- This drops the actual blanket policy by its real name.

drop policy if exists "Authenticated users can read venues" on venues;

notify pgrst, 'reload schema';

-- Verify: should return exactly one row ("read venues").
select policyname, cmd, qual from pg_policies where tablename = 'venues' and cmd = 'SELECT';
