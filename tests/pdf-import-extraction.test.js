/**
 * Test dell'estrazione di righe grezze da js/pdf-import.js: array di elementi testo con
 * coordinate x/y costruiti a mano, come li produrrebbe pdf.js#getTextContent per i due formati
 * supportati ("nostro" e "storico"). Nessun PDF vero qui (vedi lo script di verifica manuale con
 * PDF reali per quello) — l'obiettivo è una rete di sicurezza veloce e deterministica sulla sola
 * logica di posizionamento/raggruppamento, indipendente dal motore di abbinamento
 * (tests/import-matching.test.js) e dalla lettura PDF reale. Le colonne sono deliberatamente
 * molto distanziate (zone da decine di punti l'una dall'altra) per restare ben dentro le
 * tolleranze/i confini usati dal codice reale, senza dover replicare le coordinate esatte di
 * jsPDF: qui si verifica la LOGICA di assegnazione, non un layout pixel-perfect.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function caricaPdfImport() {
  const context = { console, pdfjsLib: { GlobalWorkerOptions: {} } };
  vm.createContext(context);
  const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'pdf-import.js'), 'utf8');
  vm.runInContext(`${source}\nglobalThis.pdfImportPerTest = pdfImport;`, context);
  return context.pdfImportPerTest;
}

function it(testo, x, y, w = testo.length * 4) {
  return { testo, x, y, w };
}

/**
 * Dispone una sequenza di parole sulla stessa riga (y) con un varco orizzontale abbondante fra
 * l'una e l'altra (ben oltre TOLLERANZA_FRAMMENTO_ADIACENTE_PT=1.2pt del formato storico): senza
 * questo margine pdf-import.js le tratterebbe come un'unica parola spezzata senza spazio,
 * comportamento corretto sul PDF reale ma non quello voluto per queste righe di prova.
 */
function sequenzaParole(parole, xIniziale, y, gap = 4) {
  let x = xIniziale;
  return parole.map((parola) => {
    const elemento = it(parola, x, y);
    x += elemento.w + gap;
    return elemento;
  });
}

// ---------------------------------------------------------------------------------------------
// Formato "nostro" — colonne: id=20, descrizione a partire da 40, stato C=300/PC=315/NC=330/NP=345, note=400.
// ---------------------------------------------------------------------------------------------

function paginaNostro() {
  return [
    it('DATI GENERALI', 20, 280),
    it('ADEMPIMENTI FORMALI', 20, 205),
    it('n.', 20, 200),
    it('Descrizione attività', 40, 200),
    it('C', 300, 200),
    it('P.C', 315, 200),
    it('N.C', 330, 200),
    it('N.P', 345, 200),
    it('Note', 400, 200),

    it('1', 20, 190),
    ...sequenzaParole(['Nomina', 'del', 'RSPP'], 40, 190),
    it('X', 300, 190), // colonna C
    ...sequenzaParole(['Nota', 'breve'], 400, 190),

    it('2', 20, 175),
    ...sequenzaParole(['Nomina', 'del', 'RLS'], 40, 175),
    it('X', 330, 175) // colonna N.C
  ];
}

test('formato nostro: id/testo/stato/nota/sezione estratti correttamente per ogni riga', () => {
  const pdfImportPerTest = caricaPdfImport();
  const { righe, strutturaRiconosciuta } = pdfImportPerTest._test.provaFormatoNostro([paginaNostro()]);

  assert.equal(strutturaRiconosciuta, true);
  assert.equal(righe.length, 2);

  const riga1 = righe.find((r) => r.id_originale === 1);
  assert.equal(riga1.formato, 'nostro');
  assert.equal(riga1.numero_originale, 1);
  assert.equal(riga1.testo_originale, 'Nomina del RSPP');
  assert.equal(riga1.stato_originale, 'C');
  assert.equal(riga1.nota_originale, 'Nota breve');
  assert.equal(riga1.sezione_originale, 'ADEMPIMENTI FORMALI');

  const riga2 = righe.find((r) => r.id_originale === 2);
  assert.equal(riga2.testo_originale, 'Nomina del RLS');
  assert.equal(riga2.stato_originale, 'NC');
  assert.equal(riga2.nota_originale, null);
  assert.equal(riga2.sezione_originale, 'ADEMPIMENTI FORMALI');
});

test('formato nostro: 0 o 2+ marcature sulla stessa riga lasciano stato_originale a null (mai indovinato)', () => {
  const pdfImportPerTest = caricaPdfImport();
  const pagina = paginaNostro();
  // aggiunge una seconda "X" sulla riga 1 (colonna P.C), oltre a quella già presente in C: ambiguo.
  pagina.push(it('X', 315, 190));
  const { righe } = pdfImportPerTest._test.provaFormatoNostro([pagina]);
  const riga1 = righe.find((r) => r.id_originale === 1);
  assert.equal(riga1.stato_originale, null);
});

test('formato nostro: titolo di sezione ereditato dalla pagina precedente se la tabella prosegue senza ripeterlo', () => {
  const pdfImportPerTest = caricaPdfImport();
  const pagina1 = paginaNostro();
  const pagina2 = [
    // stessa intestazione colonne (si ripete a ogni pagina), ma NESSUN titolo di sezione sopra:
    // la tabella "ADEMPIMENTI FORMALI" prosegue dalla pagina precedente.
    it('n.', 20, 280),
    it('Descrizione attività', 40, 280),
    it('C', 300, 280),
    it('P.C', 315, 280),
    it('N.C', 330, 280),
    it('N.P', 345, 280),
    it('Note', 400, 280),
    it('3', 20, 260),
    ...sequenzaParole(['Terza', 'domanda'], 40, 260),
    it('X', 300, 260)
  ];
  const { righe } = pdfImportPerTest._test.provaFormatoNostro([pagina1, pagina2]);
  const riga3 = righe.find((r) => r.id_originale === 3);
  assert.equal(riga3.sezione_originale, 'ADEMPIMENTI FORMALI');
});

