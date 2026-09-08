-- Run ONCE against an existing Supabase project (after schema.sql and the
-- earlier migrations). Idempotent. New projects get this from schema.sql.
--
-- Adds a stable "when this dance first entered my list" timestamp. Until
-- now the only timestamp on a progress row was updated_at, which moves
-- every time the status changes — so "sort by date added" in My List kept
-- shuffling. created_at is set once, on insert, and left alone by
-- saveProgress's upsert afterwards.

alter table user_dance_progress add column if not exists created_at timestamptz;

-- Best-effort backfill for rows that predate this column: the last time
-- they were touched is the closest thing we have to when they were added.
update user_dance_progress
set created_at = coalesce(created_at, updated_at, now());

alter table user_dance_progress alter column created_at set default now();
alter table user_dance_progress alter column created_at set not null;
