-- Yuktara schema, part 8: private storage buckets.
--
-- Object paths start with the client's user id:
--   progress-photos/<client_id>/progress/<date>-<rand>.jpg
--   meal-photos/<client_id>/meals/<date>-<rand>.jpg
-- The app compresses photos on the device before upload (frontend/src/lib/image.ts)
-- and shows them through short-lived signed URLs.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('progress-photos', 'progress-photos', false, 5242880, array['image/jpeg', 'image/webp', 'image/png']),
  ('meal-photos', 'meal-photos', false, 5242880, array['image/jpeg', 'image/webp', 'image/png'])
on conflict (id) do nothing;

create function public.storage_owner(object_name text)
returns uuid
language sql
immutable
as $$
  select case when (storage.foldername(object_name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then ((storage.foldername(object_name))[1])::uuid end;
$$;

create policy "photos: client uploads to own folder" on storage.objects
  for insert to authenticated
  with check (
    bucket_id in ('progress-photos', 'meal-photos')
    and public.storage_owner(name) = (select auth.uid())
  );

create policy "photos: client or coach reads" on storage.objects
  for select to authenticated
  using (
    bucket_id in ('progress-photos', 'meal-photos')
    and public.can_see_client(public.storage_owner(name))
  );

create policy "photos: client deletes own" on storage.objects
  for delete to authenticated
  using (
    bucket_id in ('progress-photos', 'meal-photos')
    and public.storage_owner(name) = (select auth.uid())
  );
