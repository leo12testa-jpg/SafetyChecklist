# Colligo DUVRI AI — composizione del flusso documenti → HSE → tecnico (v1)

**Stato: modulo di orchestrazione deterministica isolato. Non è la funzione Supabase produttiva. Non genera DOCX, non interroga un modello AI, non carica documenti o accede al database.**

## Obiettivo

I componenti HSE del repository erano verificati singolarmente e attraverso test integrati. `js/duvri-review-flow-composer.js` è un primo **punto di ingresso condiviso** che li richiama effettivamente in ordine, restituendo a un eventuale portale/backend privato uno **stato unico e non riservato**.

L'input è un fascicolo con estrazioni e risultati già **verificati dal backend privato**; non esiste una scorciatoia in cui il browser o un LLM dichiari un dato "verificato" e lo renda attendibile.

## Sequenza eseguibile

1. `buildHseEvidenceScope`: checklist DOCX obbligatoria, allegati, impronte e attestazioni della stessa revisione.
2. `aggregateEvidenceGated`: screening documentale e pacchetto di specialisti; un `unknown` non elimina automaticamente un rischio.
3. `duvriHseFactMatch.verify`: confronto delle citazioni con fatti effettivamente estratti (file, pagina/locator, testo e stato di verifica).
4. `buildClarificationRegister`: registro dei chiarimenti e degli elementi da completare.
5. `prepareRouting` opzionale: instradamento tecnico, nessun messaggio automatico al cliente.
6. `assessReviewSession` opzionale: decisioni del tecnico soltanto se le fonti sono confermate, non restano chiarimenti aperti e sono disponibili **revisione/hash del pacchetto attestati dal server**.
7. Stato risultato `reviewed_for_synthetic_draft` **solo** come preparazione al compilatore Word privato e ai gate aziendali D1/D2; non si genera alcun DUVRI.

L'esito contiene esclusivamente ID fascicolo, conteggi e codici/stati; nessun estratto documentale, nota cliente o percorso riservato. Sono sempre `false` i flag `client_dispatch_allowed`, `provider_dispatch_allowed`, `document_draft_allowed`, `duvri_approved`, `issuance_allowed`.

## Interfaccia backend privata (per Codex/Claude)

```js
const {assemble} = require('./js/duvri-review-flow-composer.js');
const status = assemble({
  jobId, analysisRevisionId, extractionRevisionId,
  files, extractions, screeningAnswers, agentResults, sourceFacts,
  allowedHistoricalReferenceIds, allowedInternalRuleIds,
  routingDecisions, routerContext,
  reviewDecisions, reviewerContext,
  packetIdentity
});
```

Questo esempio è un **contratto di integrazione**, non codice da eseguire con documenti cliente senza autorizzazione.

Requisiti prima dell'uso reale:

- `files`, `extractions`, `sourceFacts`, `agentResults` e permessi devono essere caricati lato server dal fascicolo corrente, verificando SHA dei file, RLS/ACL e revisione.
- **Dopo** la costruzione del pacchetto HSE, il backend deve salvarne una versione immutabile, ricalcolare il SHA-256 canonico e recuperarlo con `packetIdentity:{packet_revision_id,packet_sha256,backend_verified:true}`. La funzione non calcola alcun SHA, non autentica il flag e non persiste il pacchetto. L'uso del digest inventato nei test è soltanto una fixture sintetica.
- Per la revisione HSE, fornire `reviewerContext` caricato server-side con ruolo tecnico/admin, permessi, digest verificato e revisioni del fascicolo correnti. La libreria rifiuta l'assenza di `packetIdentity`.
- Decisioni e motivazioni del tecnico, triage e revisioni devono essere registrati in Postgres tramite transazione CAS, audit append-only e retry idempotente. Questo modulo non salva nulla.
- Con agenti veri disabilitati, `HSE_ADAPTER_UNAVAILABLE` deve rimanere il gate del worker reale. Non chiamare questo flusso con lo screening a parole chiave e poi presentarlo come valutazione professionale.
- Questa libreria non sostituisce la verifica delle vulnerabilità di PDF.js/OCR, le policy privacy, il preflight AI, la compilazione del DOCX originale o il QA visivo del Word.

## Test

`node --test tests/duvri-review-flow-composer.test.js`

**11 test sintetici**: intero percorso di revisione, revisore mancante, PDF sostituito, citazione inventata, screening incerto, digest alterato, assenza attestazione SHA, specialisti assenti, triage incoerente, input malformato e tentativi di auto-invio/auto-emissione.

Eseguire anche `node --test tests/*.test.js`, `tests/duvri-integrated-synthetic-gates.test.js` e la matrice browser audit/DVR del progetto. Le suite verdi dimostrano soltanto la coerenza del software sottoposto a test, non approvano il metodo D1, mapping D2 o il documento finale.

**Riservatezza:** usare solo dati sintetici nelle PR pubbliche. Nessun master Word, allegato o documento cliente in GitHub.
