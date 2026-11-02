# COLLIGO DUVRI AI — Piano di integrazione con il worker isolato esistente (D4)

**Ricognizione verificata:** file della PR GitHub #21, ramo `feat/duvri-backend-isolated`, letti senza modificare quella PR. **Questa è una specifica, non un'integrazione funzionante.**

## 1. Componenti di partenza: NON duplicarli

| Componente PR #21 | Funzione esistente | Cosa aggiungere dalla PR #28 |
| --- | --- | --- |
| `supabase/functions/document-jobs/index.ts` | Gateway autenticato, upload privato, elenco job, download, azioni di revisione | Verificare in backend il contesto revisore e l'ACL del fascicolo prima di chiamare il registro decisioni |
| `supabase/functions/document-worker/index.ts` | Fasi persistenti `extract`, `analyze`, `draft`, `validate`, `review`; lease e retry | Usare routing + validazione specialisti prima di comporre la bozza, mantenendo checkpoint e idempotenza |
| `supabase/functions/document-worker/duvri-agent.ts` | Prompt redattore e controlli di forma del DOCX | Accettare soltanto evidenze e misure marcate come proposte e provenienti dall'incarico corrente |
| `supabase/functions/document-worker/docx-generator.ts` | Compiler OOXML nel backend non ancora collaudato sul vero modello | Integrare **solo dopo** validazione del modello reale e dell'adattatore di Claude |
| `supabase/functions/document-jobs/validation.ts` | Contratto HTTP e stati documento finali | Tenere distinte decisioni sui finding e approvazione del DOCX |
| `supabase/document-generation/schema.draft.sql` | Proposta schema job/file/audit | Aggiungere dati di provenienza e versioni senza scrivere subito in DB produzione |

### Nomi diversi per concetti diversi

Il backend PR #21 già gestisce `REVIEW_DECISIONS=['approved','changes_requested','rejected']` per la **bozza documento**. Il nuovo `duvri-hse-review.js` usa `accept_for_draft`, `reject`, `request_changes` per ciascun **finding tecnico**.

Non associare `accept_for_draft` a `approved`. L'approvazione finale richiede il documento generato, QA tecnica, controlli Word, metodologia rischio ufficiale e revisione HSE.

## 2. Gating D1 e D2

Nella PR #21 `duvri-agent.ts` attualmente valida `irIndex` obbligatoriamente in **1–3** per le righe di rischio del modello, mentre altri strumenti Colligo usano una matrice **3x3**. La discrepanza è segnalata da Claude Code e non è ancora risolta.

Finché il responsabile Colligo non approva la regola D1:
- non sbloccare `DUVRI_RISK_RULE_APPROVED` né la fase `draft`;
- non convertire arbitrariamente punteggi;
- mantenere il gate di configurazione bloccante anche quando gli agenti HSE hanno prodotto finding validi.

D2: Claude propone una copia automatica del modello originale con segnaposto e test di mutazione; non scegliere il redattore PR #21 o quello locale senza confronto visivo e strutturale sul vero DOCX.

## 3. Flusso proposto

1. `document-jobs` acquisisce checklist Word e allegati, salva file privati e crea il job.
2. `extract` ottiene fatti e riferimenti a file del fascicolo corrente.
3. `analyze` prepara la prima analisi interferenziale e segnali di screening.
4. Il backend normalizza i segnali documentati e attiva gli specialisti HSE pertinenti.
5. Ogni specialista produce output compatibile con `duvri-agent-analysis.v1.schema.json`.
6. `validateAgentResult` verifica `jobId` e file ID autorizzati caricati **dal backend**, non dalla risposta AI.
7. `buildReviewPacket` aggrega le analisi, preserva fonti, dati mancanti e conflitti, e conserva `analysis_revision_id`.
8. Se il risultato è `blocked` o `awaiting_input`, il job non può andare in redazione senza integrazioni/verifiche.
9. Quando il pacchetto è pronto, il redattore produce una **bozza** soltanto con metodologia D1 e template D2 approvati.
10. Il controllo qualità valida il Word e la coerenza delle informazioni.
11. Il tecnico esamina nello stesso flusso la bozza DOCX e i finding. Le decisioni su questi ultimi usano `prepareReviewDecisions`, che richiede la corrispondenza della revisione di analisi.
12. Solo una **procedura distinta** può approvare ed emettere il DUVRI. Il modulo della PR #28 non abilita mai emissione automatica.

## 4. Binding di revisione e concorrenza

Il coordinatore propone `analysis_revision_id`: deve essere un identificatore generato e salvato in modo affidabile **lato server**, per il set di fonti e analisi corrente. Non va dedotto dal timestamp del browser. Il backend verifica che il pacchetto letto sia la revisione corrente e che `document_revision_id` corrisponda alla bozza effettivamente scaricabile, escludendo revisioni superate.

Se checklist, allegati o risultati vengono aggiornati dopo l'analisi, è necessaria una nuova revisione, invalidando le decisioni precedenti per le parti coinvolte.

**Il controllo di uguaglianza dell'ID nel modulo JS è necessario ma non sufficiente senza transazioni e autorizzazione server-side.**

## 5. Collegamento all'archivio 2026

Il nuovo `duvri-historical-references.js` accetta solo un indice *normalizzato* e ID opachi, evitando dati cliente in GitHub. L'adattatore al catalogo locale di Claude richiede conferma delle colonne effettivamente presenti nel CSV/XLSX e dei permessi aziendali. Non pubblicare l'indice reale e non inviarlo ad API AI non autorizzate.

I precedenti `historical_2026_reference` **non sono mai prove** dell'incarico corrente.

## 6. Cosa non è ancora stato fatto

- Nessuna chiamata a specialisti AI reali, né prompt implementati sui documenti.
- Nessun merge PR #21/28; non modificare branch di Claude.
- Nessuna migrazione, configurazione cloud, costo API o deploy.
- Nessuna lettura diretta del contenuto dei 148 DUVRI 2026 dalla chat.
- Nessuna autorizzazione tecnica D1/D2 o validazione professionale del DUVRI finale.

**Prossimo gate d'integrazione:** verificare insieme i test dell'adattatore Word Colligo e la versione schema intake, poi scegliere un solo backend e un solo orchestratore HSE evitando codice duplicato.
