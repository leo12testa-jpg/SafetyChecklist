# COLLIGO DUVRI AI — Coordinatore di revisione HSE (proposta v1)

**Stato:** modulo isolato, non attivato in SafetyChecklist. Solo dati sintetici nei test. Non effettua valutazioni professionali né può autorizzare l'emissione di un DUVRI.

## Utilità

Il coordinatore riceve output JSON da ciascun agente HSE specializzato e li raccoglie in una scheda per il tecnico Colligo, conservando ogni fonte, conflitto e dato mancante.

Il file `js/duvri-hse-coordinator.js` importa il contratto `js/duvri-agent-contract.js` già presente nella PR #28.

## Chiamata di esempio (solo backend e dati sintetici)

```js
const { buildReviewPacket } = require('./js/duvri-hse-coordinator.js');
const packet = buildReviewPacket({
  jobId: 'FASCICOLO_TEST_SYNTH_001',
  specialtySignals: { lavori_in_quota: 'yes', impianti_elettrici: 'unknown' },
  agentResults: [], // risultati JSON effettivamente ricevuti dagli specialisti
  allowedFileIds: ['FILE_TEST_001'] // SOLO dal backend, dopo controlli di accesso
});
// packet.state === 'blocked' (risposte obbligatorie ancora mancanti)
// packet.issuance_allowed === false (sempre)
```

## Stati del pacchetto

- `blocked`: dati di configurazione incompleti, risultato non valido, agente selezionato senza risposta, agente bloccato, file non autorizzato o risposta duplicata. Se una risposta non valida compare nel lotto, il sistema **non restituisce alcun finding**.
- `awaiting_input`: sono necessari screening, risoluzione di conflitti, dati bloccanti o chiarimenti degli specialisti.
- `needs_review`: tutti gli agenti richiesti hanno risposto e non restano chiarimenti bloccanti. **Non significa** che il DUVRI sia validato o emettibile.

Tutti gli stati hanno `human_review_required=true` e `issuance_allowed=false`.

## Garanzie previste

1. L'agente COIN storico **non** è una dipendenza obbligatoria. Valutare il riutilizzo del coordinatore COIN già testato, senza importare dati o regole specifiche COIN.
2. La selezione degli specialisti usa risposte tri-stato `yes`/`no`/`unknown`; nessun campo omesso diventa automaticamente assenza di rischio.
3. Ogni risultato deve appartenere al `jobId` server-side corrente ed essere riferito a file autorizzati da una lista server-side per quel fascicolo.
4. Un precedente storico DUVRI 2026 può soltanto arricchire una spiegazione; non può, da solo, giustificare un'interferenza del nuovo intervento.
5. Nessun punteggio numerico del rischio è accettato fino all'approvazione del metodo aziendale D1.
6. Se due agenti descrivono lo stesso scenario, il coordinatore li segnala in `possible_overlaps`: non fonde o cancella automaticamente valutazioni.
7. I dati sono copiati in memoria nel pacchetto, non modificati sul risultato dell'agente di origine.
8. Questo codice **non verifica la verità delle citazioni**: deve essere integrato con l'accesso ai documenti originali e con controlli umani delle evidenze.

## Dipendenze e blocchi da risolvere

- **D1 — Metodo rischio:** conflitto 1–3 / 3x3 / stato bloccato COIN, da approvare formalmente.
- **D2 — Word:** favorire la copia di lavoro derivata dall'originale controllato, con mapping/placeholder generati e verifica di fedeltà; Claude Code ha test su modelli sintetici ma il documento reale non è ancora collaudato.
- **D3 — Documenti clienti verso servizi AI:** verificare condizioni privacy/autorizzazioni. Non attivare chiamate a pagamento senza mandato.
- **D4 — Schema condiviso:** verificare come mappare questo output sull'intake e sul worker cloud esistenti prima del merge.
- **D5/D6 — Nominativi e GitHub privato:** trattamento riservato, solo metadati anonimi nel repository pubblico.

## Archivio DUVRI 2026

Il rapporto *comunicato da Claude Code* (non verificato direttamente nel PC da questa sessione) indica 148 DUVRI 2026 confermati, 147 copie + 1 duplicato; 619 candidati da verificare. L'archivio e il catalogo restano nel computer aziendale. Non inserire i file reali, i nomi clienti o dati personali in questa PR.

Si può progettare una futura interfaccia di ricerca basata su `archive_id` opaco, tipo di intervento e riferimenti documento, ma prima occorre confrontare lo schema effettivo del CSV locale. Non inventare nomi di colonna e non trasferire gli storici fuori dall'ambiente aziendale autorizzato.

## Collaudo

```bash
node --test tests/duvri-agent-contract.test.js tests/duvri-hse-coordinator.test.js
node --check js/duvri-hse-coordinator.js
```

Testare in un ambiente isolato con dati sintetici. Prima di qualunque merge: rieseguire test dell'intero repository, verificare PR concorrenti (#21/#27) e ottenere review tecnica; nessun deployment è autorizzato in questa PR.
