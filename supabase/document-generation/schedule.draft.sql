-- DRAFT ONLY: never run against production until reviewed and approved.
-- Purpose: invoke one persistent document job each minute even if every user's browser is closed.
--
-- Prerequisites (configure only in an isolated Supabase project first):
-- 1. Deploy the document-worker Edge Function with DOCUMENT_WORKER_SECRET set to a long random secret.
-- 2. Keep DOCUMENT_PIPELINE_ENABLED=false while testing.
-- 3. In the Supabase SQL editor, store the worker URL and THE SAME worker secret in Vault.
--    Do not put real secrets in this file, a Git commit, or the frontend.
--    Example placeholders (replace locally; do not commit values):
--      select vault.create_secret('https://<PROJECT_REF>.supabase.co/functions/v1/document-worker', 'document_worker_url');
--      select vault.create_secret('<SAME_VALUE_AS_DOCUMENT_WORKER_SECRET>', 'document_worker_secret');
-- 4. Confirm the document-worker URL is correct and the secret matches the Edge Function secret.
-- 5. Enable the schedule only after the local security/OOXML QA gates pass.

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

-- Make the draft schedule idempotent when rerun.
select cron.unschedule(jobid)
from cron.job
where jobname = 'document-worker-every-minute';

select cron.schedule(
  'document-worker-every-minute',
  '* * * * *',
  $schedule$
    select net.http_post(
      url := (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'document_worker_url'
        limit 1
      ),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-document-worker-secret', (
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'document_worker_secret'
          limit 1
        )
      ),
      body := '{}'::jsonb
    );
  $schedule$
);
