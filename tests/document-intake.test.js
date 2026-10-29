// Test del motore di acquisizione documentale (js/document-intake.js) con file sintetici.
// PDF e interfaccia sono coperti da tests/document-intake-browser-smoke.cjs.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const JSZip = require('../js/vendor/jszip.min.js');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'js', 'document-intake.js'), 'utf8');
const context = { console, TextDecoder, Uint8Array, Date };
vm.createContext(context);
vm.runInContext(source + '\nglobalThis.documentIntakePerTest = documentIntake;', context);
const intake = context.documentIntakePerTest;
const deps = { JSZip, crypto: require('node:crypto').webcrypto, pdfjsLib: null };

let serial = 0;
async function analyze(name, bytes) {
  serial += 1;
  return intake.analyzeFile({ id: 'f' + serial, name, bytes }, deps);
}
const text = (s) => new TextEncoder().encode(s);

function partitaIva(first10) {
  for (let check = 0; check < 10; check++) if (intake.validPartitaIva(first10 + check)) return first10 + check;
  throw new Error('nessuna cifra di controllo');
}

async function docx(paragraphsXml) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<Types/>');
  zip.file('word/document.xml', '<w:document xmlns:w="w"><w:body>' + paragraphsXml + '<w:sectPr/></w:body></w:document>');
  return zip.generateAsync({ type: 'uint8array' });
}
const p = (t) => '<w:p><w:r><w:t xml:space="preserve">' + t + '</w:t></w:r></w:p>';

async function xlsx() {
  const zip = new JSZip();
  zip.file('xl/workbook.xml', '<workbook><sheets><sheet name="Dati lavoro" sheetId="1" r:id="rId1"/></sheets></workbook>');
  zip.file('xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>');
  zip.file('xl/sharedStrings.xml', '<sst><si><t>Committente</t></si><si><t>Alfa S.r.l.</t></si><si><t>Data inizio lavori</t></si></sst>');
  zip.file('xl/worksheets/sheet1.xml',
    '<worksheet><sheetData>' +
    '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" s="2"/><c r="C1" t="s"><v>1</v></c></row>' +
    '<row r="2"/>' +
    '<row r="3"><c r="A3" t="s"><v>2</v></c><c r="B3" t="inlineStr"><is><t>03/02/2027</t></is></c></row>' +
    '</sheetData></worksheet>');
  return zip.generateAsync({ type: 'uint8array' });
}

test('classificazione automatica da nome e contenuto, con evidenze', async () => {
  assert.equal(intake.classify('Cronoprogramma_lavori_2027.xlsx', [], 'xlsx').category, 'cronoprogrammi');
  assert.equal(intake.classify('Cronoprogramma_lavori_2027.xlsx', [], 'xlsx').confidence, 'alta');
  const sds = intake.classify('documento-17.pdf', [{ text: 'SCHEDA DATI DI SICUREZZA ai sensi del Regolamento (CE) 1907/2006 (REACH)' }], 'pdf');
  assert.equal(sds.category, 'sds');
  assert.ok(sds.evidence.some((e) => e.startsWith('testo:')));
  assert.equal(intake.classify('Planimetria piano terra.jpg', [], 'image').category, 'planimetrie-layout');
  assert.equal(intake.classify('IMG_0042.jpg', [], 'image').category, 'foto-sito');
  const unknown = intake.classify('scan001.pdf', [{ text: 'testo generico senza indizi' }], 'pdf');
  assert.equal(unknown.category, 'altri-allegati');
  assert.equal(unknown.confidence, 'bassa');
});

test('DOCX: valori in celle separate con fonte, codici di campo esclusi', async () => {
  const bytes = await docx(
    p('Committente') + p('Alfa S.r.l.') +
    '<w:p><w:r><w:instrText>TOC \\o "1-3"</w:instrText></w:r><w:r><w:t>Preposto: Mario Rossi</w:t></w:r></w:p>' +
    p('Luogo dei lavori: Via Esempio 1, Bologna'));
  const result = await analyze('Contratto appalto.docx', bytes);
  assert.equal(result.file.format, 'docx');
  assert.equal(result.file.readStatus, 'letto');
  assert.equal(result.file.category, 'contratto-capitolato');
  const byField = Object.fromEntries(result.facts.map((f) => [f.field, f]));
  assert.equal(byField.committente.value, 'Alfa S.r.l.');
  assert.equal(byField.committente.source.location, 'paragrafo 2');
  assert.equal(byField.committente.source.file, 'Contratto appalto.docx');
  assert.equal(byField.preposto.value, 'Mario Rossi', 'il testo di w:instrText non entra nel valore');
  assert.equal(byField.sede.value, 'Via Esempio 1, Bologna');
});

