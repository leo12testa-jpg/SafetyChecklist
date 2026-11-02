# COLLIGO DUVRI AI — Fonti autorizzate per lo screening HSE

**Stato:** modulo deterministico isolato, estratto dalla PR #28 per un rilascio indipendente. Non legge documenti, non effettua AI, non modifica SafetyChecklist online.

## Problema risolto

Il semplice caricamento di un file nel fascicolo non ne dimostra la leggibilità o l'ammissibilità come evidenza. Per un DUVRI tecnico non si può trattare un documento `pending`, un PDF illeggibile, uno ZIP, una foto non controllata o il risultato di un'analisi precedente come prova corrente. L'elenco dei file dell'intervento deve essere distinto dall'elenco delle **fonti verificate per lo screening**.

`js/duvri-hse-evidence-scope.js` aggiunge `buildHseEvidenceScope({jobId,analysisRevisionId,extractionRevisionId,files,extractions})`.

Il modulo applica in sequenza:

1. Controllo del fascicolo con `duvri-case-manifest.js` (una checklist DOCX, allegati, job ID identici, dimensioni, impronte e duplicati).
2. Lettura delle **attestazioni dell'estrattore backend**: `schema_version`, job e revisione analisi, revisione estrazione, file ID, hash del file sorgente, genere di evidenza, flag di validazione locator e flag di verifica backend.
3. Confronto del checksum esatto a 64 cifre, dello stato `parsed`, del medesimo `extractionRevisionId` del batch, dei ruoli e del tipo di documento. Le immagini richiedono `human_verified_image`: un OCR generico non equivale a verifica visuale.
4. Identificazione degli ID che possono essere proposti per il controllo HSE. Tutte le fonti `pending`, `unreadable`, ZIP/HEIC ed estrazioni non attestate sono escluse e restano nel fascicolo.
5. Stato `ready_for_hse_screening` soltanto quando **tutti** i file sono stati letti/verificati, la checklist e almeno un allegato hanno un'attestazione valida e nessun file resta in sospeso. In ogni altro caso `awaiting_extraction` oppure `blocked`.

Le attestazioni hanno questa forma, **con dati sintetici**:

```json
{
  "schema_version": "colligo-duvri-extraction-attestation/1.0",
  "job_id": "FASCICOLO_SYNTH_001",
  "analysis_revision_id": "ANALYSIS_SYNTH_001",
  "extraction_revision_id": "EXTRACTION_SYNTH_001",
  "file_id": "CHECKLIST_SYNTH_001",
  "source_sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "evidence_kind": "extracted_text",
  "source_locator_verified": true,
  "backend_verified": true
}
```

**Nota di sicurezza imprescindibile:** il backend di Codex dovrà produrre e recuperare queste attestazioni dalla persistenza autorizzata, dopo l'estrazione sul file privato, verificandone hash e identità. `backend_verified:true` non è una firma digitale e il validatore JS non autentica chi l'ha scritto. Non accettare mai l'oggetto direttamente dal browser o dall'output AI.

## Collegamento agli altri agenti

Il risultato contiene `allowed_file_ids`, `withheld_file_ids`, `manual_review_file_ids`, stato della checklist e codici bloccanti. Il worker può passarne gli `allowed_file_ids` a `normalizeSpecialtyScreening`, `aggregateEvidenceGated` e `validateAgentResult` **esclusivamente quando lo stato del fascicolo è `ready_for_hse_screening` e i dati derivano dal server**.

Questo modulo non conferma la correttezza di una valutazione HSE: `evidence_verified=false`, `human_review_required=true` e `issuance_allowed=false` anche quando tutte le estrazioni sono complete. La revisione delle conclusioni resta al tecnico. D1 e D2 restano separatamente bloccanti.

Non è consentito:

- sostituire fonti dell'intervento con DUVRI 2026 storici;
- escludere uno specialista per un `no` non confermato;
- fondare una valutazione su un allegato non ancora verificato;
- riutilizzare attestazioni dopo modifica di un file o variazione della revisione di analisi;
- inviare allegati reali a provider AI a pagamento senza approvazione aziendale.

## Collaudi

`tests/duvri-hse-evidence-scope.test.js` include **28 test sintetici** su checklist, foto, PDF, ZIP, duplicati, SHA, revisioni, autorizzazioni, privacy e compatibilità con lo screening.

Il modulo non modifica il frontend o il backend PR #21. L'uso nel worker sarà implementato da Codex, con controllo delle transazioni, ACL e provenienza delle attestazioni.

## Separazione delle tipologie di fonte HSE

Il contratto aggiornato `duvri-agent-contract.js`, il coordinatore e la pipeline richiedono **tre elenchi distinti**:

- `allowedFileIds`: solo checklist e documenti dell'incarico corrente restituiti da `buildHseEvidenceScope`.
- `allowedHistoricalReferenceIds`: solo ID opachi dei precedenti DUVRI 2026 restituiti dal catalogo privato verificato; `verification_status='historical_example_only'`.
- `allowedInternalRuleIds`: solo regole aziendali già approvate e autorizzate dal backend.

Gli ID non possono sovrapporsi fra elenchi; un precedente storico non può dichiararsi `current_job_document`, e una regola interna non costituisce un'evidenza di compresenza nel luogo dell'intervento. Un finding richiede **sempre almeno una fonte corrente**. Le liste storiche e le regole interne sono facoltative: se non vengono fornite, non esiste autorizzazione implicita.

Codex deve derivare ciascuna allowlist dal relativo archivio privato e non fidarsi degli ID ricevuti in una richiesta client. La compatibilità della nuova interfaccia è ancora da verificare con i test del ramo.

**Fail closed aggiuntivo:** `allowed_file_ids` è sempre vuoto quando lo stato è `awaiting_extraction`; un fascicolo incompleto non rilascia neppure una lista parziale di permessi HSE.
