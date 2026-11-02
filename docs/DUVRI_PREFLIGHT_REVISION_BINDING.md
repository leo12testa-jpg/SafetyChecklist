# COLLIGO DUVRI AI — Preflight finale legato alle revisioni (prototipo isolato)

**Branch:** `feat/duvri-hse-agent-contract-v1`, PR #28. Nessun file Word reale, nessuna API AI, nessuna migrazione, nessun deploy.

## Problema che risolve

Un controllo positivo isolato non basta a rendere il DUVRI revisionabile: ad esempio una mappatura approvata per il modello 2026 potrebbe essere applicata a una **bozza diversa**, o le decisioni HSE potrebbero essere relative a un'analisi **superata** dopo nuovi allegati.

Il nuovo `js/duvri-readiness-bridge.js` verifica la coerenza **congiunta** di:

1. Fascicolo: `jobId`, `analysisRevisionId`, `documentRevisionId`.
2. Modello: versionato e validato mediante manifest privato approvato. Il solo hash noto in chat è il prefisso `69B2F63C…`; il backend deve ricalcolare e controllare l'impronta SHA-256 completa.
3. Mappatura: 22 segmenti gialli gestiti dal validatore `duvri-yellow-field-map.js`, tutti revisionati; eventuali `not_applicable` esplicitamente approvati.
4. Compilazione effettiva: `population.actual_populated` e `population.actual_not_applicable` devono corrispondere alla mappatura e alla **revisione del DOCX corrente**.
5. Report QA sul documento: identità della revisione, checksum di output verificato, confronto strutturale/visivo eseguito **dopo la compilazione**; firme e commenti gestiti.
6. Revisione delle interferenze: lo stato del registro di decisioni deve essere `draft_findings_reviewed`, senza decisioni pendenti, e riferito esattamente alla stessa revisione di analisi e documento.
7. Eventuali interferenze **respinte**: prima del preflight vanno risolte tramite una decisione tecnica distinta, per evitare di cancellare inconsapevolmente un rischio reale.
8. Metodologia D1 e tabelle rischio: rimangono bloccanti senza approvazione aziendale e tracciabilità, anche se tutto il resto è corretto.

## Output

`assessTechnicalPreflight(...)` restituisce:

- `blocked`, con motivi `REVISION`, `MAPPING`, `POPULATION`, `DOCX_REVISION`, `REVIEW_REVISION`, `REJECTED_FINDINGS`, `EVIDENCE_QA` oppure quelli del gate documentale `TEMPLATE`, `YELLOW_FIELDS`, `EDITORIAL`, `RISK_METHOD`, `DOCX_QUALITY`, `HSE_REVIEW`;
- `eligible_for_final_technical_review` solo quando tutto è coerente.

Il risultato **non approva mai il DUVRI**: `duvri_approved=false` e `issuance_allowed=false` in entrambi gli stati.

## Modello di fiducia

È soltanto una **funzione deterministica**. I suoi booleani non rappresentano prove se sono stati passati da browser, documenti o output AI. La versione reale deve essere eseguita **sul backend** con:
- manifest verificato tramite lettura del modello originale, catalogo e hash reali;
- risultati di `validateMapping` ricalcolati da una mappatura approvata e registrata lato server;
- report di compilazione e QA firmati logicamente dal servizio (revisioni, hash, risultati), non da parametri del client;
- decisioni del tecnico autenticato e autorizzato sulla revisione corrente, salvate con audit immutabile e controllo delle modifiche concorrenti;
- chiavi e percorsi dei documenti accessibili esclusivamente alla commessa autorizzata.

Non è un sostituto dei controlli di autenticazione, autorizzazione o documentali.

## Test

`tests/duvri-readiness-bridge.test.js`: 18 casi esclusivamente sintetici, inclusi template errato, revisione modificata, mapping 22, non applicabilità, firme/QA, D1, decisioni HSE respinte e dati mancanti.

```bash
node --test tests/duvri-readiness-bridge.test.js
```

## Sequenza di integrazione futura senza sovrapporsi a Claude Code

1. Claude Code e il tecnico Colligo completano l'assegnazione dei 22 segmenti gialli sul vero modello.
2. Si verifica il Word con campi **effettivamente compilati**, commenti e tabelle rischi, e si ottiene un report affidabile.
3. Il sistema di origine produce il mapping strutturato versionato; un adattatore del backend trasforma i report del compilatore e delle revisioni HSE nel contratto atteso dal preflight.
4. Il preflight verifica che tutte le versioni coincidano, senza anticipare approvazioni D1 o altri permessi.
5. Solo allora si potrà sviluppare la procedura **separata** di approvazione ed emissione.

Lo schema reale della PR #21 è ancora da integrare, il worker è disattivato e non è prevista alcuna pubblicazione di questo prototipo.
