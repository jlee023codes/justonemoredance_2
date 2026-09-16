-- Just One More Dance: profile "fun facts" — favorite dance right now, how
-- long you've been line dancing, and your first dance learned.
--
-- Run ONCE. Idempotent.
--
-- Self-reported free text, not tied to the BootStepper catalog — these are
-- personal color, not structured data. first_dance is self-reported rather
-- than derived from user_dance_progress on purpose: an imported list or
-- one added out of order makes "oldest row currently marked learned" a bad
-- guess, and this is the kind of thing people actually remember. Readable
-- by friends already: the "read connected profiles" policy from
-- migration_friend_requests.sql covers any column on `profiles`, this
-- needs nothing new. "Home bar" is already profiles.default_venue_id — no
-- new column for that one.

alter table profiles add column if not exists favorite_dance text;
alter table profiles add column if not exists dancer_since text;
alter table profiles add column if not exists first_dance text;