test('XLSX: stringhe condivise, celle inline e vuote, riferimento al foglio', async () => {
  const result = await analyze('dati.xlsx', await xlsx());
  const committente = result.facts.find((f) => f.field === 'committente');
  assert.equal(committente.value, 'Alfa S.r.l.');
  assert.equal(committente.source.location, 'foglio “Dati lavoro”, riga 1');
  const start = result.facts.find((f) => f.field === 'data_inizio');
  assert.equal(start.value, '2027-02-03');
});

test('conflitti solo per valori realmente diversi, con tutte le fonti', async () => {
  const a = await analyze('a.txt', text('Committente: Alfa S.r.l.\nData inizio lavori: 01/03/2027'));
  const b = await analyze('b.txt', text('COMMITTENTE: ALFA SRL'));
  const c = await analyze('c.txt', text('Committente: Beta S.p.A.'));
  const same = intake.consolidate('duvri', [a, b]);
  assert.equal(same.fields.committente.status, 'extracted_unconfirmed');
  assert.equal(same.fields.committente.values[0].sources.length, 2);
  assert.ok(!same.issues.some((i) => i.type === 'conflict'));
  const diff = intake.consolidate('duvri', [a, b, c]);
  assert.equal(diff.fields.committente.status, 'conflicting');
  const conflict = diff.issues.find((i) => i.type === 'conflict');
  assert.deepEqual(Array.from(conflict.sources, (s) => s.file).sort(), ['a.txt', 'b.txt', 'c.txt']);
});

test('segnala solo i dati indispensabili mancanti, senza inventarli', async () => {
  const a = await analyze('a.txt', text('Committente: Alfa S.r.l.\nImpresa appaltatrice: Gamma S.r.l.'));
  const report = intake.consolidate('duvri', [a]);
  const missing = Array.from(report.issues.filter((i) => i.type === 'missing'), (i) => i.field);
  assert.deepEqual(missing, ['preposto', 'sede', 'oggetto_appalto', 'data_inizio', 'data_fine', 'titolo']);
  assert.match(report.issues.find((i) => i.field === 'titolo').message, /stabilito da Colligo/);
  assert.equal(Object.keys(report.fields).sort().join(), 'appaltatore,committente');
});

test('anomalie: partita IVA, date, formato, duplicati e file non leggibili', async () => {
  const valid = partitaIva('0123456789');
  const invalid = valid.slice(0, 10) + ((Number(valid[10]) + 1) % 10);
  const iva = await analyze('iva.txt', text('Impresa appaltatrice: Gamma S.r.l. P.IVA ' + valid + '\nAltra ditta P.IVA ' + invalid));
  assert.equal(iva.facts.find((f) => f.field === 'appaltatore').value, 'Gamma S.r.l.', 'la P.IVA non entra nel nome');
  const ivaIssues = iva.issues.filter((i) => i.field === 'partita_iva');
  assert.equal(ivaIssues.length, 1);
  assert.match(ivaIssues[0].message, new RegExp(invalid));

  const dates = await analyze('date.txt', text('Data inizio lavori: 10/05/2027\nData fine lavori: 01/05/2027\nTermine lavori: entro maggio'));
  const report = intake.consolidate('duvri', [dates]);
  assert.ok(report.issues.some((i) => /precede la data di inizio/.test(i.message)));
  assert.ok(dates.issues.some((i) => /data non interpretabile/.test(i.message)));

  const fake = await analyze('finto.pdf', text('PK\u0003\u0004 non un pdf'));
  assert.equal(fake.file.readStatus, 'non_letto');
  assert.ok(fake.issues.some((i) => /estensione non corrisponde/.test(i.message)));
  const legacy = await analyze('vecchio.doc', text('binario'));
  assert.equal(legacy.file.readStatus, 'non_supportato');
  const broken = await analyze('rotto.docx', text('PK rotto'));
  assert.equal(broken.file.readStatus, 'errore');

  const copy1 = await analyze('uno.txt', text('stesso contenuto'));
  const copy2 = await analyze('due.txt', text('stesso contenuto'));
  assert.ok(intake.consolidate('duvri', [copy1, copy2]).issues.some((i) => /contenuto identico/.test(i.message)));
});

