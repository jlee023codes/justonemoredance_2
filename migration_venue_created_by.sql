-- Tracks who first added a venue, so they can seed its weekly schedule
-- right at creation time (and keep editing it later) without needing a
-- separate rep-approval round trip — "you found it, you maintain it".
-- venues already has an open insert policy (schema.sql: "insert venues"
-- for insert to authenticated with check (true)), so no policy change
-- is needed here for the app to set this column on insert.

alter table venues add column if not exists created_by uuid references auth.users(id) on delete set null;

create or replace function public.can_manage_venue(target_venue_id text)
returns boolean language sql stable as $$
  select
    exists (select 1 from profiles where id = auth.uid() and is_admin)
    or exists (select 1 from venues where id = target_venue_id and created_by = auth.uid())
    or exists (
      select 1 from venue_representatives
      where venue_id = target_venue_id and user_id = auth.uid() and status = 'approved'
    )
$$;
