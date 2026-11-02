# COLLIGO DUVRI AI — Registro integrazioni HSE (bozza interna)

**Stato:** modulo isolato e deterministico. Nessun upload, invio email, accesso AI, backend, Word o deploy di nuove schermate.

## Scopo

Dopo la lettura verificata della checklist Word del cliente e degli allegati, gli specialisti HSE possono restituire:
- informazioni mancanti, bloccanti o meno;
- contraddizioni tra documenti della **commessa attuale**;
- ambiti specialistici con risposta `unknown` / fonte non confermata;
- findings con `requires_clarification`.

`js/duvri-clarification-register.js` raccoglie queste **richieste in un registro interno da sottoporre al tecnico**, senza sintetizzare risposte mancanti o mascherare incongruenze. L'output non è pronto per l'invio al cliente.

## Flusso futuro lato backend privato

1. Caricare il fascicolo, le attestazioni di estrazione e le versioni correnti da storage privato autenticato. Mai utilizzare direttamente i metadati inviati dal browser o da un agente.
2. Eseguire `buildHseEvidenceScope` e proseguire solo con `ready_for_hse_screening` e nessun file trattenuto.
3. Eseguire la pipeline `aggregateEvidenceGated`; se l'output è `blocked`, correggere prima gli agenti o le fonti. Il registro non serve a bypassare gli errori.
4. Invocare `buildClarificationRegister` con il pacchetto HSE, lo scope e gli identificativi **attuali** di fascicolo, revisione analisi ed estrazione letti dal server.
5. Mostrare le proposte in un'area **solo tecnica** con rendering testuale sicuro (non `innerHTML`). Conservare la provenienza e la distinzione tra dato, ipotesi e punto da chiarire.
6. Il tecnico decide quali domande destinare al cliente, quali affrontare internamente e quali scartare motivatamente. Nessun invio né chiusura automatica.
7. Quando arrivano integrazioni nuove, il backend deve creare nuove revisioni di estrazione/analisi, rivalidare tutte le evidenze e **invalidare** registro, decisioni e bozza precedenti prima di ripetere l'analisi.

## Stati e garanzie

- `blocked`: metadati invalidi, revisione errata, agente mancante, fonti parziali o illegittime; nessun contenuto di domanda in uscita.
- `needs_technical_triage`: esistono domande da controllare, con un ID opaco di richiesta, tipo, agente e riferimenti a fonti correnti. Non implica invio al cliente.
- `no_open_requests`: l'analisi non mostra domande aperte; **non equivale** a DUVRI conforme, approvato o emettibile.

`issuance_allowed=false`, `ready_for_technical_preflight=false` e `client_dispatch_allowed=false` in **tutti** gli stati. Se un'analisi è `awaiting_input` ma non contiene alcuna domanda tracciabile, il registro rifiuta l'input.

I riferimenti a fonti contraddittorie includono solo ID file, localizzatore e stato di verifica. Il registro non ripubblica gli estratti, i nomi dei clienti o il contenuto del documento nel repository; le frasi suggerite da un agente restano dati non attendibili da visualizzare come testo semplice.

## Non confondere con Codex

Codex continua a lavorare **sul PC aziendale** per il modello Word ufficiale, mapping dei 22 segmenti gialli, 27 commenti, firma e tabelle, QA visivo/OOXML, risoluzione D2. Questo modulo non tocca quei file né la PR sperimentale #28.

Il metodo di valutazione rischi **D1** resta da approvare; l'identificazione SHA-256 completo del master Word e il collaudo su un modello realmente compilato restano obbligatori. Nessuna integrazione tecnica può rendere automaticamente il DUVRI emettibile senza autorizzazioni aziendali e revisione professionale.

## Test

```bash
node --test tests/duvri-clarification-register.test.js
node --test tests/*.test.js
```

Test esclusivamente sintetici: mismatch di commessa/revisioni, file bloccati, agente mancante, contraddizioni con provenienza, esclusione di esempi storici, deduplicazione degli screening e assenza di autorizzazione all'emissione.
