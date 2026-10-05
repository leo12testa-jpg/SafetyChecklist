/**
 * Test del motore di abbinamento per l'importazione da PDF (js/import-matching.js). Nessuna
 * estrazione PDF qui: righe grezze costruite a mano, come le produrrebbe js/pdf-import.js, per
 * isolare la logica di matching dalla lettura del file (vedi tests/pdf-import-extraction.test.js
 * per quella parte, e lo script di verifica manuale con PDF reali per l'integrazione end-to-end).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function caricaImportMatching() {
  const context = { console };
  vm.createContext(context);
  const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'import-matching.js'), 'utf8');
  vm.runInContext(`${source}\nglobalThis.importMatchingPerTest = importMatching;`, context);
  return context.importMatchingPerTest;
}

const CHECKLIST_BASE = {
  id: 'test_sopralluogo',
  titolo: 'Test - Sopralluogo',
  sezioni: [
    {
      titolo: 'ADEMPIMENTI FORMALI',
      domande: [
        { id: 1, testo: 'Nomina del RSPP: è presente una copia in archivio?' },
        { id: 2, testo: 'Nomina del RLS: è presente nomina formale in archivio?' },
        { id: 3, testo: 'È stato formato il RLS? Indicare nome e data di elezione' }
      ]
    },
    {
      titolo: 'ANTINCENDIO',
      domande: [
        { id: 4, testo: 'Gli estintori sono mantenuti accessibili e visibili?' },
        { id: 5, testo: 'Gli idranti sono mantenuti accessibili e visibili?' },
        { id: 6, testo: 'Le porte tagliafuoco sono mantenute in buono stato di conservazione?' }
      ]
    }
  ]
};

function clonaChecklist(override) {
  const clone = JSON.parse(JSON.stringify(CHECKLIST_BASE));
  return override ? override(clone) : clone;
}

function rigaNostro({ id, testo, stato = 'C', nota = null, sezione = null }) {
  return {
    formato: 'nostro',
    id_originale: id,
    numero_originale: id,
    sezione_originale: sezione,
    testo_originale: testo,
    stato_originale: stato,
    nota_originale: nota
  };
}

function rigaStorico({ numero, sezione, testo, stato = 'C', nota = null }) {
  return {
    formato: 'storico',
    id_originale: null,
    numero_originale: numero,
    sezione_originale: sezione,
    testo_originale: testo,
    stato_originale: stato,
    nota_originale: nota
  };
}

// ---------------------------------------------------------------------------------------------
// Metodo 1: id stabile
// ---------------------------------------------------------------------------------------------

test('id stabile e testo invariato: abbinamento automatico al 100%', () => {
  const im = caricaImportMatching();
  const checklist = clonaChecklist();
  const righe = [rigaNostro({ id: 4, testo: 'Gli estintori sono mantenuti accessibili e visibili?', stato: 'NC' })];
  const { righe: risultato } = im.abbinaRighe(righe, checklist);
  assert.equal(risultato[0].domanda_id, 4);
  assert.equal(risultato[0].metodo, 'id');
  assert.equal(risultato[0].confidenza, 1);
  assert.equal(risultato[0].stato_riga, 'sicuro');
  assert.equal(risultato[0].risposta, 'NC');
});

test('id stabile ma testo leggermente diverso (piccola modifica): resta automatico, la somiglianza rimane alta', () => {
  const im = caricaImportMatching();
  const checklist = clonaChecklist();
  // riformulazione minima della domanda 4, stesse parole chiave
  const righe = [rigaNostro({ id: 4, testo: 'Gli estintori sono accessibili e ben visibili?' })];
  const { righe: risultato } = im.abbinaRighe(righe, checklist);
  assert.equal(risultato[0].domanda_id, 4);
  assert.equal(risultato[0].stato_riga, 'sicuro');
});

test('id stabile ma testo MOLTO diverso (domanda probabilmente cambiata): NON automatico, va verificato', () => {
  const im = caricaImportMatching();
  const checklist = clonaChecklist();
  const righe = [rigaNostro({ id: 4, testo: 'Sono presenti i defibrillatori semiautomatici nei locali comuni?' })];
  const { righe: risultato } = im.abbinaRighe(righe, checklist);
  assert.equal(risultato[0].domanda_id, 4);
  assert.equal(risultato[0].metodo, 'id');
  assert.equal(risultato[0].stato_riga, 'da_verificare');
  assert.ok(risultato[0].avviso);
});

test('id presente nel PDF ma non più valido nella checklist attuale (domanda eliminata): niente panico, si tenta il testo', () => {
  const im = caricaImportMatching();
  const checklist = clonaChecklist();
  const righe = [rigaNostro({ id: 999, testo: 'Domanda che non esiste più in nessuna forma' })];
  const { righe: risultato } = im.abbinaRighe(righe, checklist);
  assert.equal(risultato[0].domanda_id, null);
  assert.equal(risultato[0].stato_riga, 'non_riconosciuta');
});

// ---------------------------------------------------------------------------------------------
// Metodo 3/4: testo (automatico sopra soglia alta, fuzzy sempre da verificare, sotto soglia niente)
// ---------------------------------------------------------------------------------------------

test('nessun id, testo praticamente identico: abbinamento automatico per testo', () => {
  const im = caricaImportMatching();
  const checklist = clonaChecklist();
  const righe = [rigaNostro({ id: null, testo: 'Nomina del RSPP: è presente una copia in archivio?' })];
  const { righe: risultato } = im.abbinaRighe(righe, checklist);
  assert.equal(risultato[0].domanda_id, 1);
  assert.equal(risultato[0].metodo, 'testo');
  assert.equal(risultato[0].stato_riga, 'sicuro');
});

test('testo abbastanza simile ma non identico (sotto la soglia alta): fuzzy, SEMPRE da verificare anche se il punteggio non è basso', () => {
  const im = caricaImportMatching();
  const checklist = clonaChecklist();
  // parole in comune ma frase rimaneggiata a sufficienza da restare sotto SOGLIA_ALTA
  const righe = [rigaNostro({ id: null, testo: 'RLS formato indicare nome elezione data' })];
  const { righe: risultato } = im.abbinaRighe(righe, checklist);
  assert.equal(risultato[0].domanda_id, 3);
  assert.equal(risultato[0].metodo, 'fuzzy');
  assert.equal(risultato[0].stato_riga, 'da_verificare');
});

test('testo troppo diverso da qualunque domanda: non riconosciuta, nessun candidato forzato', () => {
  const im = caricaImportMatching();
  const checklist = clonaChecklist();
  const righe = [rigaNostro({ id: null, testo: 'Il parcheggio esterno è dotato di segnaletica orizzontale regolamentare?' })];
  const { righe: risultato } = im.abbinaRighe(righe, checklist);
  assert.equal(risultato[0].domanda_id, null);
  assert.equal(risultato[0].stato_riga, 'non_riconosciuta');
});

test('due domande molto simili tra loro: ambiguità rilevata, mai un automatico alla cieca', () => {
  const im = caricaImportMatching();
  const checklist = clonaChecklist((c) => {
    // due domande IDENTICHE per costruzione (es. checklist con una voce duplicata per errore):
    // qualunque punteggio la query ottenga sarà identico per entrambe, quindi sempre ambiguo.
    c.sezioni[1].domande.push({ id: 7, testo: 'Gli idranti sono mantenuti accessibili e visibili?' });
    return c;
  });
  const righe = [rigaNostro({ id: null, testo: 'Gli idranti sono mantenuti accessibili e visibili?' })];
  const { righe: risultato } = im.abbinaRighe(righe, checklist);
  // deve individuare un candidato (5 o 7) ma MAI come automatico, essendo i due punteggi troppo vicini
  assert.ok([5, 7].includes(risultato[0].domanda_id));
  assert.notEqual(risultato[0].stato_riga, 'sicuro');
});

// ---------------------------------------------------------------------------------------------
// Metodo 2: sezione + numero (solo storico), sempre confermato dal testo
// ---------------------------------------------------------------------------------------------

function checklistConDivisione() {
  // 3 domande "documentali" + 3 "ambienti": stesso split usato da pdf.calcolaPuntoDivisioneGruppi (metà arrotondata per eccesso su 6 = 3).
  return clonaChecklist();
}

test('sezione + numero coerenti con la posizione originale: automatico, confermato dal testo', () => {
  const im = caricaImportMatching();
  const checklist = checklistConDivisione();
  const righe = [rigaStorico({ numero: 1, sezione: 'SOPRALLUOGO AMBIENTI DI LAVORO', testo: 'Gli estintori sono mantenuti accessibili e visibili?' })];
  const { righe: risultato } = im.abbinaRighe(righe, checklist, { puntoDivisioneGruppi: 3 });
  assert.equal(risultato[0].domanda_id, 4); // prima domanda del gruppo 2 (indice 3, id 4)
  assert.equal(risultato[0].metodo, 'sezione_numero');
  assert.equal(risultato[0].stato_riga, 'sicuro');
});

test('domanda spostata in altra posizione: la posizione indicherebbe la domanda sbagliata, ma il testo la smentisce e recupera quella giusta altrove', () => {
  const im = caricaImportMatching();
  // Nella checklist attuale le prime due domande del gruppo "ambienti" sono state scambiate di posto.
  const checklist = clonaChecklist((c) => {
    const [prima, seconda] = c.sezioni[1].domande;
    c.sezioni[1].domande[0] = seconda;
    c.sezioni[1].domande[1] = prima;
    return c;
  });
  // Il PDF storico riporta "Gli estintori..." come prima domanda del gruppo (numero locale 1),
  // ma nella checklist attuale quella posizione è ora occupata da "Gli idranti...".
  const righe = [rigaStorico({ numero: 1, sezione: 'SOPRALLUOGO AMBIENTI DI LAVORO', testo: 'Gli estintori sono mantenuti accessibili e visibili?' })];
  const { righe: risultato } = im.abbinaRighe(righe, checklist, { puntoDivisioneGruppi: 3 });
  assert.equal(risultato[0].domanda_id, 4); // id della domanda "estintori", non quella ora in posizione 1
  assert.notEqual(risultato[0].metodo, 'sezione_numero'); // la posizione da sola non basta più
});

test('sezione rinominata (stesso significato, etichetta diversa): il gruppo si riconosce comunque tramite gli alias noti', () => {
  const im = caricaImportMatching();
  const checklist = checklistConDivisione();
  // "AUDIT DOCUMENTALE" (vecchia etichetta storica) invece di "ANALISI DOCUMENTALE"
  const righe = [rigaStorico({ numero: 1, sezione: 'AUDIT DOCUMENTALE', testo: 'Nomina del RSPP: è presente una copia in archivio?' })];
  const { righe: risultato } = im.abbinaRighe(righe, checklist, { puntoDivisioneGruppi: 3 });
  assert.equal(risultato[0].domanda_id, 1);
  assert.equal(risultato[0].stato_riga, 'sicuro');
});

// ---------------------------------------------------------------------------------------------
// Ordine delle sezioni cambiato: l'id resta l'unico criterio decisivo, indipendente dall'ordine.
// ---------------------------------------------------------------------------------------------

test('ordine delle sezioni invertito nella checklist attuale: il matching per id non ne risente', () => {
  const im = caricaImportMatching();
  const checklist = clonaChecklist((c) => {
    c.sezioni.reverse();
    return c;
  });
  const righe = [rigaNostro({ id: 1, testo: 'Nomina del RSPP: è presente una copia in archivio?' })];
  const { righe: risultato } = im.abbinaRighe(righe, checklist);
  assert.equal(risultato[0].domanda_id, 1);
  assert.equal(risultato[0].stato_riga, 'sicuro');
});

// ---------------------------------------------------------------------------------------------
// Domanda nuova nella checklist attuale: nessuna riga la tocca, nessun errore.
// ---------------------------------------------------------------------------------------------

test('domanda nuova nella checklist attuale (assente dal vecchio PDF): resta semplicemente senza riga associata', () => {
  const im = caricaImportMatching();
  const checklist = clonaChecklist((c) => {
    c.sezioni[0].domande.push({ id: 100, testo: 'Domanda introdotta in una revisione successiva della checklist' });
    return c;
  });
  const righe = [rigaNostro({ id: 1, testo: 'Nomina del RSPP: è presente una copia in archivio?' })];
  const { righe: risultato, totaleDomandeChecklist } = im.abbinaRighe(righe, checklist);
  assert.equal(totaleDomandeChecklist, 7);
  assert.equal(risultato.some((r) => r.domanda_id === 100), false);
});

// ---------------------------------------------------------------------------------------------
// Vincolo uno-a-uno
// ---------------------------------------------------------------------------------------------

test('due righe del PDF si candidano alla stessa domanda: conflitto per entrambe, nessuna assegnazione automatica', () => {
  const im = caricaImportMatching();
  const checklist = clonaChecklist();
  const righe = [
    rigaNostro({ id: 4, testo: 'Gli estintori sono mantenuti accessibili e visibili?' }),
    rigaNostro({ id: 4, testo: 'Gli estintori sono mantenuti accessibili e visibili? (duplicato)' })
  ];
  const { righe: risultato, riepilogo } = im.abbinaRighe(righe, checklist);
  assert.equal(risultato[0].stato_riga, 'conflitto');
  assert.equal(risultato[1].stato_riga, 'conflitto');
  assert.equal(riepilogo.conflitti, 2);
  assert.equal(riepilogo.sicure, 0);
});

// ---------------------------------------------------------------------------------------------
// Note: viaggiano sempre con la propria riga, mai spostate per vicinanza
// ---------------------------------------------------------------------------------------------

test('la nota resta sempre associata alla riga/domanda a cui apparteneva nel PDF', () => {
  const im = caricaImportMatching();
  const checklist = clonaChecklist();
  const righe = [
    rigaNostro({ id: 1, testo: 'Nomina del RSPP: è presente una copia in archivio?', nota: 'Nota della domanda 1' }),
    rigaNostro({ id: 2, testo: 'Nomina del RLS: è presente nomina formale in archivio?', nota: null })
  ];
  const { righe: risultato } = im.abbinaRighe(righe, checklist);
  assert.equal(risultato[0].note, 'Nota della domanda 1');
  assert.equal(risultato[1].note, null);
});

// ---------------------------------------------------------------------------------------------
// Riepilogo aggregato (punto 12 della richiesta)
// ---------------------------------------------------------------------------------------------

test('riepilogo: conteggi coerenti su un mix di righe sicure/da verificare/non riconosciute/conflitto', () => {
  const im = caricaImportMatching();
  const checklist = clonaChecklist();
  const righe = [
    rigaNostro({ id: 1, testo: 'Nomina del RSPP: è presente una copia in archivio?' }), // sicura
    rigaNostro({ id: null, testo: 'RLS formato indicare nome elezione data' }), // fuzzy -> da verificare
    rigaNostro({ id: null, testo: 'Testo completamente estraneo alla checklist di prova' }), // non riconosciuta
    rigaNostro({ id: 4, testo: 'Gli estintori sono mantenuti accessibili e visibili?' }),
    rigaNostro({ id: 4, testo: 'Gli estintori sono mantenuti accessibili e visibili?' }) // conflitto con la precedente
  ];
  const { riepilogo } = im.abbinaRighe(righe, checklist);
  assert.equal(riepilogo.totaleRighe, 5);
  assert.equal(riepilogo.sicure, 1);
  assert.equal(riepilogo.daVerificare, 1);
  assert.equal(riepilogo.nonRiconosciute, 1);
  assert.equal(riepilogo.conflitti, 2);
});

// ---------------------------------------------------------------------------------------------
// Rilevamento cliente/checklist (punto 1): PDF di un cliente diverso da quello selezionato.
// ---------------------------------------------------------------------------------------------

test('rilevaChecklist: un PDF con id validi per la checklist B viene riconosciuto come B anche se l\'utente aveva selezionato A', () => {
  const im = caricaImportMatching();
  const checklistA = clonaChecklist((c) => { c.id = 'cliente_a'; c.titolo = 'Cliente A'; return c; });
  const checklistB = clonaChecklist((c) => {
    c.id = 'cliente_b';
    c.titolo = 'Cliente B';
    // id completamente diversi da checklistA, cosi' il segnale e' inequivocabile
    c.sezioni.forEach((s) => s.domande.forEach((d) => { d.id += 1000; }));
    return c;
  });
  const righe = [
    rigaNostro({ id: 1004, testo: 'Gli estintori sono mantenuti accessibili e visibili?' }),
    rigaNostro({ id: 1005, testo: 'Gli idranti sono mantenuti accessibili e visibili?' }),
    rigaNostro({ id: 1001, testo: 'Nomina del RSPP: è presente una copia in archivio?' })
  ];
  const esito = im.rilevaChecklist(righe, [
    { id: checklistA.id, titolo: checklistA.titolo, checklist: checklistA },
    { id: checklistB.id, titolo: checklistB.titolo, checklist: checklistB }
  ]);
  assert.equal(esito.checklistId, 'cliente_b');
  assert.equal(esito.automatico, true);
});

test('rilevaChecklist: classifica ambigua fra due checklist molto simili non viene dichiarata automatica', () => {
  const im = caricaImportMatching();
  const checklistA = clonaChecklist((c) => { c.id = 'cliente_a'; c.titolo = 'Cliente A'; return c; });
  const checklistAQuasiUguale = clonaChecklist((c) => { c.id = 'cliente_a_bis'; c.titolo = 'Cliente A bis'; return c; });
  // Nessun id nelle righe (formato storico): il rilevamento userà la similarità testuale, identica per entrambe le checklist quasi identiche.
  const righe = [
    rigaStorico({ numero: 1, sezione: 'ADEMPIMENTI FORMALI', testo: 'Nomina del RSPP: è presente una copia in archivio?' }),
    rigaStorico({ numero: 2, sezione: 'ADEMPIMENTI FORMALI', testo: 'Nomina del RLS: è presente nomina formale in archivio?' })
  ];
  const esito = im.rilevaChecklist(righe, [
    { id: checklistA.id, titolo: checklistA.titolo, checklist: checklistA },
    { id: checklistAQuasiUguale.id, titolo: checklistAQuasiUguale.titolo, checklist: checklistAQuasiUguale }
  ]);
  assert.equal(esito.ambiguo, true);
  assert.equal(esito.automatico, false);
});

test('similarita: identico dopo normalizzazione (accenti, maiuscole, spazi) vale 1', () => {
  const im = caricaImportMatching();
  assert.equal(im.similarita('È presente la Nomina del RSPP?', 'e presente la nomina del rspp'), 1);
});

test('similarita: stringhe vuote non generano NaN/eccezioni', () => {
  const im = caricaImportMatching();
  assert.equal(im.similarita('', ''), 1);
  assert.equal(im.similarita('qualcosa', ''), 0);
  assert.equal(im.similarita('', 'qualcosa'), 0);
});

// ---------------------------------------------------------------------------------------------
// Collegamento fotografie importate -> domande
// ---------------------------------------------------------------------------------------------

test('foto PDF app: "Domanda N" in didascalia collega la foto alla domanda abbinata', () => {
  const im = caricaImportMatching();
  const checklist = clonaChecklist();
  const righe = [rigaNostro({ id: 4, testo: 'Gli estintori sono mantenuti accessibili e visibili?', stato: 'NC' })];
  const { righe: abbinate } = im.abbinaRighe(righe, checklist);
  const [foto] = im.collegaImmaginiAlleDomande([
    { pagina: 7, didascalia: 'Foto 2 — Domanda 4: Gli estintori sono mantenuti accessibili e visibili?' }
  ], abbinate, checklist);
  assert.equal(foto.domanda_id_collegata, 4);
  assert.equal(foto.domanda_testo_collegata, 'Gli estintori sono mantenuti accessibili e visibili?');
  assert.equal(foto.associazione_domanda_metodo, 'didascalia_id');
});

test('foto storico: numero locale ambiguo non viene collegato alla cieca', () => {
  const im = caricaImportMatching();
  const checklist = clonaChecklist();
  const righeAbbinate = [
    { domanda_id: 1, stato_riga: 'sicuro', originale: { id_originale: null, numero_originale: 1, testo_originale: CHECKLIST_BASE.sezioni[0].domande[0].testo } },
    { domanda_id: 4, stato_riga: 'sicuro', originale: { id_originale: null, numero_originale: 1, testo_originale: CHECKLIST_BASE.sezioni[1].domande[0].testo } }
  ];
  const [foto] = im.collegaImmaginiAlleDomande([
    { pagina: 9, didascalia: 'Foto — Domanda 1' }
  ], righeAbbinate, checklist);
  assert.equal(foto.domanda_id_collegata, null);
  assert.equal(foto.associazione_domanda_metodo, null);
});

test('foto con testo domanda riconoscibile viene collegata anche se il numero non basta', () => {
  const im = caricaImportMatching();
  const checklist = clonaChecklist();
  const righeAbbinate = [
    { domanda_id: 1, stato_riga: 'sicuro', originale: { id_originale: null, numero_originale: 1, testo_originale: CHECKLIST_BASE.sezioni[0].domande[0].testo } },
    { domanda_id: 4, stato_riga: 'sicuro', originale: { id_originale: null, numero_originale: 1, testo_originale: CHECKLIST_BASE.sezioni[1].domande[0].testo } }
  ];
  const [foto] = im.collegaImmaginiAlleDomande([
    { pagina: 9, didascalia: 'Foto 1 — Domanda 1: Gli estintori sono mantenuti accessibili e visibili?' }
  ], righeAbbinate, checklist);
  assert.equal(foto.domanda_id_collegata, 4);
  assert.equal(foto.associazione_domanda_metodo, 'didascalia_testo');
});

test('associazione foto scelta manualmente non viene sovrascritta dal riconoscimento automatico', () => {
  const im = caricaImportMatching();
  const checklist = clonaChecklist();
  const [foto] = im.collegaImmaginiAlleDomande([
    { pagina: 2, didascalia: 'Foto 1 — Domanda 1: testo vecchio', domanda_id_collegata: 5, associazione_domanda_metodo: 'manuale' }
  ], [], checklist);
  assert.equal(foto.domanda_id_collegata, 5);
  assert.equal(foto.associazione_domanda_metodo, 'manuale');
});

test('foto importata: il riferimento "Vedi Foto N" della riga NC prevale e collega la foto alla stessa domanda', () => {
  const im = caricaImportMatching();
  const checklist = clonaChecklist();
  const righe = [rigaNostro({ id: 4, testo: 'Gli estintori sono mantenuti accessibili e visibili?', stato: 'NC', nota: 'Estintore ostruito. Vedi Foto 1' })];
  const { righe: abbinate } = im.abbinaRighe(righe, checklist);
  const [foto] = im.collegaImmaginiAlleDomande([
    { pagina: 7, didascalia: 'Foto 1' }
  ], abbinate, checklist);
  assert.equal(abbinate[0].risposta, 'NC');
  assert.equal(foto.domanda_id_collegata, 4);
  assert.equal(foto.associazione_domanda_metodo, 'riferimento_tabella');
});

test('foto importate senza didascalia leggibile: se i riferimenti Vedi Foto 1..N sono completi usa l’ordine del PDF', () => {
  const im = caricaImportMatching();
  const checklist = clonaChecklist();
  const righe = [
    rigaNostro({ id: 4, testo: 'Gli estintori sono mantenuti accessibili e visibili?', stato: 'NC', nota: 'Vedi Foto 1' }),
    rigaNostro({ id: 5, testo: CHECKLIST_BASE.sezioni[1].domande[1].testo, stato: 'PC', nota: 'Vedi Foto 2' })
  ];
  const { righe: abbinate } = im.abbinaRighe(righe, checklist);
  const foto = im.collegaImmaginiAlleDomande([
    { pagina: 7, didascalia: '' },
    { pagina: 7, didascalia: '' }
  ], abbinate, checklist);
  assert.equal(foto[0].domanda_id_collegata, 4);
  assert.equal(foto[0].associazione_domanda_metodo, 'riferimento_tabella_ordine');
  assert.equal(foto[1].domanda_id_collegata, 5);
  assert.equal(foto[1].associazione_domanda_metodo, 'riferimento_tabella_ordine');
});


test('PDF nuovo: numero progressivo che collide con un id interno viene corretto dal testo', () => {
  const im = caricaImportMatching();
  const checklist = { id:'gap', titolo:'Gap', sezioni:[{ titolo:'S', domande:[
    { id:1, testo:'Prima domanda' },
    { id:3, testo:'Domanda con id interno tre mostrata come numero due' },
    { id:2, testo:'Altra domanda con id interno due' }
  ]}]};
  const { righe } = im.abbinaRighe([
    rigaNostro({ id:2, testo:'Domanda con id interno tre mostrata come numero due', stato:'NC' })
  ], checklist);
  assert.equal(righe[0].domanda_id, 3);
  assert.equal(righe[0].metodo, 'testo');
  assert.equal(righe[0].stato_riga, 'sicuro');
});

test('PDF legacy: id stabile resta prioritario quando id e testo concordano', () => {
  const im = caricaImportMatching();
  const checklist = { id:'legacy', titolo:'Legacy', sezioni:[{ titolo:'S', domande:[
    { id:10, testo:'Domanda legacy numero dieci' },
    { id:11, testo:'Domanda legacy numero undici' }
  ]}]};
  const { righe } = im.abbinaRighe([
    rigaNostro({ id:10, testo:'Domanda legacy numero dieci', stato:'C' })
  ], checklist);
  assert.equal(righe[0].domanda_id, 10);
  assert.equal(righe[0].metodo, 'id');
  assert.equal(righe[0].stato_riga, 'sicuro');
});


// ---------------------------------------------------------------------------------------------
// Interparking legacy reale: PDF di settembre 2026 con le due domande poi rimosse.
// ---------------------------------------------------------------------------------------------

test('Interparking storico: sprinkler e planimetria duplicata vengono escluse, le altre righe restano associate correttamente', () => {
  const im = caricaImportMatching();
  const checklist = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'checklists', 'interparking_sopralluogo.json'), 'utf8'));

  const righeVecchie = [
    rigaNostro({ id: 25, testo: 'Sono Presenti le registrazioni dei controlli semestrali effettuati a: Impianto sprinkler:', stato: 'NC' }),
    rigaNostro({ id: 26, testo: 'Sono Presenti le registrazioni dei controlli effettuati a: Eventuali altri impianti:', stato: 'C' }),
    rigaNostro({ id: 27, testo: 'Planimetrie antincendio? Sono aggiornate le planimetrie esposte?', stato: 'PC' }),
    rigaNostro({ id: 28, testo: "Verbali delle Prove annuali di evacuazione e gestione delle emergenze È stata eseguita la prova annuale d'evacuazione? Indicare nelle note la data dell'ultimo verbale", stato: 'NC' }),
    rigaNostro({ id: 49, testo: 'Planimetrie di Emergenza: sono aggiornate le planimetrie esposte? Risultano conformi?', stato: 'NA' }),
    rigaNostro({ id: 50, testo: 'Le zone filtro sono mantenute sgombre da materiale stoccato?', stato: 'C' }),
    rigaNostro({ id: 44, testo: "Sono presenti materiali combustibili all'interno dei box?", stato: 'NA' })
  ];

  const { righe, riepilogo } = im.abbinaRighe(righeVecchie, checklist);
  assert.equal(righe[0].stato_riga, 'ritirata');
  assert.equal(righe[0].domanda_id, null);
  assert.equal(righe[4].stato_riga, 'ritirata');
  assert.equal(righe[4].domanda_id, null);
  assert.equal(righe[1].domanda_id, 28);
  assert.equal(righe[2].domanda_id, 29);
  assert.equal(righe[3].domanda_id, 30);
  assert.equal(righe[5].domanda_id, 51);
  assert.equal(righe[6].domanda_id, 77);
  assert.equal(riepilogo.ritirate, 2);
  assert.equal(riepilogo.conflitti, 0);
  assert.equal(riepilogo.nonRiconosciute, 0);
});

test('Interparking storico: riconosce le domande ritirate anche se il PDF conserva i vecchi id interni', () => {
  const im = caricaImportMatching();
  const checklist = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'checklists', 'interparking_sopralluogo.json'), 'utf8'));
  const { righe, riepilogo } = im.abbinaRighe([
    rigaNostro({ id: 27, testo: 'Sono Presenti le registrazioni dei controlli semestrali effettuati a: Impianto sprinkler:', stato: 'NC' }),
    rigaNostro({ id: 50, testo: 'Planimetrie di Emergenza: sono aggiornate le planimetrie esposte? Risultano conformi?', stato: 'PC' })
  ], checklist);
  assert.deepEqual(Array.from(righe, r => r.stato_riga), ['ritirata', 'ritirata']);
  assert.equal(riepilogo.ritirate, 2);
  assert.equal(riepilogo.conflitti, 0);
});


test('Interparking legacy completo: l ordine fisico 1..75 prevale su numeri PDF sovrapposti o incoerenti', () => {
  const im = caricaImportMatching();
  const checklist = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'checklists', 'interparking_sopralluogo.json'), 'utf8'));
  const righeLegacy = Array.from({ length: 75 }, (_, indice) =>
    rigaNostro({ id: indice < 15 ? indice + 1 : 700 + indice, testo: `Riga fisica Interparking ${indice + 1}`, stato: 'C' })
  );
  const { righe, riepilogo } = im.abbinaRighe(righeLegacy, checklist);
  const idsAttesi = checklist.sezioni.flatMap((sezione) => sezione.domande.map((domanda) => domanda.id));
  const idsImportati = righe.filter((riga) => riga.stato_riga !== 'ritirata').map((riga) => riga.domanda_id);
  assert.deepEqual(Array.from(idsImportati), Array.from(idsAttesi));
  assert.equal(righe[24].stato_riga, 'ritirata');
  assert.equal(righe[48].stato_riga, 'ritirata');
  assert.equal(righe[43].domanda_id, 77);
  assert.equal(riepilogo.daVerificare, 0);
  assert.equal(riepilogo.conflitti, 0);
});

test('Interparking legacy completo: 75 righe storiche diventano 73 domande correnti e 2 ritirate', () => {
  const im = caricaImportMatching();
  const checklist = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'checklists', 'interparking_sopralluogo.json'), 'utf8'));
  const righeLegacy = Array.from({ length: 75 }, (_, indice) =>
    rigaNostro({ id: indice + 1, testo: `Riga Interparking legacy ${indice + 1}`, stato: 'C' })
  );
  const { righe, riepilogo } = im.abbinaRighe(righeLegacy, checklist);
  const idsAttesi = checklist.sezioni.flatMap((sezione) => sezione.domande.map((domanda) => domanda.id));
  const idsImportati = righe.filter((riga) => riga.stato_riga !== 'ritirata').map((riga) => riga.domanda_id);
  assert.deepEqual(Array.from(idsImportati), Array.from(idsAttesi));
  assert.equal(righe[24].stato_riga, 'ritirata');
  assert.equal(righe[48].stato_riga, 'ritirata');
  assert.equal(righe[43].domanda_id, 77);
  assert.equal(riepilogo.sicure, 73);
  assert.equal(riepilogo.ritirate, 2);
  assert.equal(riepilogo.daVerificare, 0);
  assert.equal(riepilogo.nonRiconosciute, 0);
  assert.equal(riepilogo.conflitti, 0);
});


test('Interparking storico: testo certo vince sul numero slittato e conserva risposta + nota', () => {
  const im = caricaImportMatching();
  const checklist = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'checklists', 'interparking_sopralluogo.json'), 'utf8'));
  const domandaDpi = checklist.sezioni.flatMap(s => s.domande).find(d => d.id === 73);
  assert.ok(domandaDpi);
  const righe = [{
    formato: 'nostro',
    id_originale: 74,
    numero_originale: 74,
    sezione_originale: 'Macchine / Attrezzature',
    testo_originale: domandaDpi.testo,
    stato_originale: 'PC',
    nota_originale: 'Nota proveniente dalla checklist storica'
  }];
  const { righe: risultato } = im.abbinaRighe(righe, checklist);
  assert.equal(risultato[0].domanda_id, 73);
  assert.equal(risultato[0].metodo, 'testo');
  assert.equal(risultato[0].stato_riga, 'sicuro');
  assert.equal(risultato[0].risposta, 'PC');
  assert.equal(risultato[0].note, 'Nota proveniente dalla checklist storica');
});

test('checklist sorgente più corta: importa le righe presenti per testo e lascia assenti le altre', () => {
  const im = caricaImportMatching();
  const checklist = clonaChecklist();
  const righe = [
    rigaNostro({ id: 1, testo: checklist.sezioni[0].domande[0].testo, stato: 'C', nota: 'prima' }),
    rigaNostro({ id: 2, testo: checklist.sezioni[1].domande[0].testo, stato: 'NC', nota: 'quarta domanda corrente' }),
    rigaNostro({ id: 3, testo: checklist.sezioni[1].domande[2].testo, stato: 'PC', nota: 'sesta domanda corrente' })
  ];
  const { righe: risultato } = im.abbinaRighe(righe, checklist);
  assert.deepEqual(Array.from(risultato, r => r.domanda_id), [1,4,6]);
  assert.deepEqual(Array.from(risultato, r => r.risposta), ['C','NC','PC']);
  assert.deepEqual(Array.from(risultato, r => r.note), ['prima','quarta domanda corrente','sesta domanda corrente']);
});
