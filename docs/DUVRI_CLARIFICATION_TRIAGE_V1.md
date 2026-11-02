# DUVRI AI — Instradamento chiarimenti da parte del tecnico (v1)

**Stato: modulo isolato e inattivo.** Nessuna chiamata AI, invio email, accesso a dati cliente, Word, API, backend o schermata pubblica. Non risolve automaticamente un rischio interferenziale.

## Funzionalità

A valle di un registro `colligo-duvri-clarification-register/1.0` **valido** il tecnico autorizzato può predisporre l'instradamento di ogni richiesta:

- `ask_client`: proposta da rivolgere al cliente **solo dopo revisione umana e invio separato esplicito**;
- `investigate_internally`: ricerca documentale o verifica tecnica interna con motivazione obbligatoria;
- `hold_for_reanalysis`: attesa di nuove informazioni, con motivazione obbligatoria.

**Non è prevista l'azione «risolvi», «scarta», «approva» o «invia».** Anche quando ogni richiesta ha una destinazione, rimane una domanda aperta finché nuove fonti e revisioni non siano state effettivamente validate. `client_dispatch_allowed=false`, `clarifications_resolved=false`, `ready_for_technical_preflight=false`, `duvri_approved=false` e `issuance_allowed=false` in ogni risposta.

L'output contiene soltanto ID e stati, mai testi delle domande o note del revisore. Il backend privato conserva le motivazioni e presenta i testi originali del registro con escaping HTML.

## Contratto per Codex / Claude Code

Usare `js/duvri-clarification-triage.js` **soltanto dopo** aver verificato su server:

1. Identità e ruolo tecnico/admin, permesso di accesso al fascicolo e revisioni correnti di fascicolo, analisi, estrazione e registro.
2. Integrità del registro: SHA-256 **dei suoi byte canonici** ricalcolato dal backend e confrontato con la versione immutabile corrente. Non fidarsi del solo flag `register_sha256_verified=true`; questa libreria non calcola un digest.
3. Autorizzazione dei file e delle fonti nell'analisi che ha prodotto il registro; non accettare registri o decisioni direttamente dal browser/LLM.
4. Persistenza delle scelte tramite transazione DB, controllo di concorrenza (CAS) su revisioni e digest, richiesta idempotente e audit append-only. Nessuna persistenza implementata qui.
5. Nessun auto-invio delle richieste al cliente; prevedere in futuro un passaggio di composizione/approvazione umana distinto e autorizzato.
6. Nuova checklist, allegato, estrazione, risposta o revisione: invalidare le rotte precedenti quando cambia il registro o qualsiasi dipendenza. Rieseguire screening e verifica HSE prima di poter considerare risolte le richieste.

Parametri di `prepareRouting`: `register`, `decisions`, `reviewerContext` e gli ID attuali `expectedJobId`, `expectedAnalysisRevisionId`, `expectedExtractionRevisionId`, `expectedRegisterRevisionId`. Il contesto verificato contiene le revisioni, `register_sha256`, `current_register_sha256`, `register_sha256_verified`, `authenticated`, `can_triage`, `reviewer_id` e `role`. I digest devono essere confermati **indipendentemente** dal backend, mai valorizzati da input client.

Formato singola decisione:

~~~json
{"request_id":"REQ_0001","route":"investigate_internally","note":"Controllo interno sintetico necessario"}
~~~

Stati di risposta: `blocked`, `awaiting_routing_decisions`, `routing_reviewed`, `no_open_requests`. Nessuno degli stati implica risoluzione, documento pronto o licenza di invio. La revisione tecnico-legale di D1, D2 e del Word resta fuori da questa libreria.

## Test

`node --test tests/duvri-clarification-triage.test.js`

Casi sintetici: commessa/revisioni obsolete, digest mancante/alterato, utente non abilitato, richieste non note o duplicate, motivazioni mancanti, conteggi incoerenti, assenza di dati personali in output, nessun invio/approvazione e nessuna mutazione dei parametri.

**Riservatezza:** repository pubblico: non caricare quesiti, allegati, foto, master Word o commenti Colligo, risposte reali del cliente o credenziali.
