# Colligo DUVRI — registro revisioni umane di tutte le pagine Word

**Stato:** modulo di preflight **puramente deterministico**, senza accesso al DOCX, alle immagini, al database, all'identità reale dei revisori o all'emissione. Non è la verifica umana e **non approva** il documento.

## Problema risolto

Il pilota tecnico A locale produce una bozza Word di 30 pagine con dicitura `BOZZA SINTETICA – NON EMETTIBILE – NON APPROVATA`. Il rendering, gli hash e la presenza della dicitura risultano verificati in prova secondo Codex, ma **la revisione visuale umana delle 30 pagine non è ancora stata eseguita**. La PR #55 verifica l'integrità di un insieme di PNG, non la lettura umana delle pagine. Un check visivo svolto su un DOCX più vecchio non deve diventare valido per uno nuovo.

## Nuovo contratto

`js/duvri-word-human-review-ledger.js` esporta `assess({trustedContext,pageReviews})`.

`trustedContext` deve provenire **esclusivamente dal backend privato autorizzato**, non da browser/LLM: fascicolo, revisione DOCX e SHA corrente, render_run_id corrente, revisione registro e pagine con SHA; identity/role dell'operatore che ha generato e del revisore HSE, autorizzazioni, prove di integrità del manifest e **verifica indipendente del numero delle pagine**. I flag `backend_loaded_verified_manifest`, `rendered_page_integrity_verified`, `render_provenance_verified` e `page_count_independently_verified` sono **asserzioni da controllare tramite storage/server**: questa libreria non può autenticare da sola un booleano.

`pageReviews` deve essere caricato dal backend come snapshot immutabile del registro transazionale. È un array ordinato e completo di `page_count` elementi, uno per pagina, schema `colligo-duvri-word-human-page-review/1.0`:

- `job_id`, `draft_revision_id`, `render_run_id`, `review_ledger_revision_id`, `page_number`, `page_sha256`;
- `reviewer_id` e `reviewer_role`, coerenti con il contesto server;
- `decision`: `pass`, `fail` oppure `pending`;
- `checks`: **sei flag** `page_legible`, `header_footer_correct`, `tables_unclipped`, `no_text_overflow`, `non_emittable_label_visible`, `content_and_order_checked`;
- `issue_codes`: soltanto codici di problema predefiniti, mai testi o dati cliente.

Per `pass` tutti i flag devono essere `true`, senza problemi; per `pending` tutti devono essere `null`; per `fail` almeno un flag deve essere `false` con uno o più codici di problema. Il modulo rifiuta pagine mancanti, duplicate/scambiate, hash non concordi, revisioni obsolete, ruolo non consentito, revisore coincidente con il generatore, controlli incompleti, campi aggiuntivi in una review.

### Stati restituiti

- `blocked`: input non valido, non autenticato o non corrente (nessun dato cliente nell'output);
- `awaiting_human_page_review`: una o più pagine sono ancora `pending`;
- `needs_visual_correction`: almeno una pagina è `fail`, richiede correzione e invalidazione review;
- `all_page_reviews_recorded_for_private_qa`: ogni pagina ha un `pass` coerente, ma **non è ancora la firma QA**.

**In tutti gli stati:** `visual_qa_approved=false`, `d1_approved=false`, `d2_approved=false`, `ready_for_issuance=false`, `issuance_allowed=false`. Neppure 30/30 `pass` abilita una bozza ufficiale.

## Handoff al backend Codex/Claude

1. Recuperare il DOCX effettivamente generato e verificare SHA/immutabilità, il manifest e le immagini tramite PR #52, #54, #55. Se il Word cambia anche di un byte, **invalidare render e tutte le revisioni umane**.
2. Salvare il registro privato nel database con **RLS/ACL**, reviewer autenticato lato server, sessione fresca, CAS su `review_ledger_revision_id`, audit append-only, timestamp generato server e idempotenza. Le sei risposte per pagina devono essere immesse e controllate realmente da una persona competente.
3. Verificare che `reviewer_id` sia distinto da `generator_id`. Se questo non è possibile per ragioni organizzative, non autocertificare indipendenza: marcare come verifica da confermare dal responsabile e bloccare l'attestato.
4. Prima di valutare lo snapshot, richiedere **prova interna del renderer**, conteggio Word/PDF uguale e manifest PNG ricalcolato dal backend, senza usare manifest o booleani dal browser.
5. Chiamare `assess` come **solo controllo di coerenza** prima di un'eventuale firma QA separata e con permessi superiori.
6. Un `fail` richiede correzione della copia DOCX e una nuova revisione; non riutilizzare attestazioni della versione precedente.
7. **Non creare o mostrare un pulsante di approvazione/emissione finale** sulla base dell'output del modulo. D1, D2 e tutti i controlli professionali restano separati.
8. Non condividere PDF, PNG delle 30 pagine, verbali privati, SHA o nomi clienti su GitHub.

## Test

```bash
node --test tests/duvri-word-human-review-ledger.test.js
```

**25 scenari sintetici**: 30/30 registrate ma senza emissione, 30 `pending`, singola pagina `fail`, pagine mancanti/duplicate/scambiate, file e revisioni nuove, immagine alterata, revisore non indipendente, permessi mancanti, attestation non verificata, flag non compilati, duplicazione/forgery di issue code, input malformati, privacy del risultato, 1/2/47/150 pagine e immutabilità del payload.

Questi test validano **la logica del contratto**, non la qualità visiva di un DOCX aziendale. L'attestazione professionale deve rimanere in un flusso distinto e verificato dal server.
