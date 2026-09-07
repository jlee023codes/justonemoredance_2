-- Just One More Dance: Apple Notes import queue.
--
-- Run in the Supabase SQL editor after schema.sql. Idempotent.
--
-- When a user pastes a checklist of line dances from their Notes app, one
-- row is written here per parsed line. They then match each line to a real
-- BootStepper dance one at a time; "That's all for now" leaves the rest
-- 'pending' so they can resume from Profile later.

create table if not exists dance_import_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  -- The dance name exactly as it appeared in the note.
  raw_name text not null,
  -- A trailing URL from the note ("Footloose - youtube.com"), if any.
  raw_link text,
  -- Checked-off items in a Notes checklist are treated as already learned.
  suggested_status text not null default 'want'
    check (suggested_status in ('want', 'learned')),
  position int not null default 0,
  status text not null default 'pending'
    check (status in ('pending', 'done', 'skipped')),
  created_at timestamptz not null default now()
);

create index if not exists dance_import_items_user_pending
  on dance_import_items (user_id, created_at, position)
  where status = 'pending';

alter table dance_import_items enable row level security;
drop policy if exists "own import items" on dance_import_items;
create policy "own import items" on dance_import_items
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Optional reference link (YouTube / TikTok / …) carried over from the
-- note and kept on the dance for display later.
alter table user_dance_progress add column if not exists link text;
