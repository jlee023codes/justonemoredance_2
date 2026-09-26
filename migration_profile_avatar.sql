-- Just One More Dance: profile pictures — either a premade icon-badge
-- preset (stored as the literal string "preset:<id>", see
-- src/lib/avatarPresets.ts) or an uploaded photo (a public URL in the new
-- "avatars" Storage bucket below). One column covers both; the client
-- tells them apart by checking for the "preset:" prefix.
--
-- Run ONCE. Idempotent.

alter table profiles add column if not exists avatar_url text;

-- Public bucket: friends need to see each other's avatars (same as
-- display_name/username, already readable cross-profile — see
-- src/services/friends.ts's loadFriends), and there's nothing sensitive
-- in a profile picture itself.
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

drop policy if exists "Avatar images are publicly accessible" on storage.objects;
create policy "Avatar images are publicly accessible"
  on storage.objects for select
  using (bucket_id = 'avatars');

-- Upload path convention: <user_id>/avatar.jpg — the folder name is
-- checked against auth.uid() so a user can only ever write their own.
drop policy if exists "Users can upload their own avatar" on storage.objects;
create policy "Users can upload their own avatar"
  on storage.objects for insert
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Users can update their own avatar" on storage.objects;
create policy "Users can update their own avatar"
  on storage.objects for update
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Users can delete their own avatar" on storage.objects;
create policy "Users can delete their own avatar"
  on storage.objects for delete
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
