-- Just One More Dance: replace the status-based YouTube playlist split
-- (migration_youtube_status_split.sql — "Learning" vs "Learned") with a
-- kind-based one instead — "Tutorials" (teach videos) vs "Demos" (demo
-- videos), each with its own status scope. Supersedes that migration;
-- nothing has shipped on this yet (confirmed: only ever tested locally,
-- never deployed to the web domain or a shipped native build), so this
-- just repoints the schema rather than trying to preserve old rows.
--
-- Run ONCE.

-- Drop any rows from local testing under the old kind values — they'd
-- never match either new kind anyway.
delete from user_youtube_playlists where kind not in ('tutorials', 'demos');

alter table user_youtube_playlists drop constraint if exists user_youtube_playlists_kind_check;
alter table user_youtube_playlists alter column kind set default 'tutorials';
alter table user_youtube_playlists add constraint user_youtube_playlists_kind_check
  check (kind in ('tutorials', 'demos'));

-- Each kind gets its own status-scope preference now (Everything /
-- Learning + Want to Learn / Learned, same text[] shape as the existing
-- youtube_sync_scope, which this repurposes as "Tutorials'" scope).
alter table profiles add column if not exists youtube_demo_sync_scope text[]
  not null default array['learning', 'learned']::text[];
alter table profiles add constraint profiles_youtube_demo_sync_scope_check
  check (youtube_demo_sync_scope <@ array['learning', 'learned']::text[]);
