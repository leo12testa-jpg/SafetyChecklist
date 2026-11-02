# COLLIGO DUVRI AI — Coordinatore HSE e pipeline a fonti verificate

**Stato:** librerie pure e isolate, no provider AI, no backend cloud, no DUVRI emesso, nessun cambiamento alla UI dell'app online.

## Moduli della PR

- `duvri-agent-contract.js` definisce 12 ruoli HSE, compresi 3 agenti base, struttura delle valutazioni e tre scope **non sovrapponibili**: `allowedFileIds` (fascicolo attuale), `allowedHistoricalReferenceIds` (precedenti 2026) e `allowedInternalRuleIds` (regole approvate). Ogni finding richiede una fonte corrente: gli esempi storici non possono sostituirla.
- `duvri-hse-coordinator.js` aggrega gli output dei soli specialisti richiesti, verifica il fascicolo e la revisione di analisi, impedisce output duplicati o sconosciuti, conserva tutte le fonti e segnala interferenze potenzialmente sovrapposte **senza fonderle**.
- `duvri-hse-pipeline.js` passa il risultato dello screening `yes/no/unknown` al coordinatore. I segnali non confermati mantengono `awaiting_input`, anche quando gli agenti hanno prodotto risposte.
- Test sintetici: contratti, specialisti mancanti, duplicati, fonti cross-job, precedenti storici, conflitti, revisione mancante, rischi sconosciuti, dati non mutati.

## Integrazione con Codex

1. Leggere dal backend privato il fascicolo e tutte le attestazioni. Produrre `buildHseEvidenceScope` già rilasciato nel codice di `main`.
2. **Non proseguire** se lo scope non è `ready_for_hse_screening` o se ha `allowed_file_ids=[]`. Per nessun motivo utilizzare una allowlist parziale.
3. Normalizzare i segnali dello screening e invocare `aggregateEvidenceGated` con ID fascicolo, revisione di analisi corrente, file autorizzati e risposte degli agenti.
4. Le allowlist storiche e delle regole interne devono essere prodotte indipendentemente dal server. Sono vietate sovrapposizioni con i file dell'incarico.
5. Rifiutare batch che producono `blocked` oppure `awaiting_input` e portarli nell'elenco di chiarimenti o anomalie da risolvere.
6. Dopo `needs_review`, il backend potrà aggiungere `packet_revision_id` e SHA-256 **verificati lato server** del pacchetto canonico e sottoporlo al gate della revisione HSE (PR #38). Questa libreria non attesta da sola il digest.
7. Persistenza, autentica, autorizzazioni, audit e controllo concorrenza restano responsabilità del backend Codex.

## Limiti

Questo coordinatore non legge documenti, non applica algoritmi di rischio D1, non genera Word D2 e non decide se un rischio sia effettivamente presente. `issuance_allowed=false` in ogni stato e revisione umana obbligatoria.

Lo storico DUVRI 2026 è uno **strumento di confronto**, non evidenza dell'attuale appalto. Un `no` non documentato non consente di escludere lo specialista. D1/D2 non sono ancora approvati.

## Prove prima di unire

Test Node completi, storage/RLS, QA browser isolata e controllo release. Nessun file cliente o contenuto proprietario nel repository pubblico. I test nel ramo non equivalgono a una validazione tecnico-legale del DUVRI.
