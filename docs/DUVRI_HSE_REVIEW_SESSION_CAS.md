# COLLIGO DUVRI AI — Revisione HSE vincolata a fascicolo, revisioni e fonti

**Stato:** libreria deterministica isolata. Nessuna UI nuova, nessuna richiesta AI, nessuna modifica al template Word o al backend distribuito. Progettata per l'integrazione Codex quando il worker privato sarà disponibile.

## Moduli

- `js/duvri-hse-review.js`: permette al tecnico HSE di **accettare per la bozza**, **respingere motivando** o **richiedere modifiche motivando** ogni finding. Se il pacchetto contiene conflitti, screening non concluso, agenti mancanti o informazioni critiche, la revisione viene bloccata. Nessuna azione può approvare/emetter il DUVRI.
- `js/duvri-hse-review-session.js`: aggiunge un secondo controllo prima di registrare decisioni. Tutti i seguenti valori devono riferirsi alla **medesima versione corrente** del fascicolo:
  - `job_id`;
  - `analysis_revision_id`;
  - `extraction_revision_id`;
  - `packet_revision_id` e SHA-256 del pacchetto di risultati;
  - `document_revision_id` del Word in bozza;
  - `reviewer_id` con permessi verificati lato server.
- `tests/duvri-hse-review-session.test.js`: 32 casi sintetici su pacchetti cambiati, revisioni obsolete, documenti di altri fascicoli, fonti correnti non confermate, storici, regole, rifiuti, chiarimenti, idempotenza logica, blocchi e riservatezza.

## Contratto per Codex: origine affidabile dei dati

Il worker Supabase/Postgres deve autenticare l'utente, confermare ruolo tecnico/admin e autorizzazione alla commessa, leggere **dal server** il pacchetto HSE e i documenti. Deve ricostruire e controllare il digest SHA-256 del pacchetto in una serializzazione canonica definita e immutabile e assicurarsi che sia riferito alle revisioni correnti. Non basta che un oggetto proveniente dal browser abbia `packet_sha256_verified: true`.

Il backend deve caricare `sourceScope` già verificato, con `state === ready_for_hse_screening`. Non devono esistere file in attesa di estrazione o revisione manuale; la lista di file autorizzati non può essere parziale. I precedenti 2026 hanno una allowlist **separata** da quella delle evidenze correnti; le regole interne approvate ne hanno una terza.

Per le decisioni `accept_for_draft` è obbligatoria almeno un'evidenza dell'incarico **corrente e confermata**. Uno storico o una regola interna da soli non dimostrano un'interferenza nel sito. Gli interventi respinti richiedono motivazione; la risoluzione dei finding respinti è valutata separatamente dal gate DUVRI.

Le decisioni devono essere salvate con transazione DB e condizione di concorrenza (CAS/lock) sul packet/document revision. I retry devono essere idempotenti, con `review_request_id` univoco ed eventi di audit e append-only: il solo controllo JS non garantisce persistenza, concorrenza, immutabilità o correttezza tecnica.

### Integrazione futura con l'interfaccia

Per ogni finding il tecnico dovrebbe visualizzare:
- scenario di interferenza, fase, esposti e misure proposte;
- sorgente, file ID, paragrafo/pagina, stato di verifica;
- tre azioni: **Accetta per bozza**, **Richiedi modifica**, **Respingi**, con nota obbligatoria sulle ultime due.

Renderizzare il contenuto delle fonti solo come **testo**, mai come HTML. Nascondere o bloccare la revisione quando il backend comunica un fascicolo incompleto. Anche dopo tutte le decisioni, l'output resta `duvri_approved=false` e `issuance_allowed=false`.

## D1/D2 e modello

Il rapporto Word riferito da Codex (121 test, 27/27 mutazioni) non è un'approvazione del modello né del metodo di rischio. La mappatura dei 22 segmenti, i 27 commenti e l'identità del template ufficiale devono essere approvati e verificati dal backend. Nessun test in questa PR genera, firma o emette documenti Word.

## Privacy

Codice e test contengono soltanto dati artificiali. **Non inserire** il contenuto del Word Colligo, fotografie, checklist reali, nomi cliente, documenti della intranet, token o credenziali nel repository pubblico.

## Gate merge

Il merge di questo componente può avvenire solo dopo tutti i controlli GitHub verdi. L'integrazione reale nel worker e nell'interfaccia richiederà una modifica separata con test di permessi, RLS, riservatezza, concorrenza e revisione umana.
