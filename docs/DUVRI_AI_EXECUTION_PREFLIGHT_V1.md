# Colligo DUVRI AI — preflight per specialisti AI reali (v1)

**Stato: modulo di controllo preventivo isolato e inattivo.** Nessun provider configurato, nessuna chiamata AI, nessun accesso dati cliente, nessuna chiave, nessun costo, nessuna modifica dell'interfaccia o del documento Word.

## Funzione

Il futuro backend privato userà `js/duvri-ai-execution-preflight.js` per verificare **metadati lato server** prima di proporre una richiesta di esecuzione degli specialisti HSE.

Controlli richiesti:
- Fascicolo e revisioni di analisi/estrazione corrispondenti ai dati nel server.
- Solo fonti complete e autorizzate: checklist pronta, nessun allegato trattenuto, OCR confermato secondo il backend.
- Screening specialisti completo: risposte `yes/no/unknown` e lista degli agenti esattamente coerente con il contratto HSE. `unknown` o segnali mancanti impediscono l'esecuzione.
- Provider, modello, regione e revisione di configurazione corrispondenti all'approvazione.
- Autorizzazione organizzativa sul fascicolo, trattamento dati cliente, termini del provider, conservazione, area geografica, revisione professionale HSE.
- Budget approvato con tariffario versionato, stima verificata, costo massimo autorizzato e saldo residuo sufficiente per commessa e organizzazione.
- Gateway privato: endpoint ammesso, credenziali server, isolamento uscita, minimizzazione documenti e audit.

## Risultati possibili

- `blocked` con codice non sensibile.
- `preflight_passed_pending_gateway_review`: **valutazione preliminare senza alcun permesso di esecuzione**.

In qualsiasi caso tutti questi campi restano `false`: `provider_dispatch_allowed`, `external_data_transfer_allowed`, `document_draft_allowed`, `issuance_allowed`.

La funzione non esegue API né certifica approvazioni reali. Un `true` inviato da browser, modello AI o file cliente non è mai una prova di autorizzazione. Ricalcolare e verificare le approvazioni nel backend.

## Handoff Codex / Claude Code

1. Controllare il backend locale **prima** di integrare; se è presente un gateway equivalente, confrontare i contratti evitando doppioni.
2. Autenticare operatore, verificare tenant/ruolo/fascicolo, tutte le estrazioni e il digest dei documenti.
3. Ottenere l'approvazione aziendale da un archivio firmato/versionato, con poteri verificati, distinguendo la licenza d'uso del provider dall'autorizzazione sui dati di ciascun cliente.
4. Valutare contratti privacy, conservazione, regione e costo di utilizzo del provider. I piani Claude Code e ChatGPT non equivalgono ad accesso API illimitato o autorizzato.
5. Stimare il costo con tariffario e versione modello reali. Riservare il budget in transazione atomica con controllo concorrenza; applicare quote e rate limit effettivi.
6. Se la policy di esecuzione sarà approvata, implementare separatamente **una verifica indipendente, al momento dell'invio**, con autorizzazioni correnti, egress controllato, audit append-only e limiti lato gateway. Il preflight non è una capability.
7. Inviare soltanto fonti indispensabili, rifiutare prompt injection dai documenti, validare ogni output con `duvri-agent-contract.js` e tracciare le revisioni.
8. Non impostare `DOCUMENT_GENERATION_CLOUD_ENABLED=true` né attivare API senza consenso espresso dell'utente e autorizzazione Colligo. D1/D2 e revisione tecnica restano obbligatorie.

## Test e limiti

`node --test tests/duvri-ai-execution-preflight.test.js`

Casi sintetici: fascicoli incrociati, revisioni obsolete, allegati incompleti, screening incerto, agenti mancanti, autorizzazioni non pertinenti, privacy non approvata, modello/regione non coincidenti, budget insufficiente, gateway non sicuro, input inattesi con segreti e immutabilità.

Il modulo non sostituisce una valutazione di conformità privacy, audit, controllo accessi o sicurezza del provider. Non prende decisioni di rischio interferenziale e non consente l'emissione del DUVRI.
