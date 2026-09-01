-- Run this ONCE against an existing Supabase project that already ran the
-- old schema.sql (with local dances/dance_venue_songs/song_swaps tables).
-- If you're setting up a brand new project, just run the new schema.sql
-- instead — you don't need this file.

-- Drop the FKs tying progress/shared lists to the local catalog, since
-- dance_id now refers to a BootStepper id, not a row in a local table.
alter table user_dance_progress drop constraint if exists user_dance_progress_dance_id_fkey;
alter table shared_list_dances drop constraint if exists shared_list_dances_dance_id_fkey;

-- Add the denormalized snapshot columns used as an offline/fallback display.
alter table user_dance_progress add column if not exists dance_name text;
alter table user_dance_progress add column if not exists dance_song text;
alter table user_dance_progress add column if not exists dance_difficulty text;
alter table shared_list_dances add column if not exists dance_name text;

-- Best-effort backfill from the old local catalog before it's dropped, so
-- existing rows don't lose their display info.
update user_dance_progress p
set dance_name = d.name, dance_song = d.default_song, dance_difficulty = d.difficulty
from dances d
where d.id = p.dance_id and p.dance_name is null;

update shared_list_dances sld
set dance_name = d.name
from dances d
where d.id = sld.dance_id and sld.dance_name is null;

-- The local catalog is now redundant — BootStepper is the source of truth.
drop table if exists dance_venue_songs;
drop table if exists song_swaps;
drop table if exists dances;
