const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const indice = JSON.parse(fs.readFileSync(path.join(root, 'checklists', 'index.json'), 'utf8')).checklists;
const source = fs.readFileSync(path.join(root, 'js', 'app.js'), 'utf8');
const TIPI = new Set(['testo', 'numero', 'si-no', 'scelta-singola', 'checkbox-multi', 'gruppo-testo']);

function caricaFunzioni() {
  const context = vm.createContext({ String, Array, Object, Map, JSON });
  const inizio = source.indexOf('function checklistIsDvr(');
  const fine = source.indexOf('/** Etichette dei campi anagrafici per tutte le checklist DVR. */');
  vm.runInContext(source.slice(inizio, fine), context);
  const inizio2 = source.indexOf('/** true se una risposta di raccolta-dati è vuota');
  const fine2 = source.indexOf('/** Nome file sicuro per lo ZIP di esportazione DVR. */');
  vm.runInContext(
    'function risposteComeArray(r) { return Array.isArray(r) ? r : Object.values(r || {}); }\n' + source.slice(inizio2, fine2),
    context
  );
  return context;
}

test('index.json: ogni voce ha una categoria e le checklist DVR esistono con la stessa versione', () => {
  for (const voce of indice) {
    assert.ok(['audit', 'dvr'].includes(voce.categoria), `${voce.id}: categoria mancante`);
    assert.equal(voce.categoria === 'dvr', voce.id.startsWith('dvr_'), `${voce.id}: categoria incoerente con l'id`);
  }
  const dvr = indice.filter((v) => v.categoria === 'dvr');
  assert.equal(dvr.length, 7);
  for (const voce of dvr) {
    const cl = JSON.parse(fs.readFileSync(path.join(root, 'checklists', `${voce.id}.json`), 'utf8'));
    assert.equal(cl.id, voce.id);
    assert.equal(cl.versione, voce.versione, `${voce.id}: versione diversa da index.json`);
    assert.equal(cl.stile, 'raccolta-dati');
  }
});

test('checklist DVR: id e codici univoci, codice nel testo, tipi supportati, nessun ":" nel testo', () => {
  for (const voce of indice.filter((v) => v.categoria === 'dvr')) {
    const cl = JSON.parse(fs.readFileSync(path.join(root, 'checklists', `${voce.id}.json`), 'utf8'));
    const ids = new Set();
    const codici = new Set();
    for (const sezione of cl.sezioni) {
      for (const d of sezione.domande) {
        assert.ok(!ids.has(d.id), `${voce.id}: id duplicato ${d.id}`); ids.add(d.id);
        assert.ok(!codici.has(d.codice), `${voce.id}: codice duplicato ${d.codice}`); codici.add(d.codice);
        assert.ok(d.testo.startsWith(`[${d.codice}] `), `${voce.id}: il testo di ${d.codice} non inizia con il codice`);
        assert.ok(!d.testo.includes(':'), `${voce.id}: ":" nel testo di ${d.codice} (rompe la lettura del PDF)`);
        assert.ok(TIPI.has(d.tipo), `${voce.id}: tipo non supportato ${d.tipo}`);
        if (d.tipo === 'scelta-singola') assert.ok(d.opzioni.length >= 2, `${voce.id}: ${d.codice} con meno di 2 opzioni`);
        if (d.tipo === 'checkbox-multi') assert.ok(d.opzioni.length >= 1, `${voce.id}: ${d.codice} senza opzioni`);
        if (d.tipo === 'gruppo-testo') assert.ok(d.campi.length >= 1);
      }
    }
  }
});

test('helper DVR: categoria, codice nascosto a schermo, risposte vuote', () => {
  const f = caricaFunzioni();
  assert.equal(f.checklistIsDvr('dvr_asili'), true);
  assert.equal(f.checklistIsDvr('coin_sopralluogo'), false);
  assert.equal(f.checklistIsDvr(undefined), false);
  assert.equal(f.categoriaChecklist({ id: 'interparking_sopralluogo' }), 'audit');
  assert.equal(f.categoriaChecklist({ id: 'dvr_mmc' }), 'dvr');
  assert.equal(f.testoDomandaSenzaCodice('[E-42] Ambienti di lavoro'), 'Ambienti di lavoro');
  assert.equal(f.testoDomandaSenzaCodice('Domanda senza codice'), 'Domanda senza codice');
  assert.equal(f.rispostaDvrVuota(''), true);
  assert.equal(f.rispostaDvrVuota([]), true);
  assert.equal(f.rispostaDvrVuota({ a: '', b: ' ' }), true);
  assert.equal(f.rispostaDvrVuota({ a: 'x' }), false);
  assert.equal(f.rispostaDvrVuota([{ label: 'X' }]), false);
  assert.equal(f.codiceDomandaDvr({ codice: 'P-4.9.1', testo: '[P-4.9.1] x' }), 'P-4.9.1');
  assert.equal(f.codiceDomandaDvr({ id: 3, testo: '[A02] Testo' }), 'A02');
});

test('statoRaccoltaDvr: conta per sezione, mansioni come voce unica, indici progressivi', () => {
  const f = caricaFunzioni();
  const checklist = { sezioni: [
    { titolo: 'A. Azienda', domande: [{ id: 1, codice: 'A01', testo: '[A01] Dati' }, { id: 2, codice: 'A02', testo: '[A02] Documento' }] },
    { titolo: 'D. Mansioni', domande: [{ id: 3, codice: 'M01', testo: '[M01] Mansione 1' }, { id: 4, codice: 'M02', testo: '[M02] Mansione 2' }] }
  ] };
  const vuoto = f.statoRaccoltaDvr(checklist, { risposte: [{ domanda_id: 1, risposta: { 'Ragione sociale': 'Prova' } }] });
  assert.equal(vuoto.sezioni[0].compilate, 1);
  assert.equal(JSON.stringify(vuoto.mancanti.map((m) => [m.indice, m.testo])), JSON.stringify([[2, 'Nessuna mansione compilata'], [1, 'Documento']]));
  const conMansione = f.statoRaccoltaDvr(checklist, { risposte: [{ domanda_id: 4, risposta: { Nome: 'Cuoco' } }] });
  assert.ok(!conMansione.mancanti.some((m) => m.testo === 'Nessuna mansione compilata'));
});
