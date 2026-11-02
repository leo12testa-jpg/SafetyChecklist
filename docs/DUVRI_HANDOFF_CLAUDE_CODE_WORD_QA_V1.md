# COLLIGO DUVRI AI — Contratto di consegna Word da Claude Code a SafetyChecklist (D2)

**Stato:** schema tecnico di interfaccia e test **isolati**, nessun accesso automatico al PC aziendale o ai file del cliente. Il solo generatore Word ufficiale resta sotto la responsabilità del lavoro locale di Claude Code.

## Problema

Claude sta controllando il vero `DUVRI_BASE_GENERALE_2026.docx`. La copia del modello, senza sostituzioni, conserva la struttura; il mapping dei 22 segmenti e le 27 decisioni editoriali sono ancora da confermare dal tecnico. SafetyChecklist non deve ricevere un semplice «OK» e supporre che il documento sia pronto.

L'adattatore `js/duvri-word-qa-handoff.js` definisce un report **solo di metadati**, che non contiene intestazioni dei clienti, testo delle clausole, percorsi locali, screenshot o documenti originali.

## Formato proposto per Claude

Ogni rapporto `colligo-word-qa-local/1.0` deve specificare:
- `job_id`, `template_version`, `mapping_revision_id`, `document_revision_id` e `qa_document_revision_id`;
- `source_sha256`, `output_sha256`, `qa_output_sha256` **completi**, calcolati sui byte effettivi dei file in locale;
- `yellow_segments_total=22`, `yellow_segments_populated`, `yellow_segments_not_applicable`, `yellow_segments_human_verified`, `yellow_segments_unresolved`;
- `editorial_comments_total=27`, `editorial_comments_reviewed`, `editorial_comments_unresolved`;
- attestazioni booleane `source_unchanged`, `populated_output_created`, `structural_qa_passed`, `visual_qa_after_population_passed`, `fixed_content_unchanged`, `sections_tables_headers_verified`, `editorial_rules_verified`, `editorial_comments_removed_or_approved`, `signature_fields_identified`, `signatures_verified_blank`, `risk_tables_reviewed` e `risk_rows_source_mapped`.

**Le impronte non sono segreti**, ma non dimostrano da sole la provenienza: il backend futuro le deve ricalcolare confrontandole con i file e con un manifest di modello approvato. Non usare il solo prefisso `69B2F63C…` per sostituire il valore completo. I dati identificativi/reali non devono essere inseriti nei test o nella PR.

## Regole applicate

- Un rapporto senza uno dei campi previsti, con campi aggiuntivi o identificatori di altra revisione viene respinto.
- Una bozza non realmente popolata non può essere considerata pronta anche se il rendering della copia vuota è visivamente identico.
- Commenti irrisolti, firme non identificate, tabelle dei rischi non mappate o SHA diversi fra documento compilato e documento QA mantengono `needs_claude_review`.
- `qa_report_complete` indica **solo completezza apparente del rapporto Word**, non autorizzazione all'emissione o approvazione tecnica.
- `ready_for_technical_preflight=false`, `duvri_approved=false`, `issuance_allowed=false` **sempre**: SafetyChecklist deve controllare separatamente permessi aziendali, report verificato dal backend, mappatura approvata, D1, evidenze attuali e HSE.
- Non lasciare che un flag `true` generato dall'AI o dal browser venga trattato come un'attestazione affidabile. La fonte deve essere il servizio locale di QA che ha realmente analizzato il Word, e il backend deve validare la provenienza.

## Output dell'adattatore

`normalize(...)` restituisce `population`, `editorial`, `docx` e `risk_table_layout`, coerenti con i blocchi di `duvri-readiness-bridge.js`. La trasformazione in attestazioni affidabili deve avvenire separatamente e solo dopo verifica di permessi e hash reali.

Il report NON include la decisione metodologica D1: `risk_table_layout.method_D1_approved=false` per definizione. L'approvazione della metodologia viene da Colligo, non dal generatore Word.

## Esempio senza dati cliente

```js
const {normalize}=require('./js/duvri-word-qa-handoff.js');
const report = normalize({
  jobId: 'FASCICOLO_SYNTH_001',
  templateVersion: 'DUVRI_BASE_GENERALE_2026',
  mappingRevisionId: 'MAPPING_SYNTH_001',
  documentRevisionId: 'DOCX_REV_SYNTH_001',
  report: validatedLocalQaMetadata
});
```

`validatedLocalQaMetadata` rappresenta un rapporto generato e verificato **lato backend**: non è una variabile già collegata all'interfaccia online.

## Lavoro in parallelo

- **Claude Code**: prepara mapping reale e report QA locale, revisionato sul Word originale, senza modificare PR #28.
- **ChatGPT / SafetyChecklist**: gestisce ingestione nel fascicolo, contratto di output specialisti, verifica provenienza, aggregazione HSE e interfaccia backend senza duplicare il compilatore OOXML.
- **Tecnico Colligo**: approva i campi ambigui, commenti, firme, matrici rischio e l'emissione finale.
- **D1**: resta bloccato finché non viene presa una decisione aziendale formale.

## Test

`node --test tests/duvri-word-qa-handoff.test.js` — 16 test esclusivamente sintetici.

Nessun caricamento di modelli reali o documenti riservati in GitHub. Non unire questo componente alla produzione finché il report reale non è disponibile e verificato.
