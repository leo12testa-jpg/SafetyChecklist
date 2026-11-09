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

## Trigger online del worker (codice predisposto, NON attivo)

1. L'API privata Supabase `document-jobs` riceve il fascicolo e, soltanto con tutti i gate configurati, esegue il trigger HMAC di `backend/duvri/api/process.py` usando `job_id`, timestamp e firma SHA-256.
2. Il worker Python verifica HMAC e finestra anti-replay (120 secondi), preleva SOLO il fascicolo con l'ID richiesto, ricontrolla SHA-256 dei file originali, usa il motore privato V5 e il master Colligo verificato, quindi deposita `owner_uid/job_id/draft.docx`. L'esito è sempre una bozza **NON EMETTIBILE**.
3. `document-jobs?action=status` e `?action=list` consentono al tecnico autenticato di seguire e recuperare i fascicoli. `?action=download` restituisce il DOCX solo in stato `needs_review`, con digest corrispondente.
4. La UI mostra solo 2 caricamenti e il pulsante **Genera DUVRI**. Per le bozze precedenti è previsto un accesso al download autenticato, senza ricreare il lavoro.

**Gate da impostare soltanto dopo il collaudo completo**: `DUVRI_WORKER_ENDPOINT` (HTTPS /api/process), `DUVRI_WORKER_HMAC_KEY` (stessa chiave casuale privata da almeno 32 caratteri su worker e gateway), `DUVRI_WORKER_ENABLED=true` sul runtime Python, `DUVRI_PRIVATE_ENGINE_DIR` (codice V5 privato), `DUVRI_MASTER_PATH` (master ufficiale privato e con hash esatto), credenziali Supabase server ONLY nel worker, `DUVRI_INTAKE_ENABLED=true` sul gateway e infine `DOCUMENT_GENERATION_CLOUD_ENABLED=true` sul frontend.

Il modello Word e i documenti dei clienti non devono mai essere committati qui. Il repository `Colligo-DUVRI-Control` non è un repository del motore; mantenere invariato il suo perimetro. Non distribuire un endpoint Python senza isolamento e protezione delle credenziali.

**Limiti dell'attuale motore V5**: testo PDF selezionabile, DOCX, XLSX; foto e PDF scannerizzati restano da interpretare, le valutazioni interferenziali e le misure devono essere validate da HSE. DOC/XLS legacy e HEIC non sono ancora supportati nella pipeline online. Il solo fatto di avere un Word generato non implica che sia emettibile.

**Prove obbligatorie prima dell'uso reale**: E2E con checklist e allegati sintetici, firma valida/alterata/scaduta, due tecnici differenti, modifica byte del file a dimensione costante, master hash non corrispondente, interruzione del worker, download solo dell'owner, Word Desktop QA, revisione HSE e blocco emissione.
