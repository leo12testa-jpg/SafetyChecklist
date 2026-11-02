# Release HSE isolata: provenienza documentale e screening specialistico

## Che cosa viene effettivamente integrato

Questa modifica non attiva il generatore DUVRI e non cambia le schermate SafetyChecklist.

- `js/duvri-hse-evidence-scope.js`: parte dal contratto di fascicolo `duvri-case-manifest.js` già pubblicato, verifica la coerenza di `job_id`, `analysis_revision_id`, `extraction_revision_id`, impronta SHA-256 completa, stato di lettura e attestazioni dell'estrattore. Mantiene PDF illeggibili, ZIP, HEIC e fonti non attestate fuori dall'insieme utilizzabile.
- `js/duvri-hse-screening.js`: struttura risposte `yes/no/unknown` per gli agenti specialistici. Non trasforma un "no" incerto in esclusione automatica; non accetta risposte sì/no senza citare fonti ammesse.
- `tests/duvri-hse-evidence-scope.test.js` e `tests/duvri-hse-screening.test.js`: 43 test sintetici, senza accesso a Firebase/Supabase o alle informazioni dei clienti.

## Contratto per Codex

Codex, nel worker documentale privato, dovrà:
1. Autenticare l'utente, verificare tenant/ruolo/fascicolo e leggere file *e attestazioni* da storage privato, non dalla richiesta browser o dalla risposta di un agente AI.
2. Ricalcolare realmente lo SHA-256 sui byte del file verificato. Non trattare `backend_verified: true` come una firma o un'attestazione affidabile quando il flag arriva dal client.
3. Creare o recuperare una sola revisione di estrazione corrente per la revisione di analisi.
4. Invocare `buildHseEvidenceScope`; usare `allowed_file_ids` per lo screening successivo **soltanto se `state === 'ready_for_hse_screening'`**.
5. Passare gli ID ammessi a `normalizeSpecialtyScreening`, non direttamente a un prompt non validato. Il controllo di autorizzazione reale resta sempre del backend.
6. Non trasmettere documenti sensibili a servizi AI esterni finché non autorizzati da Colligo.

**Limite:** le attestazioni di estrazione descrivono la lavorazione documentale, non dimostrano la correttezza tecnica delle informazioni. Tutti i risultati impongono revisione umana e `issuance_allowed=false`.

## Compatibilità con i tre lavori

- **Claude/Codex Word D2:** indipendente, nessuna modifica ai file originali, nessun generatore DOCX alternativo.
- **Codex backend PR #21:** worker non incluso né deployato; questo è il contratto JS da importare in ambiente server autorizzato.
- **ChatGPT agenti PR #28:** coordinatore e pacchetto risultati restano sperimentali; nel merge futuro riconciliare i due file già estratti invece di duplicarli.
- **Colligo D1:** nessuna scala rischio o regola normativa viene approvata implicitamente.

## Gate prima del merge

Eseguire la suite Node completa, storage/security gate, controlli browser isolati e verificare che `index.html`, `js/app.js`, le checklist preesistenti e le migrazioni produzione non cambino. I test isolati non equivalgono a un collaudo professionale HSE.