test('modello Word: impronta e struttura verificate, generazione bloccata dalle decisioni aperte', async () => {
  const fakeTemplate = await docx(p('TITOLO DEL DUVRI'));
  const report = await intake.inspectTemplate(fakeTemplate, 'duvri', deps);
  assert.equal(report.controlled, false);
  assert.ok(report.differences.some((d) => /SHA-256/.test(d)));
  assert.equal(report.counts.tables, 0);
  const analysis = intake.consolidate('duvri', [await analyze('a.txt', text('Committente: Alfa'))]);
  const gate = intake.generationGate('duvri', report, analysis);
  assert.equal(gate.allowed, false);
  assert.ok(gate.reasons.some((r) => r.startsWith('DUVRI-SCALA')));
  assert.ok(gate.reasons.some((r) => /non è la copia controllata/.test(r)));

  // Anche un modello conforme non sblocca la generazione finché il blocco DUVRI-SCALA è aperto.
  const ideal = intake.generationGate('duvri', { controlled: true, differences: [] }, { files: [{}], issues: [] });
  assert.deepEqual(Array.from(ideal.reasons, (r) => r.split(':')[0]), ['DUVRI-SCALA']);
  const coin = intake.generationGate('informativa-coin', null, null);
  assert.ok(coin.reasons.some((r) => r.startsWith('INFO-MODELLO')));
  assert.ok(coin.reasons.includes('Modello ufficiale non registrato.'));
});

test('registro estendibile: ogni tipo dichiara campi, modello e blocchi', () => {
  for (const [id, type] of Object.entries(intake.DOCUMENT_TYPES)) {
    assert.ok(type.label && Array.isArray(type.required) && Array.isArray(type.blocks), id);
    for (const key of type.required) assert.ok(intake.FIELDS[key] || type.manualOnly[key], id + ': ' + key);
  }
  assert.equal(intake.DOCUMENT_TYPES.duvri.template.sha256.length, 64);
});

test('il motore e la sua interfaccia non usano rete, AI o HTML dai contenuti', () => {
  const ui = fs.readFileSync(path.join(root, 'js', 'document-intake-ui.js'), 'utf8');
  for (const [name, code] of [['motore', source], ['interfaccia', ui]]) {
    assert.doesNotMatch(code, /\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|EventSource|\.innerHTML\s*=|insertAdjacentHTML|eval\s*\(|new Function/, name);
  }
  assert.match(source, /isEvalSupported: false/);
});

test('la schermata, lo script e la shell offline includono il nuovo modulo', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const sw = fs.readFileSync(path.join(root, 'service-worker.js'), 'utf8');
  for (const file of ['js/document-intake.js', 'js/document-intake-ui.js']) {
    assert.match(html, new RegExp('<script src="' + file.replace('.', '\\.') + '"></script>'));
    assert.ok(sw.includes("'./" + file + "'"), file);
  }
  assert.ok(html.indexOf('js/document-intake.js') < html.indexOf('js/document-intake-ui.js'));
  for (const id of ['dg-auto-type', 'dg-auto-files', 'dg-auto-results', 'dg-auto-issues', 'dg-auto-fields', 'dg-auto-files-list', 'dg-template-file', 'dg-template-status', 'dg-generate-state', 'dg-generate-reasons', 'dg-auto-download', 'dg-auto-clear']) {
    assert.match(html, new RegExp('id="' + id + '"'), id);
  }
  assert.match(html, /<input id="dg-auto-files" type="file" multiple>/, 'nessuna categoria da scegliere a mano');
});
