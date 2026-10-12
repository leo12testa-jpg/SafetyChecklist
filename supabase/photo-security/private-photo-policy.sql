-- RELEASE PLAN ONLY. Do not run against production without explicit approval.
-- Preserve every object and existing policy; restrict only the SafetyChecklist bucket.
begin;
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname='storage' and tablename='objects'
      and policyname='safetychecklist_photos_backend_only'
  ) then
    create policy safetychecklist_photos_backend_only
    on storage.objects as restrictive for all to anon, authenticated
    using (bucket_id <> 'foto-sopralluoghi')
    with check (bucket_id <> 'foto-sopralluoghi');
  end if;
end $$;
commit;
