-- A personal "favorite this venue" star/heart — unlike venue_votes
-- (a public endorsement everyone sees), this is private per-user
-- preference, so full CRUD on your own rows is fine (no first-
-- submission-wins or admin gating needed, same as toggling a vote).
create table if not exists user_venue_favorites (
  user_id uuid not null references auth.users(id) on delete cascade,
  venue_id text not null references venues(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, venue_id)
);

alter table user_venue_favorites enable row level security;

drop policy if exists "manage own favorites" on user_venue_favorites;
create policy "manage own favorites" on user_venue_favorites for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

grant select, insert, delete on user_venue_favorites to authenticated;
