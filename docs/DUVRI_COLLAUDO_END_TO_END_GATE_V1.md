# Colligo DUVRI AI — Collaudo end-to-end e gate prima del rilascio (v1)

**Stato al 2 novembre 2026: PIANO DI ACCETTAZIONE, NON CERTIFICAZIONE.**
Questo documento pubblico contiene solo istruzioni e casi **sintetici**. Il backend privato, le API AI reali, il modello Word Colligo, il metodo D1 e il mapping D2 non sono disponibili/approvati in questo ramo. I moduli HSE in `main` sono contratti e verificatori isolati: i loro test verdi **non significano** che l'app generi un DUVRI finale.

## Condizione necessaria per dichiarare il flusso testato

Un tecnico autorizzato deve poter completare **in ambiente isolato di prova**:
1. Creare un fascicolo con ID e revisioni assegnati dal backend, non dal browser.
2. Caricare una **checklist DOCX principale** e **N allegati** privati (PDF con testo, PDF scansiti, JPEG/PNG, XLSX); mantenere ogni prova legata alla versione esatta del file.
3. Verificare estrazioni complete, identificazione dei contenuti e provenienza per pagina/riga/foglio; bloccare file parziali, non supportati o protetti.
4. Eseguire conferma **umana di ogni riga OCR**; anche un risultato con confidenza alta **non** si considera automaticamente confermato.
5. Eseguire gli specialisti HSE **realmente configurati** in ambiente di prova autorizzato, confrontare fonti correnti/storiche/regole e mantenere le lacune aperte.
6. Sottoporre ogni finding a revisore autenticato, con permessi su quel fascicolo e salvataggio di decisioni/revisioni con controllo di concorrenza.
7. Generare **solo bozza sintetica non emettibile** con master Word versione/hash approvati e mappatura D2; verificare i 22 segmenti, 27 commenti, tabelle rischi, firme vuote, struttura e confronto visivo dopo popolamento.
8. Eseguire collaudo documentale completo e registrare i blocchi D1, D2, privacy, QA e rilascio. **Nessun controllo di questa matrice abilita automaticamente l'emissione.**

## Matrice di prove obbligatorie

| Caso sintetico | Documenti e situazione | Esito atteso |
|---|---|---|
| A — intervento semplice | Checklist + capitolato PDF testuale | Fonti con localizzatori; rischi proposti solo da specialisti autorizzati |
| B — lavori in quota | Checklist + procedura + pianta | Coinvolgere lo specialista pertinente, non inventare protezioni |
| C — intervento elettrico | Checklist + procedura elettrica | Segnalare possibili interferenze e lacune, revisione tecnica obbligatoria |
| D — spazi confinati | Checklist + permessi e schede | Bloccare fonti insufficienti, non inferire condizioni sicure |
| E — area esterna complessa | Checklist + cronoprogramma XLSX + planimetria PDF | Conservare sheet/row e page/line per ogni evidenza pertinente |
| F — PDF incompleto | Checklist + PDF con pagina scansionata senza OCR verificato | File `unreadable` o `OCR_CONFIRMATION_REQUIRED`, nessun invio ad HSE |
| G — foto e scansione | Checklist + JPG/PNG + PDF OCR misto | Ogni riga OCR richiede conferma umana, anche ad alta confidenza |
| H — falsificazione/obsolescenza | Documento di altro fascicolo, OCR alterato, revisioni vecchie | Rigetto completo; niente accesso, analisi o Word |
| I — specialisti non configurati | Fascicolo con fonti verificate ma adapter assente | Worker reale `blocked` / `HSE_ADAPTER_UNAVAILABLE` |
| J — scorciatoia sintetica | Screening locale a parole chiave già revisionato | `requestCompiler` deve bloccare `HSE_SPECIALISTS_NOT_CONFIGURED` |

Per i casi F/G verificare la corretta invalidazione delle conferme OCR quando cambia il file o la revisione. Verificare timeout/cancellazione reale, limiti di risorse, assenza di rete e accessi disco nel worker OCR, rifiuto di file corrotti, immagini sovradimensionate, modelli alterati e payload PDF malevoli.

## Gate professionali e di sicurezza (tutti indispensabili)

