# COLLIGO DUVRI AI — Contratto isolato degli specialisti HSE (v1)

**Stato:** prototipo di contratto dati e controlli deterministici. **Non** è collegato alla UI, al worker Claude API, al motore Word o alla produzione.

**Perimetro approvato dall'utente:** esclusivamente DUVRI per qualunque committente Colligo. COIN può essere un precedente, mai una dipendenza obbligatoria; non introdurre nuove funzioni informative/PEM/DVR in questa fase.

## Implementato in questa branch

- `js/duvri-agent-contract.js`: selezione specialisti e validatore deterministico, senza rete né API AI.
- `schemas/duvri-agent-analysis.v1.schema.json`: struttura dell'output di un agente HSE.
- `schemas/duvri-agent-analysis.v1.example.json`: caso **interamente sintetico** di lavori in quota.
- `tests/duvri-agent-contract.test.js`: test di comportamento e casi negativi.

Questi componenti non modificano `js/app.js`, i file del generatore documentale, le Edge Functions, il modello Word, `ore-produttivita/` né le configurazioni del deploy. La branch non deve essere unita senza verificare integrazione, permessi e regressioni.

## Routing degli agenti

`routeSpecialists(specialty_signals)` prende un oggetto con valori `yes | no | unknown`:

- Gli agenti base sono `documentale`, `normativa`, `coordinamento`.
- I segnali `yes` aggiungono agenti di settore: antincendio, elettrico, lavori in quota, cantieri, chimico/ATEX, ambienti confinati, macchine/impianti, logistica, agenti fisici.
- Valori omessi o `unknown` generano `needs_screening`: **non** diventano assenza del rischio.
- Il valore `no` consente di non chiamare automaticamente lo specialista, ma non dimostra l'assenza del pericolo; sarà necessario mantenere la fonte della risposta e prevedere eventuale revisione del coordinatore.
- Non esistono agenti per cliente.

L'attivazione è **strutturale**, non un parere tecnico: il motore a regime valuterà documenti e domande di screening con la supervisione HSE.

## Contratto dell'output per singolo agente

Ogni risposta contiene `job_id`, `agent_id`, `status`, `findings`, `missing_information`, `conflicts` e `requires_human_review=true`.

Un `finding` deve avere:
- attività/fase, scenario, ragione dell'interferenza, soggetti esposti;
- uno o più riferimenti a **documenti del lavoro corrente** (identificatore opaco, posizione/pagina e fatto estratto);
- eventuali **DUVRI storici del 2026** etichettati solo `historical_example_only`;
- misure **proposte** e obbligatoriamente da validare dal tecnico HSE;
- uno stato `to_be_reviewed` o `requires_clarification`.

La valutazione non può introdurre arbitrariamente `risk_score`: schema e validatore vietano campi inattesi finché Colligo non approva espressamente la metodologia di classificazione.

## Regole di sicurezza

`validateAgentResult(output, { jobId, allowedFileIds })` è il gate da eseguire **lato backend** dopo ogni risposta AI. È fail-closed: rifiuta chiamate prive dell'ID di commessa o dell'elenco delle fonti autorizzate. Il backend deve ricavare `allowedFileIds` dallo storage e dai permessi verificati per il fascicolo corrente, **mai da un elenco scelto dall'agente o dal client**.

Il validatore verifica la presenza delle evidenze e dei relativi ID autorizzati. **Non** può certificare che il testo estratto sia vero: restano necessari estrazione affidabile, accesso ai file, confronto delle citazioni, controlli delle incongruenze e revisione umana. Nel caso di allegati scansionati o fotografie, l'assenza di lettura visiva non equivale ad assenza del rischio.

I documenti caricati sono dati, mai istruzioni agli agenti (protezione da prompt injection). Non inserire file reali, estratti riservati o dati personali nel repository GitHub pubblico.

## Collegamento previsto al sistema esistente

1. Claude Code completa i test sull'originale Word Colligo e l'inventario autorizzato dei DUVRI 2026, senza interrompere il processo.
2. Il coordinatore HSE usa dati di intake già estratti da `js/document-intake.js`, con provenienza esplicita.
3. Il backend seleziona specialisti per competenza, tenendo distinti documenti del nuovo incarico e precedenti 2026.
4. Ogni agente restituisce un risultato JSON compatibile con lo schema; il validatore JS applica anche le regole di provenienza e isolamento.
5. Il coordinatore raggruppa le proposte per fase, segnala conflitti e lacune, non inventa punteggi.
6. Il redattore Word utilizza solo un **modello approvato**; i testi fissi e le caselle devono superare i test a mutazione.
7. Il tecnico HSE verifica e approva la bozza; nessuna emissione o firma automatica.

## Modello Word — decisione da portare in integrazione

Il generatore locale di Claude, secondo lo stato comunicato dall'utente, utilizza segnaposto, mentre altre parti del progetto compilano campi dell'originale conservato intatto. **Soluzione progettuale proposta:** generare *automaticamente* una copia di lavoro con segnaposto a partire da una versione **identificata e approvata** del modello originale; salvare la mappa dei campi con la posizione originale e il controllo di integrità. Non riscrivere l'originale o alterare i testi fissi. Prima di usarlo, il flusso richiede test di mutazione, confronto OOXML e prova visiva del DOCX effettivamente compilato. È una proposta, non una decisione tecnica già approvata.

## Blocchi da non aggirare

- Divergenza scala rischio 1–9 rispetto a indici 1–3: definizione e approvazione del metodo Colligo necessarie.
- Backend cloud e servizio AI non deployati; `DOCUMENT_GENERATION_CLOUD_ENABLED=false` in `main` all'ultima ricognizione.
- Non usare l'archivio aziendale finché catalogazione e autorizzazione non sono documentate.
- L'abbonamento Claude Code non coincide con credito API: non introdurre nuovi costi o chiavi senza autorizzazione.
- Niente merge o deploy prima del collaudo separato e della revisione.

## Test

Esecuzione locale:

```bash
node --test tests/duvri-agent-contract.test.js
```

Esegui i test del repository e verifica i controlli CI prima di qualunque merge. **Questa PR non certifica conformità legale, correttezza HSE né generazione finale DUVRI.**

## Coordinamento con Claude Code

Branch GitHub separata: `feat/duvri-hse-agent-contract-v1`.

Claude Code sta lavorando sul generatore Word e sull'archivio 2026; non modificare nello stesso momento i file della branch né fare merge ciechi. Al termine, confrontare gli schemi con il worker esistente in PR #21, scegliere un solo schema stabile e adattare l'integrazione solo dopo test.