// ---------------------------------------------------------------------------------------------
// Formato "storico" — id "N)" attorno a x=32, descrizione da x=60, stato C=300/PC=320/NC=340/NA=360, note=420.
// ---------------------------------------------------------------------------------------------

function paginaStorico({ quartaColonna = 'NA' } = {}) {
  return [
    it('AUDIT DOCUMENTALE', 20, 260),
    it('C', 300, 245),
    it('PC', 320, 245),
    it('NC', 340, 245),
    it(quartaColonna, 360, 245),
    it('NOTE', 420, 245),

    it('1)', 32, 230),
    ...sequenzaParole(['Nomina', 'del', 'RSPP'], 60, 230),
    it('X', 300, 230),
    ...sequenzaParole(['Nota', 'storica'], 420, 230),

    it('2)', 32, 210),
    ...sequenzaParole(['Nomina', 'del', 'RLS'], 60, 210),
    it('X', 340, 210)
  ];
}

test('formato storico: numero locale/testo/stato/nota/sezione estratti, nessun id (non disponibile in questo formato)', () => {
  const pdfImportPerTest = caricaPdfImport();
  const { righe, strutturaRiconosciuta } = pdfImportPerTest._test.provaFormatoStorico([paginaStorico()]);

  assert.equal(strutturaRiconosciuta, true);
  assert.equal(righe.length, 2);

  const riga1 = righe.find((r) => r.numero_originale === 1);
  assert.equal(riga1.formato, 'storico');
  assert.equal(riga1.id_originale, null);
  assert.equal(riga1.testo_originale, 'Nomina del RSPP');
  assert.equal(riga1.stato_originale, 'C');
  assert.equal(riga1.nota_originale, 'Nota storica');
  assert.equal(riga1.sezione_originale, 'AUDIT DOCUMENTALE');

  const riga2 = righe.find((r) => r.numero_originale === 2);
  assert.equal(riga2.testo_originale, 'Nomina del RLS');
  assert.equal(riga2.stato_originale, 'NC');
});

test('formato storico: numerazione riparte da 1 al cambio di macro-sezione', () => {
  const pdfImportPerTest = caricaPdfImport();
  const pagina = paginaStorico();
  pagina.push(
    it('SOPRALLUOGO AMBIENTI DI LAVORO', 20, 190),
    it('C', 300, 175), it('PC', 320, 175), it('NC', 340, 175), it('NA', 360, 175), it('NOTE', 420, 175),
    it('1)', 32, 160), ...sequenzaParole(['Estintori', 'presenti'], 60, 160), it('X', 300, 160)
  );
  const { righe } = pdfImportPerTest._test.provaFormatoStorico([pagina]);
  const righeNumero1 = righe.filter((r) => r.numero_originale === 1);
  assert.equal(righeNumero1.length, 2); // una per ciascuna macro-sezione
  assert.equal(righeNumero1[0].sezione_originale, 'AUDIT DOCUMENTALE');
  assert.equal(righeNumero1[1].sezione_originale, 'SOPRALLUOGO AMBIENTI DI LAVORO');
});

test('formato storico: quarta colonna etichettata "NP" invece di "NA" viene comunque riconosciuta e segnalata', () => {
  const pdfImportPerTest = caricaPdfImport();
  const pagina = paginaStorico({ quartaColonna: 'NP' });
  // sposta la marcatura della seconda domanda sulla quarta colonna, per verificare che venga letta come "NA" (codice interno).
  const conMarcaturaNP = pagina.filter((el) => !(el.testo === 'X' && el.x === 340));
  conMarcaturaNP.push(it('X', 360, 210));
  const { righe, strutturaRiconosciuta } = pdfImportPerTest._test.provaFormatoStorico([conMarcaturaNP]);
  assert.equal(strutturaRiconosciuta, true);
  const riga2 = righe.find((r) => r.numero_originale === 2);
  assert.equal(riga2.stato_originale, 'NA'); // sempre il codice interno, mai "NP"
});

test('provaFormatoStorico espone la conversione rilevata (NP letto -> NA applicato)', () => {
  const pdfImportPerTest = caricaPdfImport();
  const pagina = paginaStorico({ quartaColonna: 'NP' });
  const risultato = pdfImportPerTest._test.provaFormatoStorico([pagina]);
  assert.equal(risultato.conversioneStatoRilevata.letta, 'NP');
  assert.equal(risultato.conversioneStatoRilevata.applicata, 'NA');
});

test('nessuna struttura riconosciuta (PDF estraneo): strutturaRiconosciuta false per entrambi i formati, nessuna riga', () => {
  const pdfImportPerTest = caricaPdfImport();
  const paginaEstranea = [it('Fattura', 20, 280), it('Totale', 20, 250), it('100,00 €', 90, 250)];
  const risultatoNostro = pdfImportPerTest._test.provaFormatoNostro([paginaEstranea]);
  const risultatoStorico = pdfImportPerTest._test.provaFormatoStorico([paginaEstranea]);
  assert.equal(risultatoNostro.strutturaRiconosciuta, false);
  assert.equal(risultatoNostro.righe.length, 0);
  assert.equal(risultatoStorico.strutturaRiconosciuta, false);
  assert.equal(risultatoStorico.righe.length, 0);
});
