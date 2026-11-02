# COLLIGO DUVRI AI — Revisione tecnica dei finding (isolata, proposta v1)

**Stato:** codice e test su ramo di sviluppo, non integrato nella SafetyChecklist pubblicata. Nessun documento reale e nessun provider AI coinvolto.

## Scopo

La fase di revisione deve distinguere tre concetti differenti:

1. **Analisi specialistica**: un agente propone una possibile interferenza e misure collegate a fonti del fascicolo corrente.
2. **Decisione del tecnico sulle proposte**: il tecnico può accettare *per la bozza*, respingere motivando, oppure chiedere modifiche.
3. **Approvazione del DUVRI finale**: processo separato, successivo, che richiederà il controllo del Word prodotto, metodologia del rischio ufficiale, verifiche normative e procedure Colligo.

Questa PR implementa soltanto la seconda fase in forma deterministica e isolata. **Non può emettere né approvare DUVRI.**

## File

- `js/duvri-hse-review.js`: costruisce un registro di decisioni senza persistenza.
- `tests/duvri-hse-review.test.js`: 18 test positivi e negativi.
- `tests/duvri-hse-end-to-end-isolated.test.js`: 6 test di passaggio sintetico fra archivio 2026, agente HSE, coordinatore e revisione.

## Requisiti del backend futuro

Il backend non deve fidarsi di `reviewerContext` se ricevuto dal browser. Deve invece:

- autenticare l'utente e verificare ruolo `tecnico` o `admin`, profilo attivo, appartenenza aziendale, permesso sulla commessa e competenza/abilitazione di revisione secondo le regole Colligo;
- recuperare dal database privato il pacchetto di analisi **immutabile** e la revisione DOCX corrente, collegati al fascicolo;
- ricavare `job_id`, `reviewer_id` e `document_revision_id` sul server;
- verificare che la revisione non sia stata superata da una generazione più recente, usando transazioni/versioni per prevenire modifiche concorrenti;
- salvare decisioni, motivazioni e timestamp in un registro di audit protetto, senza sovrascrivere lo storico;
- garantire idempotenza al retry e accesso per fascicolo;
- non considerare `draft_findings_reviewed` un'autorizzazione a generare o emettere un documento ufficiale.

## Stati possibili

| Stato | Significato |
| --- | --- |
| `blocked` | Input incompleto/non autorizzato, pacchetto con conflitti, finding ancora da chiarire, revisione mancante o assenza di determinazione tecnica quando non ci sono finding |
| `awaiting_decisions` | Il tecnico non ha ancora espresso una decisione su tutte le valutazioni proposte |
| `changes_requested` | È stata registrata almeno una richiesta di modifica; il redattore non deve considerare concluse le verifiche |
| `draft_findings_reviewed` | Tutti i finding sono stati accettati per la bozza o esplicitamente respinti, con motivazione; il DUVRI resta da validare |

Sempre: `duvri_approved=false` e `issuance_allowed=false`.

## Esempio sintetico

```js
const { prepareReviewDecisions } = require('./js/duvri-hse-review.js');
const result = prepareReviewDecisions({
  packet: savedPacketFromTrustedBackend,
  decisions: [{
    agent_id: 'lavori_quota',
    finding_id: 'F-001',
    action: 'request_changes',
    note: 'Chiarire eventuale presenza di terzi sotto l area di lavoro'
  }],
  reviewerContext: trustedContextFromAuthenticatedBackend
});
```

Le variabili nell'esempio sono simboliche; non è una chiamata già disponibile nella UI.

## Compiti ancora necessari prima del prodotto

- Confrontare questo contratto con la struttura del backend DUVRI della PR #21 e l'eventuale coordinatore COIN.
- Decidere D1 (scala del rischio e criteri) con il responsabile tecnico.
- Completare D2 (adattatore Word e validazione visiva sul modello Colligo reale) con Claude Code.
- Integrare autenticazione, controllo dei permessi, database e audit trail nel servizio backend.
- Preparare una UI per le tre decisioni su ogni finding e indicare esattamente le fonti.
- Implementare separatamente la procedura aziendale di approvazione ed emissione.
- Testare con dati sintetici prima di qualsiasi test autorizzato su documenti reali.

## Controlli automatici

```bash
node --test tests/duvri-hse-review.test.js tests/duvri-hse-end-to-end-isolated.test.js
```

Nessuna modifica alla produzione; tenere la PR in bozza fino a CI verde, revisione e allineamento con Claude.
