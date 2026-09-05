/**
 * Verifica che il merge per-domanda di js/sync.js non perda mai risposte quando due dispositivi
 * compilano lo stesso sopralluogo in concorrenza (nessuna chiamata a Firestore/IndexedDB reale:
 * solo le funzioni pure esposte in sync._test, per non rischiare di toccare dati di produzione).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function caricaSync() {
  const context = {};
  vm.createContext(context);
  vm.runInContext(`${fs.readFileSync('js/sync.js', 'utf8')}\nglobalThis.api = sync;`, context);
  return context.api._test;
}

function risposta(domandaId, valore, aggiornatoIl) {
  return { domanda_id: domandaId, sezione: 'S', risposta: valore, note: null, foto: [], aggiornato_il: aggiornatoIl };
}

test('due dispositivi rispondono a domande diverse (1-10 vs 40-50): nessuna risposta persa nel merge', () => {
  const { unisciRisposte, arrayRisposteInMappa } = caricaSync();

  // "Dispositivo A": ha risposto 1-10 solo in locale, non ancora viste da remoto.
  const localiA = Array.from({ length: 10 }, (_, i) => risposta(`d${i + 1}`, 'C', '2026-09-03T10:00:00.000Z'));

  // "Dispositivo B": ha già sincronizzato le sue risposte 40-50 su Firestore.
  const remoteMappa = arrayRisposteInMappa(
    Array.from({ length: 11 }, (_, i) => risposta(`d${i + 40}`, 'NC', '2026-09-03T10:05:00.000Z'))
  );

  const risultato = unisciRisposte(localiA, remoteMappa, Date.parse('2026-09-03T09:00:00.000Z'), Date.parse('2026-09-03T09:00:00.000Z'));

  assert.equal(risultato.array.length, 21, 'devono esserci tutte e 21 le risposte, nessuna persa');
  const idPresenti = new Set(risultato.array.map((r) => r.domanda_id));
  for (let i = 1; i <= 10; i++) assert.ok(idPresenti.has(`d${i}`), `manca d${i}`);
  for (let i = 40; i <= 50; i++) assert.ok(idPresenti.has(`d${i}`), `manca d${i}`);

  // Le 1-10 (solo locali) vanno scritte su remoto; le 40-50 (già remote) no.
  assert.equal(Object.keys(risultato.daScrivereRemoto).length, 10);
  for (let i = 1; i <= 10; i++) assert.ok(risultato.daScrivereRemoto[`d${i}`], `d${i} deve essere nel batch da scrivere su remoto`);

  // Mancano ancora le 40-50 in locale: il locale va aggiornato.
  assert.equal(risultato.cambiatoLocale, true);
});

test('stessa domanda risposta da entrambi (conflitto): vince la più recente, le altre restano intatte', () => {
  const { unisciRisposte } = caricaSync();

  const locali = [
    risposta('d1', 'C', '2026-09-03T10:00:00.000Z'),
    risposta('d2', 'PC', '2026-09-03T10:00:00.000Z')
  ];
  const remoteMappa = {
    d1: risposta('d1', 'NC', '2026-09-03T10:05:00.000Z'), // più recente: deve vincere sul locale
    d3: risposta('d3', 'C', '2026-09-03T10:01:00.000Z')
  };

  const risultato = unisciRisposte(locali, remoteMappa, 0, 0);
  const perId = Object.fromEntries(risultato.array.map((r) => [r.domanda_id, r]));

  assert.equal(perId.d1.risposta, 'NC', 'd1 deve vincere la versione remota più recente');
  assert.equal(perId.d2.risposta, 'PC', 'd2 (solo locale) non deve essere toccata dal conflitto su d1');
  assert.equal(perId.d3.risposta, 'C', 'd3 (solo remota) deve comunque comparire');
  assert.equal(risultato.array.length, 3);

  assert.equal(risultato.daScrivereRemoto.d1, undefined, 'd1 remoto ha già vinto: non va riscritto');
  assert.ok(risultato.daScrivereRemoto.d2, 'd2 è solo locale: va propagato');
  assert.equal(risultato.cambiatoLocale, true);
});

test('conflitto sulla stessa domanda con il locale più recente: il locale vince e va ripropagato su remoto', () => {
  const { unisciRisposte } = caricaSync();
  const locali = [risposta('d1', 'NC', '2026-09-03T10:10:00.000Z')];
  const remoteMappa = { d1: risposta('d1', 'C', '2026-09-03T10:00:00.000Z') };

  const risultato = unisciRisposte(locali, remoteMappa, 0, 0);
  assert.equal(risultato.array[0].risposta, 'NC');
  assert.ok(risultato.daScrivereRemoto.d1);
  assert.equal(risultato.cambiatoLocale, false, 'il locale ha già la versione vincente, non deve auto-segnalarsi come cambiato');
});

test('unione foto_url: le chiavi (fotoId univoci per dispositivo) non collidono mai, entrambe le mappe si completano a vicenda', () => {
  const { unisciFotoUrl } = caricaSync();
  const locale = { fotoA: { url: 'urlA', path: 'pathA' } };
  const remoto = { fotoB: { url: 'urlB', path: 'pathB' } };
  const risultato = unisciFotoUrl(locale, remoto);
  assert.deepEqual(Object.keys(risultato.mappa).sort(), ['fotoA', 'fotoB']);
  assert.ok(risultato.daScrivereRemoto.fotoA);
  assert.equal(risultato.cambiatoLocale, true);
});

test('scenario end-to-end: un terzo dispositivo che legge il risultato finale vede TUTTE le risposte di A e B, senza perdite', () => {
  const { unisciRisposte, mappaRisposteInArray } = caricaSync();

  // "Firestore", simulato: stato condiviso che i due dispositivi vedono/scrivono.
  const remotoSimulato = {};

  // Dispositivo A risponde 1-10 e sincronizza (scrive le sue voci su "Firestore").
  const rispA = Array.from({ length: 10 }, (_, i) => risposta(`d${i + 1}`, 'C', `2026-09-03T10:00:0${i}.000Z`));
  const mergeA = unisciRisposte(rispA, remotoSimulato, Date.now(), Date.now());
  Object.entries(mergeA.daScrivereRemoto).forEach(([id, r]) => { remotoSimulato[id] = r; });

  // Dispositivo B, quasi in parallelo, risponde 40-50 partendo dallo stesso stato remoto e a sua
  // volta sincronizza (senza aver ancora visto necessariamente le scritture di A, ma su domande
  // disgiunte: nessun conflitto).
  const rispB = Array.from({ length: 11 }, (_, i) => risposta(`d${i + 40}`, 'NC', `2026-09-03T10:00:1${i}.000Z`));
  const mergeB = unisciRisposte(rispB, remotoSimulato, Date.now(), Date.now());
  Object.entries(mergeB.daScrivereRemoto).forEach(([id, r]) => { remotoSimulato[id] = r; });

  // Terzo dispositivo/contesto pulito: legge lo stato finale.
  const lettoDalTerzo = mappaRisposteInArray(remotoSimulato);
  assert.equal(lettoDalTerzo.length, 21, 'il terzo dispositivo deve vedere tutte le 21 risposte, nessuna persa o sovrascritta');
  const idPresenti = new Set(lettoDalTerzo.map((r) => r.domanda_id));
  for (let i = 1; i <= 10; i++) assert.ok(idPresenti.has(`d${i}`));
  for (let i = 40; i <= 50; i++) assert.ok(idPresenti.has(`d${i}`));
});

test('arrayRisposteInMappa: formato Array (locale IndexedDB standard) viene convertito in mappa per domanda_id', () => {
  const { arrayRisposteInMappa } = caricaSync();
  const array = [risposta('d1', 'C', '2026-09-03T10:00:00.000Z'), risposta('d2', 'NC', '2026-09-03T10:01:00.000Z')];
  const mappa = arrayRisposteInMappa(array);
  assert.deepEqual(Object.keys(mappa).sort(), ['d1', 'd2']);
  assert.equal(mappa.d1.risposta, 'C');
  assert.equal(mappa.d2.risposta, 'NC');
});

test('arrayRisposteInMappa: formato Object/mappa legacy (es. record scaricato da Firestore senza conversione) viene accettato preservando le chiavi domanda_id', () => {
  const { arrayRisposteInMappa } = caricaSync();
  const oggettoLegacy = {
    d1: risposta('d1', 'C', '2026-09-03T10:00:00.000Z'),
    d2: risposta('d2', 'PC', '2026-09-03T10:01:00.000Z')
  };
  const mappa = arrayRisposteInMappa(oggettoLegacy);
  assert.deepEqual(Object.keys(mappa).sort(), ['d1', 'd2']);
  assert.equal(mappa.d1.risposta, 'C');
  assert.equal(mappa.d2.risposta, 'PC');
  assert.notEqual(mappa, oggettoLegacy, 'deve essere una copia, non lo stesso oggetto');
});

test('arrayRisposteInMappa: null produce una mappa vuota senza errore', () => {
  const { arrayRisposteInMappa } = caricaSync();
  assert.equal(Object.keys(arrayRisposteInMappa(null)).length, 0);
});

test('arrayRisposteInMappa: undefined produce una mappa vuota senza errore', () => {
  const { arrayRisposteInMappa } = caricaSync();
  assert.equal(Object.keys(arrayRisposteInMappa(undefined)).length, 0);
});

test('arrayRisposteInMappa: un tipo realmente inatteso (stringa/numero) non manda in crash, produce mappa vuota', () => {
  const { arrayRisposteInMappa } = caricaSync();
  assert.equal(Object.keys(arrayRisposteInMappa('formato-corrotto')).length, 0);
  assert.equal(Object.keys(arrayRisposteInMappa(42)).length, 0);
});

test('unisciRisposte non va in eccezione quando il locale ha "risposte" in formato Object legacy (riproduce il crash reale: TypeError forEach is not a function)', () => {
  const { unisciRisposte, arrayRisposteInMappa } = caricaSync();

  // Simula un sopralluogo scaricato da Firestore e salvato in locale senza conversione
  // (db.applicaSopralluogoRemoto): "locale.risposte" è già una mappa, non un Array.
  const localeFormatoLegacy = arrayRisposteInMappa([
    risposta('d1', 'C', '2026-09-03T10:00:00.000Z'),
    risposta('d2', 'NC', '2026-09-03T10:01:00.000Z')
  ]);

  const remoteMappa = { d2: risposta('d2', 'NC', '2026-09-03T10:01:00.000Z'), d3: risposta('d3', 'C', '2026-09-03T10:02:00.000Z') };

  assert.doesNotThrow(() => {
    const risultato = unisciRisposte(localeFormatoLegacy, remoteMappa, 0, 0);
    const idPresenti = new Set(risultato.array.map((r) => r.domanda_id));
    assert.deepEqual([...idPresenti].sort(), ['d1', 'd2', 'd3']);
  });
});

test('estraiMetadati non include mai risposte/foto_url/foto (restano gestiti a parte)', () => {
  const { estraiMetadati } = caricaSync();
  const sopralluogo = {
    id: 's1',
    punto_vendita: 'Test',
    aggiornato_il: '2026-09-03T10:00:00.000Z',
    risposte: [risposta('d1', 'C', '2026-09-03T10:00:00.000Z')],
    foto_url: { fotoA: { url: 'u', path: 'p' } },
    foto: [{ id: 'x' }]
  };
  const metadati = estraiMetadati(sopralluogo);
  assert.equal(metadati.punto_vendita, 'Test');
  assert.equal('risposte' in metadati, false);
  assert.equal('foto_url' in metadati, false);
  assert.equal('foto' in metadati, false);
});
