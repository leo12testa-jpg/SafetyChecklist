-- DUVRI document metadata only; never insert document bytes into SQL.
-- Server-side Edge Function verifies Firebase ID token and active admin/tecnico.
create table if not exists public.duvri_jobs (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null,
  owner_uid text not null check (length(owner_uid) between 1 and 160),
  state text not null default 'collecting'
    check (state in ('collecting','awaiting_worker','processing','needs_review','failed','cancelled')),
  manifest jsonb not null check (jsonb_typeof(manifest) = 'array'),
  result_path text,
  result_sha256 text,
  failure_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_uid,request_id)
);
create table if not exists public.duvri_job_files (
  job_id uuid not null references public.duvri_jobs(id) on delete cascade,
  slot integer not null check (slot between 0 and 11),
  object_path text not null,
  length_bytes integer not null check (length_bytes between 1 and 15728640),
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  primary key(job_id,slot)
);
create index if not exists duvri_jobs_owner_recent on public.duvri_jobs(owner_uid,created_at desc);
alter table public.duvri_jobs enable row level security;
alter table public.duvri_job_files enable row level security;
revoke all on public.duvri_jobs from anon,authenticated;
revoke all on public.duvri_job_files from anon,authenticated;
-- Create the bucket through Supabase Storage API, NOT direct SQL storage schema changes.
