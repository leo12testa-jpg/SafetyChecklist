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

test('single action creates a source-grounded local Word REVIEW DRAFT without issuance', () => {
  assert.match(ui, /Genera DUVRI/);
  assert.match(ui, /connect.hidden = true/);
  assert.match(ui, /legacy.hidden=true/);
  assert.match(ui, /if \(!ready\) \{ startAfterPair=true; openPair\(\); return; \}/);
  assert.match(ui, /hideLegacySection\(screen.querySelector\?\.\(selector\)\)/);
  assert.match(ui, /'#dg-form'/);
  assert.match(ui, /action.click\(\)/);
  assert.match(ui, /result\.word_generated!==false/);
  assert.match(ui, /\/api\/jobs\//);
  assert.match(ui, /\/draft\/download/);
  assert.match(ui, /report\.word_generated!==true/);
  assert.match(ui, /report\.issuance_allowed!==false/);
  assert.match(ui, /report\.document_status!=='NON_EMETTIBILE'/);
  assert.match(ui, /crypto\.subtle\.digest\('SHA-256',bytes\)/);
  assert.match(ui, /if \(hex!==report\.sha256\)/);
  assert.match(ui, /Bozza Word scaricata/);
  assert.match(ui, /report\.hse_review_topics/);
  assert.match(ui, /report\.unverified_temporal_overlaps/);
  assert.match(ui, /Sovrapposizioni SOLO temporali da chiarire/);
  assert.match(ui, /NON EMETTIBILE/);
  assert.match(ui, /senza invio a servizi AI esterni/);
  assert.doesNotMatch(ui, /api\.anthropic\.com|api\.openai\.com|supabase\.co/);
  assert.match(read('js/supabase-config.js'), /DOCUMENT_GENERATION_CLOUD_ENABLED = false/);
});
