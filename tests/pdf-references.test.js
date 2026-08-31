const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function caricaPdf(fotoPresenti = {}) {
  const context = {
    console,
    db: { leggiFoto: async (id) => fotoPresenti[id] },
    window: {}, navigator: {}, URL: {}, File: function File() {}, Blob,
    fetch: async () => ({ ok: false })
  };
  vm.createContext(context);
  const source = fs.readFileSync('js/pdf.js', 'utf8');
  vm.runInContext(`${source}\nglobalThis.pdfPerTest = pdf;`, context);
  return context.pdfPerTest._test;
}

const checklist = {
  sezioni: [{ titolo: 'Sezione', domande: [
    { id: 51, testo: 'Testo domanda 51' },
    { id: 52, testo: 'Testo domanda 52' }
  ] }]
};

test('PDF mantiene il formato storico con un tecnico', () => {
  assert.equal(caricaPdf().formattaTecnici({ tecnico: 'Mario Rossi' }), 'Mario Rossi');
});

test('PDF mostra due tecnici su righe ordinate', () => {
  assert.equal(caricaPdf().formattaTecnici({ tecnico: 'Mario Rossi', tecnico_2: 'Anna Verdi' }), 'Mario Rossi\nAnna Verdi');
});

test('una foto collegata produce riferimenti PDF coerenti', () => {
  const api = caricaPdf();
  const raccolta = api.raccogliFotoConDidascalia(checklist, {
    risposte: [{ domanda_id: 51, foto: ['a'] }]
  });
  const mappa = api.costruisciMappaFotoPerDomanda(raccolta.fotoDomande);
  assert.equal(api.suffissoVediFoto(51, mappa), 'Vedi Foto 1');
  assert.equal(raccolta.fotoDomande[0].domandaId, 51);
});

test('più foto sulla stessa domanda mantengono la stessa numerazione', () => {
  const api = caricaPdf();
  const raccolta = api.raccogliFotoConDidascalia(checklist, {
    risposte: [{ domanda_id: 51, foto: ['a', 'b'] }]
  });
  const mappa = api.costruisciMappaFotoPerDomanda(raccolta.fotoDomande);
  assert.equal(api.suffissoVediFoto(51, mappa), 'Vedi Foto 1, Foto 2');
});

test('foto su domande differenti hanno riferimenti e didascalie corrispondenti', () => {
  const api = caricaPdf();
  const raccolta = api.raccogliFotoConDidascalia(checklist, {
    risposte: [{ domanda_id: 51, foto: ['a'] }, { domanda_id: 52, foto: ['b'] }]
  });
  const mappa = api.costruisciMappaFotoPerDomanda(raccolta.fotoDomande);
  assert.equal(api.suffissoVediFoto(51, mappa), 'Vedi Foto 1');
  assert.equal(api.suffissoVediFoto(52, mappa), 'Vedi Foto 2');
  assert.deepEqual(Array.from(raccolta.fotoDomande, (f, i) => `Foto ${i + 1} — Domanda ${f.domandaId}`),
    ['Foto 1 — Domanda 51', 'Foto 2 — Domanda 52']);
});

test('eliminazione e riordino rinumerano solo le foto esistenti', async () => {
  const api = caricaPdf({ b: { id: 'b', blob: new Blob() }, c: { id: 'c', blob: new Blob() } });
  const valide = await api.filtraFotoEsistenti([
    { fotoId: 'mancante', domandaId: 51 },
    { fotoId: 'c', domandaId: 52 },
    { fotoId: 'b', domandaId: 51 }
  ]);
  const mappa = api.costruisciMappaFotoPerDomanda(valide);
  assert.equal(api.suffissoVediFoto(52, mappa), 'Vedi Foto 1');
  assert.equal(api.suffissoVediFoto(51, mappa), 'Vedi Foto 2');
});

test('note aggiuntive e relativi allegati restano separati dalle Foto numerate', () => {
  const api = caricaPdf();
  const raccolta = api.raccogliFotoConDidascalia(checklist, {
    altri_aspetti: 'Nota finale invariata',
    altri_aspetti_foto: ['extra'],
    risposte: [{ domanda_id: 51, foto: ['a'] }]
  });
  assert.equal(raccolta.fotoDomande.length, 1);
  assert.deepEqual(Array.from(raccolta.allegatiNote, (f) => f.fotoId), ['extra']);
});
