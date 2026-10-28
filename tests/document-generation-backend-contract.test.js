const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const gateway = fs.readFileSync('supabase/functions/document-jobs/index.ts', 'utf8');
const worker = fs.readFileSync('supabase/functions/document-worker/index.ts', 'utf8');
const duvriAgent = fs.readFileSync('supabase/functions/document-worker/duvri-agent.ts', 'utf8');
const schema = fs.readFileSync('supabase/document-generation/schema.draft.sql', 'utf8');

test('il gateway richiede identità Firebase attiva e ruolo aziendale autorizzato', () => {
  assert.match(gateway, /accounts:lookup/);
  assert.match(gateway, /profile\.attivo !== true/);
  assert.match(gateway, /\['admin','tecnico'\]/);
  assert.match(gateway, /created_by/);
});

test('i file sono conservati in un bucket privato e accessibili solo dal backend', () => {
  assert.match(gateway, /const BUCKET = 'documenti-generati'/);
  assert.match(gateway, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(schema, /public = false/);
  assert.match(schema, /document_generation_backend_only/);
  assert.match(schema, /revoke all on public\.document_jobs from anon, authenticated/i);
  assert.match(schema, /alter table public\.document_jobs enable row level security/i);
});

test('la coda cloud usa claim atomico, lease e job persistenti', () => {
  assert.match(schema, /claim_document_job\(\)/);
  assert.match(schema, /for update skip locked/i);
  assert.match(schema, /lease_until/);
  assert.match(schema, /worker_token|claim_token/);
  assert.match(worker, /rpc\/claim_document_job/);
  assert.match(worker, /x-document-worker-secret/);
});

test('il motore AI supporta Claude API e OpenAI, ma resta disattivato senza configurazione e consenso', () => {
  assert.match(worker, /DOCUMENT_PIPELINE_ENABLED.*=== 'true'/);
  assert.match(worker, /DOCUMENT_AI_PROVIDER/);
  assert.match(worker, /ANTHROPIC_API_KEY/);
  assert.match(worker, /OPENAI_API_KEY/);
  assert.match(worker, /api\.anthropic\.com\/v1\/messages/);
  assert.match(worker, /expires_in_seconds/);
  assert.match(worker, /extractDocxText/);
  assert.match(worker, /extractXlsxText/);
  assert.match(worker, /DOCUMENT_AI_MODEL/);
  assert.match(worker, /aiDataProcessingConsent !== true/);
  assert.match(gateway, /aiDataProcessingConsent !== true/);
});

test('lavori lunghi sono suddivisi in fasi persistenti, non dipendono dal browser', () => {
  assert.match(worker, /phase === 'extract'/);
  assert.match(worker, /phase === 'analyze'/);
  assert.match(worker, /phase === 'draft'/);
  assert.match(worker, /status: 'queued'/);
  assert.match(gateway, /awaiting_configuration/);
  assert.match(gateway, /action === 'retry'/);
});

test('il worker non dichiara di aver generato un DOCX finché il motore Word e la regola di rischio non sono approvati', () => {
  assert.match(worker, /DUVRI_DOCX_ENGINE_ENABLED/);
  assert.match(worker, /DUVRI_RISK_RULE_APPROVED/);
  assert.match(worker, /Il compilatore OOXML Word deve superare i test/);
  assert.match(worker, /La regola ufficiale degli indici di rischio deve essere approvata/);
  assert.match(worker, /DUVRI_RISK_RULE_DESCRIPTION/);
});

test('il redattore e il verificatore producono soltanto bozze sotto revisione umana', () => {
  assert.match(worker, /populateDuvriTemplate\(templateBytes, draft\)/);
  assert.match(worker, /status: 'needs_review'/);
  assert.match(worker, /awaitInput\(job/);
  assert.match(duvriAgent, /validateDuvriDraft/);
  assert.match(duvriAgent, /buildDuvriQaPrompt/);
  assert.match(duvriAgent, /humanReviewRequired: true/);
  assert.match(duvriAgent, /La regola di valutazione approvata da Colligo/);
});
