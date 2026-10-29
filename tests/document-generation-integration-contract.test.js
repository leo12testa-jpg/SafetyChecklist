const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');

const ui = read('js', 'document-generation.js');
const config = read('js', 'supabase-config.js');
const gateway = read('supabase', 'functions', 'document-jobs', 'index.ts');
const validation = read('supabase', 'functions', 'document-jobs', 'validation.ts');
const worker = read('supabase', 'functions', 'document-worker', 'index.ts');
const schema = read('supabase', 'document-generation', 'schema.draft.sql');

test('the UI and gateway agree on the multipart intake contract', () => {
  assert.match(ui, /upload\.append\('metadata', JSON\.stringify\(/);
  assert.match(ui, /upload\.append\('checklist', checklist, checklist\.name\)/);
  assert.match(ui, /upload\.append\('files', file, file\.name\)/);
  assert.match(ui, /requestJobs\('create', \{ method: 'POST', body: upload \}\)/);

  assert.match(gateway, /form\.get\('metadata'\)/);
  assert.match(gateway, /form\.get\('checklist'\)/);
  assert.match(gateway, /form\.getAll\('files'\)/);
  assert.match(gateway, /multipart\/form-data/);
  assert.match(validation, /function collectUploadFiles/);
  assert.match(validation, /function parseMetadata/);
});

test('cloud upload requires explicit consent and remains disabled by default', () => {
  assert.match(config, /const DOCUMENT_GENERATION_CLOUD_ENABLED = false;/);
  assert.match(ui, /preparedRecord\.aiDataProcessingConsent/);
  assert.match(gateway, /metadata\.aiDataProcessingConsent !== true/);
  assert.match(gateway, /confermare il trasferimento dei file al provider AI configurato/);
});

test('the UI consumes the gateway response shape for a queued job', () => {
  assert.match(gateway, /job: \{ id: job\.id, documentType: typeConfig\.slug, documentTypeName: typeConfig\.display_name, status: 'queued'/);
  assert.match(ui, /created\.job\?\.id/);
  assert.match(ui, /created\.job\?\.documentTypeName/);
  assert.match(ui, /created\.job\?\.status/);
});

test('DUVRI generation stays fail-closed until the risk method and controlled template are approved', () => {
  assert.match(worker, /DUVRI_RISK_RULE_APPROVED/);
  assert.match(worker, /DUVRI_RISK_RULE_APPROVAL_ID/);
  assert.match(worker, /DUVRI_RISK_RULE_VERSION/);
  assert.match(worker, /DUVRI_TEMPLATE_OBJECT_PATH/);
  assert.match(worker, /DUVRI_TEMPLATE_VERSION/);
  assert.match(worker, /DUVRI_DOCX_ENGINE_ENABLED/);
  assert.match(worker, /Nessun punteggio è stato calcolato/);
  assert.match(schema, /DRAFT ONLY/);
});
