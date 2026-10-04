-- Public, non-revocable share links for a dance session — e.g.
-- justonemoredance.com/s/abc123 — rendered by the share-session Edge
-- Function. token is a random, unguessable short id (not the
-- checkin's own uuid), so a leaked link can't be used to enumerate
-- other sessions. RLS here only governs creating/looking up the
-- token row itself — the Edge Function reads the actual session data
-- (venue_checkins/venues) with the service-role key server-side,
-- deliberately bypassing RLS for just that one looked-up row, rather
-- than this migration adding any anon-read policy to those tables.

create table if not exists session_shares (
  token text primary key,
  checkin_id uuid not null references venue_checkins(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists session_shares_checkin_idx on session_shares (checkin_id);

alter table session_shares enable row level security;

drop policy if exists "manage own session shares" on session_shares;
create policy "manage own session shares" on session_shares for all
  using (
    exists (
      select 1 from venue_checkins c
      where c.id = checkin_id and c.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from venue_checkins c
      where c.id = checkin_id and c.user_id = auth.uid()
    )
  );

grant select, insert on session_shares to authenticated;

notify pgrst, 'reload schema';
