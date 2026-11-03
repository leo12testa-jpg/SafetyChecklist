# Colligo DUVRI AI — Supervisore deterministico dei 12 agenti HSE

**Stato:** pianificatore/validatore puro, senza esecuzione AI, senza file cliente, senza provider, senza Word e senza autorizzazioni operative. È progettato per essere integrato nel **backend privato** soltanto dopo verifica di source scope, autenticazione, registri e autorizzazioni. Non sostituisce `duvri-hse-coordinator.js` o `duvri-review-flow-composer.js`.

## Scopo e struttura dei 12 agenti

Il catalogo esistente `js/duvri-hse-agent-instructions.js` definisce già istruzioni professionali e routing; il contratto `js/duvri-agent-contract.js` conosce i 12 agenti e lo schema risultati. Questa PR **non li duplica**.

Il nuovo `js/duvri-hse-agent-run-supervisor.js` prepara e verifica **quattro fasi logiche**:

1. `foundation`: devono concludere `documentale` e `normativa` (entrambi sempre richiesti);
2. `specialists`: possono operare soltanto gli specialisti selezionati dalle risposte `yes` dello screening, mai `unknown` → `no`;
3. `coordination`: lo specialista `coordinamento` opera solo dopo aver ricevuto ogni risultato necessario delle fasi precedenti;
4. `complete`: output disponibile esclusivamente per i controlli di coerenza e per la successiva **revisione HSE umana**. Un'eventuale richiesta di chiarimento resta bloccante.

L'ordine non implica che l'AI lavori davvero: il campo `next_agent_ids` rappresenta task **pronti per l'eventuale staging privato** e NON autorizza la chiamata a un modello.

## Interfaccia

`assess({jobId,analysisRevisionId,extractionRevisionId,runRevisionId,currentRunRevisionId,staged,receipts})`

- `staged`: oggetto creato da `duvriHseAgentInstructions.stage(...)`, costruito lato server da fonti verificate e screening completo; deve conservare gli ID di fascicolo/revisioni e identici allowed_file_ids per ogni task.
- `receipts`: soli **metadati di esecuzione** già verificati e salvati dal backend, uno per ciascun agente completato. Non contengono testi, prompt, esiti HSE o passaggi documentali.

Ogni receipt contiene esattamente:

```json
{
  "agent_id": "documentale",
  "job_id": "JOB_SYNTHETIC_001",
  "analysis_revision_id": "ANALYSIS_SYNTH_001",
  "extraction_revision_id": "EXTRACTION_SYNTH_001",
  "run_revision_id": "RUN_SYNTH_001",
  "result_revision_id": "RESULT_SYNTH_001",
  "result_sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "result_status": "completed",
  "backend_result_hash_verified": true,
  "agent_schema_validated": true,
  "authorized_source_scope_verified": true,
  "citation_match_verified": true
}
```

Le attestazioni booleane in receipt non sono prove autonome: il backend deve **ricavare gli esiti** dal proprio storage e rieseguire i controlli indipendenti necessari (`validateAgentResult`, source allowlist, `duvri-hse-fact-match.js`, revisione e SHA). Il browser e gli agenti **non possono fornire o falsificare** questi valori. Ogni modifica al fascicolo o alle fonti invalida l'intero `runRevisionId`. L'ordine deve essere registrato nel database, non dedotto da un timestamp scelto dal provider.

## Stati del supervisore

- `blocked`: task/receipt errati, revisioni obsolete, risultati duplicati, un agente anticipato, attestazioni assenti o un agente in stato bloccato;
- `awaiting_specialist_results`: una delle tre fasi con agenti non ancora conclusi;
- `awaiting_human_clarifications`: tutti i risultati ci sono, ma almeno uno richiede chiarimenti;
- `ready_for_private_hse_packet_review`: tutti i receipt sono coerenti, ma non è una validazione HSE.

**Ogni stato** restituisce sempre `provider_dispatch_allowed=false`, `external_data_transfer_allowed=false`, `document_draft_allowed=false`, `hse_approved=false`, `issuance_allowed=false`.

Il coordinatore già presente `duvri-hse-coordinator.js` rimane l'unico componente che aggrega i contenuti HSE; il nuovo supervisore certifica soltanto l'ordine e la coerenza dei metadati di esecuzione. **Non** produce testi, score, norme o misure definitive.

## Cosa deve fare Codex o Claude nel workspace privato

1. Confrontare il worker privato e i contratti generati prima di aggiungere import; non duplicare orchestratori.
2. Conservare il blocco `HSE_ADAPTER_UNAVAILABLE`. Il supervisore si può provare con fixture sintetiche senza autorizzare provider.
3. Ricostruire `staged` e `receipts` **dal server**, non da richieste del browser, verificando realmente accessi, hash, scope, risultati JSON e citazioni.
4. Applicare un gate transazionale su revisione del fascicolo e `runRevisionId`; registrare audit append-only, costo zero e nessun trasferimento esterno.
5. Non far passare output `not_applicable` come prova automatica di assenza del rischio; l'analisi resta soggetta a revisione tecnica.
6. Se tutte le fasi risultano complete, passare al **compositore già esistente** per la verifica delle citazioni e la revisione professionale, mantenendo D1/D2 e QA Word chiusi.
7. Se il codice risultasse ridondante rispetto a quello privato già realizzato, preferire la soluzione privata valida e mantenere questa PR come specifica di confronto: non servono due coordinatori in esecuzione.
8. La nuova fase non è un'autorizzazione a usare DUVRI 2026 in provider, né a inviare al gateway dati reali.

## Test

```bash
node --test tests/duvri-hse-agent-run-supervisor.test.js
```

**28 test sintetici** coprono: 3 agenti base, 12 agenti selezionati, dipendenze, coordinatore prematuro, risultati duplicati/esterni, richieste di chiarimento, output bloccati, SHA e revisione invalidi, attestazioni source/citation, spoofing dei permessi e dei campi, separazione privacy, assenza di dispatch e immutabilità del payload.

Nessun file Colligo, prompt reale, credenziale o documento cliente deve essere pubblicato. Prima di un eventuale merge sono obbligatori tutti i check GitHub sul commit esatto e la revisione dei tre file nuovi.
