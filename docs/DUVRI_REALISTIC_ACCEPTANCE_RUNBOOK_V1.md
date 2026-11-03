# Colligo DUVRI — collaudo realistico di chiusura, 3 interventi sintetici

**Scopo:** passare dai soli contratti/mock al **fascicolo realistico completo fino alla bozza Word prodotta dal vero compilatore privato**, con verifica di fonti, interferenze e pagine. Questo repository pubblico NON contiene il backend Codex Windows, il master aziendale o dati clienti. La fixture JSON accompagna prove documentali interamente fittizie, senza trasferimento automatico da sopralluoghi.

## Confine obbligatorio: DUE MODULI INDIPENDENTI

| Funzione | Checklist / sopralluoghi (app esistente) | Generatore DUVRI (ambiente privato) |
|---|---|---|
| Input | Checklist JSON audit/DVR usata dai tecnici | Checklist DOCX compilata dal cliente + PDF, immagini, XLSX |
| Identificativi | ID sopralluogo e risposte audit | job_id DUVRI, file_id, analisi_revision, document_revision |
| Persistenza | Database e sincronizzazione audit/DVR invariati | Storage privato DUVRI e audit a revisioni separato |
| Processo | Avvio sopralluogo, foto, PDF sopralluogo | Estrazione, verifica fonti/OCR, HSE, bozza Word, QA |
| AI | Non richiesta | Agenti HSE locali; se assenti, blocked e screening deterministico distinto |
| Errori / deploy | Non devono dipendere dal generatore | Non devono alterare audit/DVR, neanche offline |

Il fatto che una checklist DOCX sia **input** del fascicolo DUVRI NON autorizza a leggere in automatico la tabella delle risposte salvate in SafetyChecklist. Eventuali integrazioni future richiedono mapping esplicito, consenso, ACL, tracciatura e test transazionali. Evitare modifiche a `js/app.js`, `js/db.js`, `js/checklist.js`, `js/sync.js`, `ore-produttivita/`, alle checklist clienti esistenti, al service worker e ai PDF di sopralluogo durante questo collaudo.

## Tre fascicoli realistici

Scenario | Attività | Fatti da ricavare realmente dai file | Specialisti/risultato atteso
--- | --- | --- | ---
REAL_SYN_01 | manutenzione copertura magazzino, due appaltatori e prove elettriche | sovrapposizione lavori in quota e transito mezzi; gap portata copertura | lavori_quota, elettrico, logistica: misure da validare, nessun punteggio inventato
REAL_SYN_02 | manutenzione gruppo frigorifero con deposito operativo | incrocio manutentore/carrelli; refrigerante e isolamento non documentati | macchine_impianti, logistica, chimico_atex pertinenti da screening; chiarimenti aperti
REAL_SYN_03 | accesso potenziale a vasca interrata con permessi mancanti | simultaneità con manutenzione pompe, permessi e misure non forniti | spazi_confinati, macchine_impianti; **nessuna dichiarazione di accesso sicuro**

**File di test:** `tests/fixtures/duvri-realistic/scenarios.v1.json`. `case_id` e `F01..F05` sono codici del banco prova, **non** file_id o riferimenti al backend. Il backend deve generare davvero `file_id`, hash, `locator` per paragrafi/pagine/righe/fogli e revisioni; non utilizzare locator inventati dalla fixture. Le misure `proposal_to_review` sono ipotesi da validare, non prescrizioni approvate.

## Esecuzione obbligatoria da Codex Windows, senza duplicare codice

