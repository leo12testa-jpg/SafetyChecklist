# COLLIGO DUVRI AI — Ricerca locale dei precedenti DUVRI 2026

**Stato:** modulo isolato e sperimentale; nessuna connessione con l'intranet Colligo, nessun trasferimento in cloud o analisi AI dei documenti. Perimetro: solo DUVRI per qualunque cliente.

## Dati disponibili

Nel rapporto di Claude Code riportato dall'utente: **148 DUVRI 2026 confermati**, 147 copie con un duplicato identico, 619 candidati dubbi, cataloghi CSV/XLSX e indice locale. Questi numeri **non sono stati verificati tramite accesso diretto al PC** in questa sessione.

Il classificatore originale ha riconosciuto pochi campi cliente e sede. Non assumere che nomi, oggetti e altri campi siano già estratti in modo affidabile.

## Soluzione isolata aggiunta alla PR #28

- `js/duvri-historical-references.js`: motore di ricerca *solo metadati normalizzati*.
- `tests/duvri-historical-references.test.js`: casi positivi, negativi, filtraggio 2026, sicurezza e ordinamento.
- Non serve una chiave API né un database remoto: la funzione è deterministica e non accede a file, rete o provider AI.

La funzione **non apre né analizza** i documenti aziendali e non conosce il CSV reale di Claude: opera su un indice temporaneo che dovrà essere convertito, verificato e autorizzato in locale.

## Interfaccia

La funzione `findHistoricalReferences(request, catalog)` richiede:

```js
const { findHistoricalReferences } = require('./js/duvri-historical-references.js');
const request = {
  job_id: 'FASCICOLO_TEST_SYNTH_001',
  activity_tags: ['manutenzione_frigoriferi'],
  interference_tags: ['mezzi_pedoni'],
  limit: 5
};
// Esempio esclusivamente sintetico:
const catalog = [{
  archive_id: 'ARCH_2026_001',
  year: 2026,
  year_status: 'confirmed',
  document_status: 'sconosciuto',
  activity_tags: ['manutenzione_frigoriferi'],
  interference_tags: ['mezzi_pedoni']
}];
const r = findHistoricalReferences(request, catalog);
// r.references contiene soltanto identificatori opachi e categorie,
// mai testo del DUVRI, cliente, indirizzo o percorso originale.
```

Il campo `year_status=confirmed` deve provenire dall'inventario verificato, non da una supposizione sull'anno. `document_status=finale` non significa che la correttezza tecnica del contenuto sia stata riverificata.

I tag ammessi sono elencati nel codice, classificati per attività e per rischio interferenziale. Nuove categorie si aggiungono con test e revisione del vocabolario; le categorie dei clienti non sono agenti specialistici.

## Scelte di sicurezza

1. **Nessun contenuto cliente nell'API:** il catalogo normalizzato accetta soltanto ID opaco, anno/stato e categorie controllate. Qualsiasi campo extra (cliente, percorso, estratto originale, ecc.) causa errore e blocca l'intero catalogo.
2. **Solo confermati nel 2026:** i 619 dubbi rimangono fuori dal retrieval finché non hanno verifica.
3. **Rilevanza separata dal rischio:** l'ordinamento è basato sui tag corrispondenti e sulla versione del documento. Non esiste alcun punteggio numerico del rischio né una misura di sicurezza trasferita.
4. **Non sono prove del nuovo intervento:** i risultati hanno `source_type=historical_2026_reference`, `verification_status=historical_example_only`, `current_job_evidence=false`, `measures_automatically_applicable=false` e `requires_human_review=true`.
5. **Nessuna deduzione dal cliente precedente:** una categoria comune non dimostra che gli accessi, le procedure, le protezioni o le condizioni del nuovo intervento siano analoghi.
6. **Indici locali separati:** la conversione del catalogo CSV avverrà sul PC di Claude Code o su storage aziendale autorizzato. Non committare `ARCHIVIO_DUVRI_2026`, CSV con nomi clienti, percorsi, originali DOCX/PDF, estratti o hash che consentono di ricollegare pubblicamente a file riservati.

## Collegamento con il coordinatore HSE

Flusso desiderato:

1. Il coordinatore costruisce il profilo attività/interferenze da dati dell'incarico corrente, conservandone le fonti.
2. `findHistoricalReferences` individua ID archivio pertinenti nel solo indice verificato del 2026.
3. Un servizio **locale/privato autorizzato** risolve gli ID nei documenti; i contenuti non devono uscire dall'ambiente autorizzato.
4. Gli agenti possono consultare i precedenti **solo come esempi** e devono citare documenti/risposte del nuovo intervento per qualsiasi finding.
5. Il validatore `duvri-agent-contract` rifiuta ogni finding che sia fondato esclusivamente sullo storico.
6. Il tecnico Colligo verifica e approva le valutazioni e la bozza.

**Non è ancora implementato** l'accesso al CSV, l'estrazione contenuti dei 148 DUVRI, l'integrazione con il worker, l'adattamento alla gestione privacy o la generazione DOCX effettiva.

## Test del modulo

```bash
node --check js/duvri-historical-references.js
node --test tests/duvri-historical-references.test.js
```

Eseguire anche l'intera suite SafetyChecklist quando si valuta la PR per il merge. Solo su test sintetici; niente servizi di produzione.
