-- Opt-in preference: silently add new-to-me dances from a tracked
-- session straight to My List, instead of needing a manual visit to
-- Stats' "New To Me" picker. Default false — today's manual behavior
-- stays the default; auto-add is the new opt-in. Same shape as the
-- existing spotify_beta_enabled column (migration_playlist_sync.sql).

alter table profiles add column if not exists auto_add_new_dances boolean not null default false;

notify pgrst, 'reload schema';