1. Riprendere il worktree isolato con tutti i commit Claude/Codex preservati. Leggere i report locali, PR #57/#60/#62/#64/#67 e issue #65/#66. Non sovrascrivere il backend privato né confondere il runner integrato con una PR GitHub non mergiata.
2. Preparare, **fuori dal repository pubblico**, i tre fascicoli completi in cartelle isolate: per ciascuno `CHECKLIST_*.docx` compilata, `CAPITOLATO_*.pdf` e `CRONOPROGRAMMA_*.xlsx`; tutti con società, luoghi e dati inventati. Non usare il master Word Colligo come modello della checklist del cliente.
3. Per ogni caso: caricare DOCX nell'**Area A**, gli altri due nell'**Area B** del portale DUVRI privato; non usare l'app dei sopralluoghi audit. Verificare SHA calcolato sui byte, MIME, documento corrente, versione e revisioni.
4. Eseguire estrazione DOCX/PDF/XLSX; registrare i **locator veri** (paragraph, page:line, sheet:row) e le differenze rispetto alle `facts` dichiarate nella fixture. Non autocertificare righe OCR.
5. Lanciare screening/specialisti in modalità consentita: con Ollama assente conservare `HSE_ADAPTER_UNAVAILABLE`, non dichiarare eseguita inferenza AI. Il runner simulato testa soltanto orchestrazione, non sufficienza della valutazione professionale.
6. Verificare ogni finding `interferences` rispetto a **due o più fatti attuali** e ai documenti: nessuna interferenza senza fonti, nessuna assenza di rischio dedotta da un campo vuoto. Registrare chiarimenti per le informazioni mancanti, non inviarli automaticamente al cliente.
7. Generare **una bozza Word sintetica NON EMETTIBILE tramite il vero compilatore** nel workspace privato. La prova deve riportare cliente, imprese, attività, aree, periodi e interferenze pertinenti, senza residui del template (ad es. supermercato per magazzino). Per il caso di permessi mancanti, non sbloccare la redazione ufficiale: solo demo bloccata se il sistema lo consente esplicitamente.
8. Eseguire l'OOXML QA e **rendering Word COM da sessione Windows interattiva autorizzata**; acquisire numero pagine reale e manifest PNG, verificare tutte le pagine. Non equiparare paginazione LibreOffice con quella Word. Ogni pagina parte `PENDING` fino alla revisione di un tecnico **diverso** dal generatore.
9. Eseguire prova di modifica di un allegato: vecchie citazioni, packet HSE, Word e decisioni pagina **devono decadere**; testare doppio click, concorrenza, revisione vecchia, file di altro fascicolo, OCR falso verificato e accesso non autorizzato.
10. Eseguire regressione Audit/DVR indipendente: apertura checklist attuale, salvataggio/sync, PDF originale, foto, IndexedDB offline, nessuna nuova dipendenza dal backend DUVRI. Se DUVRI si arresta, audit/DVR continua a funzionare e viceversa.

## Criteri di accettazione per ogni scenario

- [ ] I documenti caricati sono effettivi e leggibili, non soltanto metadati finti.
- [ ] Risultato estrazione legato a SHA, file_id, revisioni e locator reali.
- [ ] Screening e findings coerenti con input e fonti. Nessuna dichiarazione falsa di AI reale.
- [ ] Interferenze, misure proposte e lacune distinte; nessun indice di rischio senza D1.
- [ ] Documento Word effettivo del compilatore privato, contenuti e contesto pertinenti, niente sostituzioni 11/12 non giustificate.
- [ ] Marcatura NON EMETTIBILE visibile sul rendering Word, firme non approvate, 100% pagine inizialmente PENDING.
- [ ] Revisione umana separata; D1, D2, QA e autorizzazioni rimangono bloccanti.
- [ ] Zero invii a clienti, zero provider cloud, zero spesa API, zero emissione.
- [ ] Suite audit/DVR e PWA senza regressioni.

**Output locale da richiedere a Codex:** per ognuno dei 3 casi, `REPORT_REAL_SYN_xx.json` sanificato con: elenco fonti e SHA senza contenuti, contatore di fatti confermati/mancanti, codici findings/clarifications, stato HSE simulato, ID bozza e revisione, `word_rendered_page_count`, PENDING/PASS/ISSUE, alert di contenuti non pertinenti, blocchi D1/D2 e esito regressione audit. Non includere dati cliente, percorso locale o codici temporanei di accesso. Un rapporto `PASS` richiede davvero il Word, non un mock. Non fare push, merge o deploy prima della revisione.

## Cosa NON dimostrano i test GitHub

Il test `tests/duvri-realistic-acceptance-isolation.test.js` valida i dati sintetici, la consistenza delle interferenze proposte e parte del confine statico fra app. **Non** esegue l'app Windows privata, non popola il master, non genera un DUVRI e non certifica la segregazione runtime/database. Questo requisito si chiude solo con i test locali del backend e della PWA.

**Stato:** banco prova per il pilota, non rilascio o approvazione professionale.
