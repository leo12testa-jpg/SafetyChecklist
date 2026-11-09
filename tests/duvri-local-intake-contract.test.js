'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const ui = read('js/document-local-intake.js');
const main = read('index.html');
const pwa = read('service-worker.js');

test('local source intake mounts only in the existing document generation screen', () => {
  assert.match(main, /<script src="js\/document-generation-action\.js"><\/script>/);
  assert.match(main, /<script src="js\/document-local-intake\.js"><\/script>/);
  assert.match(ui, /getElementById\('dg-generate-action'\)/);
  assert.match(ui, /documentIntakeSelection/);
  assert.match(pwa, /'\.\/js\/document-local-intake\.js'/);
});

test('browser pairs explicitly to loopback, never remote customer data processing', () => {
  assert.match(ui, /http:\/\/127\.0\.0\.1:4198/);
  assert.match(ui, /window\.open\(ORIGIN\+'\/pair'/);
  assert.match(ui, /event\.origin!==ORIGIN/);
  assert.match(ui, /event\.source!==popup/);
  assert.match(ui, /X-Colligo-Local-Token/);
  assert.match(ui, /targetAddressSpace:'loopback'/);
  assert.doesNotMatch(ui, /api\.anthropic\.com|api\.openai\.com|supabase\.co/);
});

test('no generation or issuance is claimed when only the local source-ingestion step runs', () => {
  assert.match(ui, /Prepara fascicolo DUVRI/);
  assert.match(ui, /connect.hidden = true/);
  assert.match(ui, /legacy.hidden=true/);
  assert.match(ui, /if \(!ready\) \{ startAfterPair=true; openPair\(\); return; \}/);
  assert.match(ui, /hideLegacySection\(screen.querySelector\?\.\(selector\)\)/);
  assert.match(ui, /'#dg-form'/);
  assert.match(ui, /action.click\(\)/);
  assert.match(ui, /result\.word_generated!==false/);
  assert.match(ui, /result\.issuance_allowed!==false/);
  assert.match(ui, /NON è stato generato un DUVRI/);
  assert.match(ui, /documenti sintetici o inventati/);
  assert.match(read('js/supabase-config.js'), /DOCUMENT_GENERATION_CLOUD_ENABLED = false/);
});
