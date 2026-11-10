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
  assert.match(ui, /Download bozza Word avviato/);
  assert.match(ui, /report\.ai_agents_executed/);
  assert.match(ui, /report\.ai_hypotheses_to_review/);
  assert.match(ui, /report\.ai_exhaustive_analysis===false/);
  assert.match(ui, /report\.visual_sources_eligible/);
  assert.match(ui, /report\.visual_sources_sampled/);
  assert.match(ui, /report\.visual_review_status==='VISION_MODEL_UNAVAILABLE'/);
  assert.match(ui, /report\.visual_observations_to_confirm/);
  assert.match(ui, /report\.visual_pages_deferred/);
  assert.match(ui, /foto e pagine PDF NON esaminate visivamente/);
  assert.match(ui, /osservazioni NON verificate/);
  assert.match(ui, /report\.ai_specialist_tasks_deferred/);
  assert.match(ui, /report\.ai_cross_agent_divergences_to_resolve/);
  assert.match(ui, /report\.ai_hypotheses_truncated/);
  assert.match(ui, /divergenze tra proposte AI nel Word/);
  assert.match(ui, /proposte AI fuori dal limite di elaborazione/);
  assert.match(ui, /analisi specialistiche AI non eseguite per limite elaborazione/);
  assert.match(ui, /Analizzatori AI dichiarati dal motore/);
  assert.match(ui, /Nessun analizzatore AI dichiarato/);
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

test('V15 blocks malformed draft metadata and non-DOCX downloads', () => {
  assert.match(ui, /Number\.isSafeInteger\(report\.source_count\)/);
  assert.match(ui, /Number\.isSafeInteger\(report\.source_candidates_rendered\)/);
  assert.match(ui, /Rapporto Word privo di conteggi delle fonti verificabili/);
  assert.match(ui, /const signature=new Uint8Array\(bytes,0,Math\.min\(4,bytes\.byteLength\)\)/);
  assert.match(ui, /signature\[0\]!==0x50/);
  assert.match(ui, /signature\[1\]!==0x4b/);
  assert.match(ui, /Il file scaricato non presenta la firma DOCX richiesta/);
});

test('V15 compares reported source coverage, incomplete AI lots and never implies HSE validation', () => {
  assert.match(ui, /const selectedSources=1\+snap\.attachments\.length/);
  assert.match(ui, /report\.source_count===selectedSources/);
  assert.match(ui, /verificare eventuali file mancanti o fonti aggiuntive/);
  assert.match(ui, /non prova la lettura completa/);
  assert.match(ui, /report\.source_candidates_rendered===0/);
  assert.match(ui, /report\.ai_batches_completed<report\.ai_batches_planned/);
  assert.match(ui, /elaborazione AI parziale/);
  assert.match(ui, /nessuna validazione HSE automatica/);
  assert.match(ui, /Copertura visiva dichiarata dal motore/);
  assert.match(ui, /Download bozza Word avviato/);
  assert.doesNotMatch(ui, /Bozza Word scaricata/);
});

test('V16 validates actual Word OOXML package rather than only ZIP magic', () => {
  assert.match(ui, /async function validateDocxPackage\(bytes\)/);
  assert.match(ui, /globalThis\.JSZip/);
  assert.match(ui, /engine\.loadAsync\(bytes\)/);
  assert.match(ui, /packageZip\.file\('\[Content_Types\]\.xml'\)/);
  assert.match(ui, /packageZip\.file\('_rels\/\.rels'\)/);
  assert.match(ui, /packageZip\.file\('word\/document\.xml'\)/);
  assert.match(ui, /macro non consentite/);
  assert.match(ui, /Tipo di documento Word DOCX non confermato/);
  assert.match(ui, /await validateDocxPackage\(bytes\)/);
  assert.match(main, /<script src="js\/vendor\/jszip\.min\.js"><\/script>/);
  assert.doesNotMatch(ui, /api\.anthropic\.com|api\.openai\.com|supabase\.co/);
});
