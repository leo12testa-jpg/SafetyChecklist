const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const config = fs.readFileSync(path.join(root, 'js', 'supabase-config.js'), 'utf8');
const worker = fs.readFileSync(path.join(root, 'supabase', 'functions', 'document-worker', 'index.ts'), 'utf8');
const schema = fs.readFileSync(path.join(root, 'supabase', 'document-generation', 'schema.draft.sql'), 'utf8');

test('cloud document generation stays disabled in the browser', () => {
  assert.match(config, /const DOCUMENT_GENERATION_CLOUD_ENABLED = false;/);
});

test('DUVRI drafting is blocked until the approved method and controlled template are configured', () => {
  assert.match(worker, /DUVRI_RISK_RULE_APPROVED/);
  assert.match(worker, /DUVRI_RISK_RULE_DESCRIPTION/);
  assert.match(worker, /DUVRI_RISK_RULE_APPROVAL_ID/);
  assert.match(worker, /DUVRI_RISK_RULE_VERSION/);
  assert.match(worker, /DUVRI_TEMPLATE_OBJECT_PATH/);
  assert.match(worker, /DUVRI_TEMPLATE_VERSION/);
  assert.match(worker, /DUVRI_DOCX_ENGINE_ENABLED/);
  assert.match(worker, /Nessun punteggio è stato calcolato/);
});

test('draft schema is marked draft-only and client roles cannot directly access job tables', () => {
  assert.match(schema, /DRAFT ONLY/);
  for (const table of ['document_type_configs','document_jobs','document_job_files','document_job_events']) {
    assert.match(schema, new RegExp('revoke all on public\\.' + table + ' from anon, authenticated', 'i'));
  }
});
