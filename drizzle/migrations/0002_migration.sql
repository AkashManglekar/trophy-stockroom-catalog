
create policy "media read members" on storage.objects for select to authenticated using (bucket_id='media' and public.is_member());
create policy "media insert contrib" on storage.objects for insert to authenticated with check (bucket_id='media' and public.can_contribute());
create policy "media update contrib" on storage.objects for update to authenticated using (bucket_id='media' and public.can_contribute());
create policy "media delete contrib" on storage.objects for delete to authenticated using (bucket_id='media' and public.can_contribute());
