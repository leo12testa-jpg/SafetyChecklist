-- ISOLATED QA ONLY: recreate the three broad legacy grants to prove the restrictive gate.
create policy qa_legacy_photos_select on storage.objects for select to anon
using (bucket_id = 'foto-sopralluoghi');
create policy qa_legacy_photos_insert on storage.objects for insert to anon
with check (bucket_id = 'foto-sopralluoghi');
create policy qa_legacy_photos_delete on storage.objects for delete to anon
using (bucket_id = 'foto-sopralluoghi');
-- Additive gate: no object/name/metadata is deleted or rewritten.
-- Restrictive policies intersect existing permissive policies, including broad anon grants.
create policy safetychecklist_photos_backend_only
on storage.objects as restrictive for all to anon, authenticated
using (bucket_id <> 'foto-sopralluoghi')
with check (bucket_id <> 'foto-sopralluoghi');
