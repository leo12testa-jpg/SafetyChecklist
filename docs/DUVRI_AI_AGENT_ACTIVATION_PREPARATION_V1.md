# Colligo DUVRI AI — Attivazione preparatoria dei 12 agenti

**Stato:** software eseguibile per il **preparativo**, non per l'esecuzione AI reale. Nessuna chiamata esterna, chiave, trasferimento dati, emissione, deploy o nuovo servizio cloud. I 12 profili e le istruzioni professionali esistevano già: non vengono ricreati.

## Modulo

`js/duvri-agent-activation-preparation.js` espone:

```js
const { prepare } = require('./js/duvri-agent-activation-preparation.js');
const plan = prepare({
  jobId, analysisRevisionId, extractionRevisionId,
  sourceScope, screeningSignals, mode: 'synthetic_preparation'
});
```

**Trust boundary:** `sourceScope` e `screeningSignals` devono essere caricati dal backend autorizzato e verificati con le revisioni esatte di documenti e OCR. Il browser non può attribuire da solo l'esito delle estrazioni né concedere lo screening. La libreria prepara metadati, non esegue analisi HSE.

### Modalità A — `synthetic_preparation`

Usa gli strumenti esistenti:
- `duvri-hse-agent-instructions.js` per creare task secondo il routing;
- `duvri-agent-contract.js` per i 12 specialisti e le risposte complete allo screening.

Restituisce `synthetic_tasks_prepared`, ID dei ruoli selezionati e i primi due `next_agent_ids`: `documentale`, `normativa`. È compatibile con il supervisore della PR #60, che verifica i receipt e mette `coordinamento` per ultimo. **Non inventa risultati sintetici:** eseguire il backend/fixture test esistente per generare i risultati. Non chiamare provider, né passare il risultato al compilatore come analisi reale.

### Modalità B — `private_provider_review`

Richiede inoltre `provider`, `authorization`, `budget`, `runtime` e usa **il preflight già esistente**, `duvri-ai-execution-preflight.js`. Prima verifica la completezza dello screening e dei task staged; poi controlla la coerenza del provider con autorizzazioni di direzione, trattamento dei dati, policy di conservazione, regione, budget per fascicolo, segreti server-side, audit e controllo uscita rete.

Se mancano permessi/contratti/budget torna `blocked` con codici sanificati. Con input **esclusivamente sintetici** e approvazioni fittizie può restituire `ready_for_private_gateway_authorization_review`: questo è soltanto uno stato di **revisione preliminare**, non è prova di un accordo, consenso, controllo economico o autorizzazione a inviare dati. Non emette token, credenziali o call envelope.

**In qualunque modalità e stato:** `provider_dispatch_allowed=false`, `external_data_transfer_allowed=false`, `document_draft_allowed=false`, `hse_approved=false`, `issuance_allowed=false`.

## Quali passaggi mancano prima degli agenti AI reali

1. Colligo indica provider, modello, regione, categorie di dati autorizzate, ruoli abilitati, condizioni contrattuali, privacy, retention, budget massimo e approvatori.
2. Su ambiente privato autorizzato, integrare un **gateway server-side** che legga autorizzazioni e costi da fonte fidata, riservi budget in una transazione e ricalcoli il preflight al momento della chiamata. Non basarsi mai sui booleani `authorization` o `runtime` provenienti dal browser. Mantenere chiave API esclusivamente in secret manager lato server.
3. Il backend deve estrarre e minimizzare per agente solo i **fatti pertinenti** e i relativi `file_id`/locator, evitando di condividere automaticamente tutti gli allegati e le informazioni di cliente.
4. Configurare output JSON di ciascun specialista, con validazione schema, confronti delle citazioni con i fatti confermati (`duvri-hse-fact-match.js`) e autorizzazioni alle fonti sempre revisionate.
5. Usare il supervisore #60 per le dipendenze, l'aggregatore `duvri-hse-coordinator.js` per conflitti e sovrapposizioni, e `duvri-review-flow-composer.js` per il flusso di revisione.
6. Il tecnico HSE deve riesaminare interferenze, responsabilità, misure e questioni aperte. Nessun risultato AI può sbloccare D1/D2, il QA Word o l'emissione.
7. Testare qualità e sicurezza su fascicoli sintetici, includendo prompt injection, fonti inventate, costo massimo, timeouts, retry e invalidazione al cambio documento, prima di autorizzare qualsiasi fascicolo reale.

**Non sostituire `HSE_ADAPTER_UNAVAILABLE`** nel worker privato finché provider, ambiente e autorizzazioni non sono effettivi. Una licenza per un'interfaccia chatbot non equivale a credenziali/API abilitate per uso aziendale.

## Handoff Codex

- Non inserire due orchestratori: prima confrontare il backend locale e i contratti `hse-contracts.generated.js`. L'interfaccia di questo modulo è **read-only** e autonoma; l'eventuale integrazione è da versionare/testare nello stesso workspace privato.
- Distinguere il `mode` sintetico dai permessi reali, senza espandere accessi cloud.
- La PR #60 sul supervisore è separata e **non fusa** se il QA browser resta rosso; non importarla come dipendenza da `main` prima della sua integrazione.
- L'intera fase A resta test sintetico; B (pilota con documenti cliente autorizzati) e C (AI reale e rilascio) richiedono decisioni aziendali distinte.

## Test

```bash
node --test tests/duvri-agent-activation-preparation.test.js
```

22 test interamente sintetici verificano 3/12 agenti, routing, unknown, source scope, revisioni, privacy, budget, autorizzazione, region, runtime, input malevoli, no secrets e **divieto assoluto di dispatch**. Non rappresentano un test in produzione.
