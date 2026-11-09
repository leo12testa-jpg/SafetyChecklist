# DUVRI online — coda documentale privata

Questa componente è **soltanto l'acquisizione cloud**; NON è il compilatore Word e NON rappresenta un DUVRI emettibile.

- Utenti: autenticazione Firebase esistente (account attivo, ruolo tecnico/admin), verificata da Google e dal profilo Firestore.
- Documento: checklist DOCX + allegati DOCX/PDF/XLSX/XLS/PNG/JPG/TXT/CSV; fino a 12 file, massimo 45 MiB complessivi e 15 MiB per file.
- Storage: bucket `colligo-duvri-private` rigorosamente privato, creato tramite Storage API. Nessun URL pubblico, nessuna policy di accesso diretto al bucket per gli utenti.
- Database: `public.duvri_jobs` e `public.duvri_job_files` hanno RLS abilitata e nessun grant diretto ad anon/authenticated. La funzione usa service_role **solo dopo** l'autenticazione e i controlli sull'owner.
- Endpoint: `POST ?action=create` (manifest/request_id), `POST ?action=upload&job=...&slot=...` (bytes), `POST ?action=finalize&job=...`, `GET ?action=status&job=...`. La risposta non presume mai che un DUVRI sia stato generato.
- Sicurezza: `DUVRI_INTAKE_ENABLED` deve essere esattamente `true` o ogni chiamata applicativa viene rifiutata. Il flag resterà OFF finché non esisteranno worker privato, download DOCX autorizzato, QA e collaudo integrato.
- Worker: ancora da distribuire come componente Python dedicato usando `duvri_draft.py`, `source_intake.py` e il master privato. Non committare il master, documenti clienti, fatture, credenziali o output liberi AI nel GitHub pubblico.

**Uso finale previsto:** SafetyChecklist → checklist + allegati → Genera DUVRI → fascicolo privato → worker Word → download BOZZA da revisionare HSE. Mai firmare o emettere automaticamente.

Non pubblicare il codice proprietario del compilatore nel repository pubblico. Va trasferito in un repository dedicato privato quando disponibile.
