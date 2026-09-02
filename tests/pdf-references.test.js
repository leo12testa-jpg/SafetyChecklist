const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function caricaPdf(fotoPresenti = {}) {
  class FileReaderFinto {
    readAsDataURL() {
      this.result = 'data:image/jpeg;base64,AA==';
      queueMicrotask(() => this.onload());
    }
  }
  const context = {
    console,
    fotoSync: { risolviFoto: async (id) => fotoPresenti[id] || null },
    window: {}, navigator: {}, URL: {}, File: function File() {}, Blob,
    fetch: async () => ({ ok: false }),
    FileReader: FileReaderFinto,
    queueMicrotask
  };
  vm.createContext(context);
  const source = fs.readFileSync('js/pdf.js', 'utf8');
  vm.runInContext(`${source}\nglobalThis.pdfPerTest = pdf;`, context);
  return context.pdfPerTest._test;
}

function creaDocumentoTracciato(eventi) {
  return {
    internal: { pageSize: { getHeight: () => 297 } },
    addPage() { eventi.push('addPage'); },
    text(testo) {
      const valore = Array.isArray(testo) ? testo.join(' ') : testo;
      eventi.push(`text:${valore}`);
    },
    addImage() { eventi.push('addImage'); },
    setFontSize() {},
    setFont() {},
    splitTextToSize(testo) { return [String(testo)]; },
    getImageProperties() { return { width: 100, height: 75, fileType: 'JPEG' }; }
  };
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

test('ordine fisico jsPDF: ultima domanda, fotografie complete, poi altri aspetti', async () => {
  const api = caricaPdf();
  const eventi = ['text:ULTIMA DOMANDA'];
  const doc = creaDocumentoTracciato(eventi);
  const record = { blob: new Blob(['foto'], { type: 'image/jpeg' }) };

  await api.disegnaSezioniFinali(
    doc,
    { altri_aspetti: 'Testo finale' },
    [
      { fotoId: 'a', domandaId: 51, domandaTesto: 'Domanda 51', record },
      { fotoId: 'b', domandaId: 63, domandaTesto: 'Domanda 63', record }
    ],
    [{ fotoId: 'extra', altriAspetti: true, record }]
  );

  assert.deepEqual(eventi, [
    'text:ULTIMA DOMANDA',
    'addPage',
    'text:ALLEGATI — FOTOGRAFIE',
    'addImage',
    'text:Foto 1 — Domanda 51: Domanda 51',
    'addImage',
    'text:Foto 2 — Domanda 63: Domanda 63',
    'addPage',
    'text:ALTRI ASPETTI DA EVIDENZIARE',
    'text:Testo finale',
    'addImage'
  ]);
});

test('sezioni finali omettono pagine vuote nei casi particolari', async () => {
  const api = caricaPdf();
  const record = { blob: new Blob(['foto'], { type: 'image/jpeg' }) };

  const soloAltri = [];
  await api.disegnaSezioniFinali(
    creaDocumentoTracciato(soloAltri),
    { altri_aspetti: 'Solo testo finale' },
    [],
    []
  );
  assert.deepEqual(soloAltri, [
    'addPage',
    'text:ALTRI ASPETTI DA EVIDENZIARE',
    'text:Solo testo finale'
  ]);

  const nessunaSezione = [];
  await api.disegnaSezioniFinali(creaDocumentoTracciato(nessunaSezione), {}, [], []);
  assert.deepEqual(nessunaSezione, []);

  const soloFotoFinale = [];
  await api.disegnaSezioniFinali(
    creaDocumentoTracciato(soloFotoFinale),
    {},
    [],
    [{ fotoId: 'extra', altriAspetti: true, record }]
  );
  assert.deepEqual(soloFotoFinale, [
    'addPage',
    'text:ALTRI ASPETTI DA EVIDENZIARE',
    'addImage'
  ]);
});

test('tutte le pagine fotografiche terminano prima della pagina altri aspetti', async () => {
  const api = caricaPdf();
  const eventi = [];
  const record = { blob: new Blob(['foto'], { type: 'image/jpeg' }) };
  const molteFoto = Array.from({ length: 6 }, (_, indice) => ({
    fotoId: `foto-${indice + 1}`,
    domandaId: indice + 1,
    domandaTesto: `Domanda ${indice + 1}`,
    record
  }));

  await api.disegnaSezioniFinali(
    creaDocumentoTracciato(eventi),
    { altri_aspetti: 'Dopo tutte le fotografie' },
    molteFoto,
    []
  );

  const indiceTitoloFinale = eventi.indexOf('text:ALTRI ASPETTI DA EVIDENZIARE');
  const immaginiPrimaDelTitolo = eventi.slice(0, indiceTitoloFinale).filter((e) => e === 'addImage');
  const immaginiDopoIlTitolo = eventi.slice(indiceTitoloFinale + 1).filter((e) => e === 'addImage');
  assert.equal(immaginiPrimaDelTitolo.length, 6);
  assert.equal(immaginiDopoIlTitolo.length, 0);
  assert.equal(eventi[indiceTitoloFinale - 1], 'addPage');
  assert.ok(eventi.includes('text:ALLEGATI — FOTOGRAFIE (segue)'));
});
