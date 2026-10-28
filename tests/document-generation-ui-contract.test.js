const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('index.html', 'utf8');
const controller = fs.readFileSync('js/document-generation.js', 'utf8');
const serviceWorker = fs.readFileSync('service-worker.js', 'utf8');

test('la sezione Generazione documenti è raggiungibile dal menu e registrata come schermata', () => {
  assert.match(html, /data-nav="document-generation"/);
  assert.match(html, /data-screen="document-generation"/);
  assert.match(html, /id="dg-form"/);
  assert.match(html, /id="dg-contractors"/);
  assert.match(html, /id="dg-checklist-file"/);
  assert.match(html, /id="dg-agents-title"/);
});

test('il modulo di raccolta include allegati e ripetizione delle imprese', () => {
  assert.match(html, /id="dg-files"/);
  assert.match(html, /id="dg-add-contractor"/);
  assert.match(html, /data-agent="coordinator"/);
  assert.match(html, /data-agent="document-reader"/);
  assert.match(html, /data-agent="duvri-analyst"/);
  assert.match(html, /data-agent="docx-writer"/);
  assert.match(html, /data-agent="quality-check"/);
  assert.match(html, /id="dg-contractor-template"/);
  assert.match(controller, /data-dg-remove-contractor/);
  assert.match(controller, /contentIncluded: false/);
  assert.match(controller, /sourceChecklist: checklistFile/);
  assert.match(controller, /agent: 'coordinator'/);
});

test('il prototipo non dichiara di inviare dati al cloud o avviare la generazione AI', () => {
  assert.match(controller, /cloudSubmission: false/);
  assert.match(controller, /aiGenerationStarted: false/);
  assert.match(html, /il collegamento al cloud, il caricamento effettivo degli allegati e la generazione automatica del Word non sono ancora attivi/i);
  assert.match(html, /La coda cloud non è ancora collegata/);
});

test('il nuovo controller è incluso nell shell precaricata della PWA', () => {
  assert.match(html, /src="js\/document-generation\.js"/);
  assert.match(serviceWorker, /'\.\/js\/document-generation\.js'/);
});
