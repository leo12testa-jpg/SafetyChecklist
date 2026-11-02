# COLLIGO DUVRI AI — Unificazione degli agenti con screening delle fonti

**Ambito:** contratto tecnico universale DUVRI, dati completamente sintetici. Nessun contatto con il PC aziendale o con servizi AI a pagamento.

## Problema

I moduli `duvri-hse-screening.js` e `duvri-hse-coordinator.js` sono volutamente separati, ma l'app finale non deve poter invocare il coordinatore con dei segnali non verificati. Senza un passaggio obbligato, un "NO" estratto da checklist non confermata potrebbe diventare erroneamente un'esclusione silenziosa dello specialista.

## Soluzione aggiunta

`js/duvri-hse-pipeline.js`: `aggregateEvidenceGated` richiede `jobId`, `analysisRevisionId`, risposte di screening con fonti, `allowedFileIds` autorizzati dal backend, risultati degli specialisti e applica in sequenza:

1. verifica della provenienza e della conferma delle risposte (`normalizeSpecialtyScreening`);
2. attivazione degli specialisti e raccolta dei risultati (`buildReviewPacket`);
3. blocco del fascicolo se sono state utilizzate fonti non autorizzate, categorie non riconosciute o risultati incompatibili;
4. stato `awaiting_input` se uno o più segnali richiedono conferma, **anche quando tutti gli agenti hanno risposto e un positivo non confermato li ha già attivati**;
5. `needs_review` soltanto con tutti i segnali pertinenti sufficientemente confermati e tutti i risultati specialistici coerenti.

Il risultato non è né una valutazione legalmente approvata né un documento da emettere: `issuance_allowed=false` in tutti gli stati.

## Integrazione

Il futuro worker PR #21 deve evitare di chiamare direttamente il coordinatore con segnali grezzi. Deve normalizzare il contesto, recuperare i file ID autorizzati direttamente dalla persistenza, invocare `aggregateEvidenceGated`, salvare una revisione di analisi immutabile e trasmettere il pacchetto al controllo di revisione.

L'assenza di segnali completi NON equivale mai ad assenza dei rischi.

## Test

`tests/duvri-hse-pipeline.test.js`: 10 casi, inclusi positivi non confermati, negativi incerti, ACL di altro cliente, agenti mancanti, provenienza errata e conservazione del dato originale.

Nessuna modifica al worker cloud né al generatore Word realizzati da Claude.
