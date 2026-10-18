-- Profile pictures: users.avatar_url holds a path in the private "avatars"
-- bucket, "<user id>/avatar/<date>-<random>.jpg". Uploads go through the API's
-- signed upload link (POST /photos/upload-url, kind "avatar"), which builds the
-- path from the verified user id. Shown through short-lived signed URLs to the
-- person, their coach and the coach's clients (the same people who can read
-- each other's users row).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', false, 5242880, array['image/jpeg', 'image/webp', 'image/png'])
on conflict (id) do nothing;

-- Only a path in the person's own avatar folder.
alter table public.users
  add constraint users_avatar_url_check
  check (avatar_url is null or (starts_with(avatar_url, id::text || '/avatar/') and char_length(avatar_url) <= 200));

create policy "avatars: own folder" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and public.storage_owner(name) = (select auth.uid()));

create policy "avatars: self, my coach, my clients read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'avatars'
    and (
      public.storage_owner(name) = (select auth.uid())
      or public.storage_owner(name) = public.my_coach_id()
      or public.is_coach_of(public.storage_owner(name))
    )
  );

create policy "avatars: delete own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and public.storage_owner(name) = (select auth.uid()));