| Gate | Evidenza richiesta | In assenza |
|---|---|---|
| **S0 — identità/ACL** | Utente autenticato, ruolo, accesso al fascicolo e RLS verificati dal server | Bloccare |
| **S1 — integrità fonti** | SHA-256 ricalcolati sui byte, MIME, revisioni, estrazione completa e fonti autorizzate | Bloccare |
| **S2 — OCR** | Ogni riga OCR pertinente confermata dal tecnico e legata alla revisione | Bloccare |
| **S3 — HSE reale** | Specialisti configurati con autorizzazione d'uso e confini di fonte verificati | Bloccare |
| **S4 — revisione HSE** | Revisore, packet digest e revisioni confermati lato backend; chiarimenti risolti | Bloccare |
| **D1 — metodologia** | Delibera Colligo versionata per indici/matrice e tabelle | Non calcolare valori definitivi |
| **D2 — Word** | Master approvato con SHA completo e mappatura dei 22 segmenti/27 commenti verificata | Nessuna bozza ufficiale |
| **S5 — Word QA** | QA OOXML/visivo su Word *popolato*, firme e contenuti fissi, revisioni e hash verificati | Bloccare |
| **S6 — runtime** | Compatibilità reale di Worker OCR sandbox, timeout e limiti sul target; RLS/permessi verificati | Non deployare |
| **S7 — rilascio** | QA browser regressione audit/DVR e mobile, test security/privacy, approvazione del responsabile HSE | Non pubblicare |

**In nessun caso** il flag `qa_report_complete`, una dichiarazione del browser, un messaggio LLM o un mero numero di test superati costituiscono un'approvazione. Il Word originale rimane immutabile. D1 e D2 sono decisioni professionali aziendali, non scelte del codice.

## Controlli di regressione sul repository pubblico

Il file `tests/duvri-release-boundary.test.js` verifica che:
- il flag di elaborazione documentale cloud pubblico rimanga `false`;
- la pagina pubblica non avvii worker privati o agenti DUVRI sperimentali;
- tutti e tre gli ingressi PDF.js attuali del frontend abbiano `isEvalSupported:false`;
- moduli fascicolo, HSE e QA Word rifiutino input mancanti senza concedere autorizzazione all'emissione.

Questi test **non** sostituiscono il controllo delle librerie PDF aggiornate nel backend e non provano l'assenza di vulnerabilità nel PDF.js 3.x del frontend. Pianificare l'upgrade frontend separatamente con suite di regressione, senza attivarlo insieme al backend privato.

## Collaudo nel workspace Claude Code privato

Eseguire sui **commit effettivi**, non assumere ancora validi i numeri riportati precedentemente:
- Type-check e `deno task backend:test`, `deno task backend:ocr` dove definiti.
- Test PostgreSQL isolati, simulazione end-to-end sintetica e `node --test tests/*.test.js`.
- Portale locale 390px per scenari E/F/G, almeno una prova browser desktop.
- Browser regressione audit/DVR/PDF con Chromium, Firefox e WebKit dove supportati; `qa-browser` con emulatori Firebase quando disponibili, senza eludere il test.
- Verifiche manuali del Word reale **solo nel workspace aziendale privato** e solo dopo le autorizzazioni.

Raccogliere in `STATUS_PER_CHATGPT.md` locale: SHA HEAD, stato `git status`, comandi/esiti test, ambiente, verifica dei gate, problemi aperti e eventuali verifiche non eseguibili. Pubblicare nell'issue #37 **solo un riassunto sanificato**, se la policy di autorizzazione lo consente. Non pubblicare screenshot, PDF o risultati di test contenenti dati aziendali. La cartella `reports/` può contenere file già tracciati: aggiungerla a `.gitignore` **non** elimina file né ne interrompe il tracciamento.

## Criterio di stop e perimetro di questa release

Questo PR aggiunge soltanto **documentazione di accettazione e test di difesa del frontend attuale**; non collega AI, non modifica la schermata, il backend, il modello Word, i dati cliente, le credenziali o il deploy. Non mergeare la PR sperimentale #28 o #21 per aggirare le dipendenze. Ogni attivazione futura richiede una modifica separata e prove riproducibili.
