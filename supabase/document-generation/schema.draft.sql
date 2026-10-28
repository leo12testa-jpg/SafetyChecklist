-- DRAFT ONLY — do not apply to the live Supabase project yet.
-- Prepare an isolated migration via Supabase CLI after PR/QA approval.
-- Storage objects and job data are accessed only by the authenticated server functions.

create table if not exists public.document_jobs (
  id uuid primary key default gen_random_uuid(),
  created_by text not null,
  created_by_role text not null check (created_by_role in ('admin','tecnico')),
  document_type text not null default 'duvri' check (document_type in ('duvri')),
  title text not null default '',
  status text not null default 'queued' check (status in (
    'queued','processing','retry_wait','awaiting_input','awaiting_configuration',
    'needs_review','approved','rejected','error','cancelled'
  )),
  phase text not null default 'extract' check (phase in (
    'extract','analyze','draft','validate','review','configuration'
  )),
  status_message text not null default 'In coda',
  input_payload jsonb not null default '{}'::jsonb,
  agent_outputs jsonb not null default '{}'::jsonb,
  validation_report jsonb not null default '{}'::jsonb,
  output_path text,
  template_version text not null default 'DUVRI_BASE_GENERALE_2026',
  skill_version text not null default 'duvri-colligo/0.1.0',
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 5 check (max_attempts between 1 and 12),
  run_count integer not null default 0 check (run_count >= 0),
  next_attempt_at timestamptz,
  lease_until timestamptz,
  claim_token uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  reviewed_by text,
  reviewed_at timestamptz,
  review_decision text check (review_decision is null or review_decision in ('approved','changes_requested','rejected'))
);

create index if not exists document_jobs_status_created_idx
  on public.document_jobs (status, created_at);

create index if not exists document_jobs_owner_created_idx
  on public.document_jobs (created_by, created_at desc);

create table if not exists public.document_job_files (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.document_jobs(id) on delete cascade,
  uploaded_by text not null,
  role text not null check (role in ('checklist','supporting','draft_docx','preview_pdf','review_report')),
  object_path text not null unique,
  filename text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes >= 0),
  sha256 text,
  created_at timestamptz not null default now()
);

create index if not exists document_job_files_job_idx
  on public.document_job_files (job_id, created_at);

create table if not exists public.document_job_events (
  id bigint generated always as identity primary key,
  job_id uuid not null references public.document_jobs(id) on delete cascade,
  actor_uid text,
  agent text,
  phase text not null,
  event_type text not null check (event_type in ('created','started','progress','completed','warning','retry','failed','review')),
  message text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists document_job_events_job_idx
  on public.document_job_events (job_id, created_at);

alter table public.document_jobs enable row level security;
alter table public.document_job_files enable row level security;
alter table public.document_job_events enable row level security;

-- The browser does not query these tables directly. Edge Functions verify Firebase
-- identity and use the server-side service role. Do not add client-facing policies.
revoke all on public.document_jobs from anon, authenticated;
revoke all on public.document_job_files from anon, authenticated;
revoke all on public.document_job_events from anon, authenticated;
grant all on public.document_jobs to service_role;
grant all on public.document_job_files to service_role;
grant all on public.document_job_events to service_role;
grant usage, select on sequence public.document_job_events_id_seq to service_role;

-- Atomically claims one queued/expired job. Must be called only from the server function
-- using the Supabase service-role JWT. A lease lets another invocation recover work if
-- a worker dies or times out while the user's computer is off.
create or replace function public.claim_document_job()
returns setof public.document_jobs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text;
begin
  v_role := current_setting('request.jwt.claim.role', true);
  if coalesce(v_role, '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'service role required';
  end if;

  return query
  with candidate as (
    select j.id
    from public.document_jobs j
    where
      (
        j.status in ('queued','retry_wait')
        and coalesce(j.next_attempt_at, now()) <= now()
      )
      or (
        j.status = 'processing'
        and j.lease_until is not null
        and j.lease_until < now()
      )
    order by j.created_at asc
    for update skip locked
    limit 1
  )
  update public.document_jobs j
     set status = 'processing',
         phase = case when j.phase = 'configuration' then 'extract' else j.phase end,
         status_message = 'Lavorazione cloud in corso',
         run_count = j.run_count + 1,
         claim_token = gen_random_uuid(),
         lease_until = now() + interval '5 minutes',
         next_attempt_at = null,
         updated_at = now()
    from candidate c
   where j.id = c.id
  returning j.*;
end;
$$;

revoke all on function public.claim_document_job() from public, anon, authenticated;
grant execute on function public.claim_document_job() to service_role;

-- Create the private bucket. No direct browser Storage access is required: jobs
-- upload/download through the authenticated Edge Function only.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'documenti-generati',
  'documenti-generati',
  false,
  52428800,
  array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'text/plain',
    'text/csv',
    'application/json',
    'image/png',
    'image/jpeg'
  ]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- Restrict only the new private document bucket. Existing photo storage and all
-- unrelated buckets/policies are deliberately untouched.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'document_generation_backend_only'
  ) then
    create policy document_generation_backend_only
      on storage.objects as restrictive
      for all to anon, authenticated
      using (bucket_id <> 'documenti-generati')
      with check (bucket_id <> 'documenti-generati');
  end if;
end $$;
