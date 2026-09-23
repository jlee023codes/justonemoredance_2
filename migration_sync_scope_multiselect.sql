-- Just One More Dance: playlist_sync_scope / youtube_sync_scope go from a
-- single three-way enum ('all' | 'learning_learned' | 'learned') to a
-- free-form multi-select array of My List statuses, including "none"
-- (added to My List but not yet tagged) as its own real, selectable
-- option instead of something only silently bundled into "all". See
-- src/services/musicSync.ts's PlaylistSyncScope type.
--
-- Run ONCE. Converts existing values in place, no data loss.

-- ---------------------------------------------------------------------
-- playlist_sync_scope (Spotify / Apple Music)
-- ---------------------------------------------------------------------

alter table profiles drop constraint if exists profiles_playlist_sync_scope_check;
alter table profiles alter column playlist_sync_scope drop default;

alter table profiles
  alter column playlist_sync_scope type text[]
  using (
    case playlist_sync_scope
      when 'all' then array['none', 'want', 'learning', 'learned']
      when 'learned' then array['learned']
      else array['learning', 'learned'] -- 'learning_learned' and any other legacy value
    end
  );

alter table profiles
  alter column playlist_sync_scope set default array['learning', 'learned']::text[];

alter table profiles add constraint profiles_playlist_sync_scope_check
  check (playlist_sync_scope <@ array['none', 'want', 'learning', 'learned']::text[]);

-- ---------------------------------------------------------------------
-- youtube_sync_scope
-- ---------------------------------------------------------------------

alter table profiles drop constraint if exists profiles_youtube_sync_scope_check;
alter table profiles alter column youtube_sync_scope drop default;

alter table profiles
  alter column youtube_sync_scope type text[]
  using (
    case youtube_sync_scope
      when 'all' then array['none', 'want', 'learning', 'learned']
      when 'learned' then array['learned']
      else array['learning', 'learned']
    end
  );

alter table profiles
  alter column youtube_sync_scope set default array['learning', 'learned']::text[];

alter table profiles add constraint profiles_youtube_sync_scope_check
  check (youtube_sync_scope <@ array['none', 'want', 'learning', 'learned']::text[]);
