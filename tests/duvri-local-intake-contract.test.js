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
  assert.match(ui, /report\.ai_agents_executed/);
  assert.match(ui, /report\.ai_hypotheses_to_review/);
  assert.match(ui, /report\.ai_exhaustive_analysis===false/);
  assert.match(ui, /AI locale eseguita/);
  assert.match(ui, /AI non eseguita/);
  assert.match(ui, /Lettura AI non esaustiva/);
  assert.match(ui, /report\.sources_without_selectable_text/);
  assert.match(ui, /report\.sources_with_reading_limits/);
  assert.match(ui, /report\.ai_batches_planned/);
  assert.match(ui, /report\.ai_batches_completed/);
  assert.match(ui, /fonti senza testo selezionabile/);
  assert.match(ui, /file presentano limiti di lettura/);
  assert.match(ui, /lotti completati/);
  assert.match(ui, /report\.scheduled_overlap_questions/);
  assert.match(ui, /report\.schedule_quality/);
  assert.match(ui, /cronoprogramma incompleto o dati da riconciliare/);
  assert.match(ui, /NON sono rischi accertati/);
  assert.match(ui, /Nessuna sovrapposizione oraria dimostrata automaticamente/);
  assert.match(ui, /NON EMETTIBILE/);
  assert.match(ui, /senza invio a servizi AI esterni/);
  assert.doesNotMatch(ui, /api\.anthropic\.com|api\.openai\.com|supabase\.co/);
  assert.match(read('js/supabase-config.js'), /DOCUMENT_GENERATION_CLOUD_ENABLED = false/);
});
