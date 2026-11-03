# Colligo DUVRI AI — accettazione finale con fascicoli realistici ma inventati

**Perimetro:** collaudo locale del **Generatore Documenti DUVRI**, distinto dall'applicazione **Checklist/Sopralluoghi**. Non è una nuova app, non è un nuovo coordinatore e non sostituisce Codex o il master privato Colligo.

## Due moduli indipendenti (vincolo)

**A. SafetyChecklist / Audit / DVR:** moduli esistenti di raccolta dati, storage, checklist, PDF e storico; continuano a funzionare autonomamente, senza richiedere il generatore DUVRI né una AI. Non cambiarne schermate, dati, service worker, sincronizzazione, PDF o permessi nell'ambito di questo collaudo.

**B. Generatore documentale DUVRI:** una superficie e un backend separati; ricevono **un DOCX checklist principale** compilato dal cliente e allegati PDF, XLSX, immagini e DVR. La provenienza è la **versione del file caricato**, non un oggetto JavaScript interno alla PWA audit. L'ingresso è un fascicolo privato autenticato (ID, SHA-256, revisione, evidenze di estrazione). Il Word generato usa esclusivamente **il master Word aziendale approvato**; non modifica mai il modello.

**Non creare adattatori che leggano direttamente** database, API interne o oggetti della schermata Checklist come fonte obbligatoria del generatore. Eventuali informazioni condivise devono passare attraverso documenti versionati e un'interfaccia esplicita, opzionale e testata. Nessun provider cloud AI.

## Corpus realistico sintetico: quattro commesse differenti

Il file `fixtures/duvri-realistic-synthetic-cases.v1.json` contiene quattro fascicoli fittizi, con appaltatori, luoghi, orari, allegati, compresenze, affermazioni non dimostrate e domande tecniche. Non contiene clienti reali.

| Caso | Scenario | Prove richieste |
| --- | --- | --- |
| **SIM-01** | HVAC sulla copertura, magazzino aperto | PLE/cortile/transito merci, isolamento elettrico, piano emergenze mancante |
| **SIM-02** | Lucernari e fotovoltaico, due appaltatori simultanei | Cronoprogramma XLSX, sollevamento, traffico muletti, interferenze fra due imprese, LOTO non attestato |
| **SIM-03** | Pozzetto tecnico; qualificazione e atmosfera non verificate | **Blocco** prima di ogni affermazione di ingresso sicuro; permesso, atmosfera, recupero e classificazione da chiarire |
| **SIM-04** | Sostituzione corpi luce, impresa pulizie in compresenza | Non scambiare “uffici chiusi” con “assenza di tutte le interferenze”; coordinamento corridoio e circuito |

Le domande aperte **non vanno soddisfatte inventando risposte**. Nessun valore di indice di rischio è approvato finché D1 è aperta.

## Genera i documenti di ingresso veri

Da una sessione locale autorizzata (Node e Python già in uso, **senza installare nulla**):

```powershell
py -3 tools/duvri_realistic_synthetic_bundle.py --out "C:\\TEMP\\DUVRI_SINTETICI"
```

Il builder usa **soltanto la libreria standard Python**, non chiama rete, non usa Ollama e non tocca il master Word. Crea DOCX realmente apribili, PDF testuali, XLSX (dove previsti), PNG di schemi fittizi e manifest con SHA-256 **ricalcolati dai byte prodotti**. Consegna un archivio ZIP e quattro cartelle separate da usare esclusivamente **nel portale DUVRI privato**.

Non committare i DOCX/PDF/XLSX/PNG generati nel repository pubblico. I file di prova restano nel computer di test.

## Collaudo reale end-to-end richiesto a Codex

Per **ciascun** scenario:

1. Aprire **Generatore DUVRI** in ambiente isolato, non la schermata checklist/audit. Caricare il **DOCX compilato** nel campo Checklist Word e gli allegati nei rispettivi campi; non copiare dati da SafetyChecklist o dalle altre commesse.
2. Confermare che tutti i documenti abbiano ID/versione/hash distinti e che il **manifest JSON generato localmente sia solo un riferimento**: il backend deve verificare realmente byte, MIME e provenienza.
3. Estrarre tutti i paragrafi, le righe PDF, i fogli XLSX e le immagini; confermare a mano i risultati OCR. Verificare origin locator (`paragraph`, `page:line`, `sheet:row`, `image:ocr`).
4. Avviare soltanto gli specialisti **effettivamente disponibili e autorizzati** (se Ollama non è installato, dichiarare chiaramente screening deterministico/simulato). Nessuna scorciatoia dalla UI che inventi un risultato AI.
5. Registrare le **interferenze concrete** fra committente, appaltatori, altre imprese e terzi, le misure proposte, le fonti e gli elementi mancanti. Nessuna conclusione “non esistono rischi” desunta da una checklist incompleta.
6. Produrre **una bozza Word distinta per ogni caso**, con il master Colligo privato (mai il DOCX checklist come modello), `BOZZA SINTETICA – NON EMETTIBILE – NON APPROVATA`. Se mancano gate per la bozza ufficiale, usare esclusivamente la modalità demo già esistente e registrare il blocco; **non forzare D1/D2 o l'emissione**.
7. Applicare `tools/duvri_realistic_synthetic_output_audit.py --case-id <ID> --docx <BOZZA>`: controlla termini pertinenti, affermazioni non supportate, candidato strutturale NON EMETTIBILE, restituendo **solo indici e codici**, mai testi aziendali. Questo **non** conferma la qualità professionale e non sostituisce il matching delle fonti.
8. Nella vera sessione desktop Word, esportare le **pagine effettive** della stessa revisione. Verificare SHA del DOCX e di ogni PNG, ordine, leggibilità, header/footer, tabelle, marcatura su ogni pagina. Tutte le pagine iniziano **PENDING** e il revisore deve essere diverso dal generatore.
9. Introdurre intenzionalmente una revisione obsoleta, un allegato di altro fascicolo, un dato OCR non confermato e un conflitto tra checklist e cronoprogramma: devono produrre blocchi e nuove domande, **non** dati inventati o approvazioni.
10. Produrre un **rapporto privato di accettazione per ciascun DUVRI**: identificativi opachi, SHA/commit, N pagine, N fonti verificate, N interferenze proposte, lacune, errori, QA Word, status D1/D2, stato finale e prove del blocco dell'emissione. Non pubblicare documenti, immagini o dati reali su GitHub.

**Esiti possibili:** `DRAFT_PENDING_HSE_REVIEW`, `DRAFT_WITH_BLOCKING_CLARIFICATIONS`, `BLOCKED_MISSING_CRITICAL_DOCUMENTS`, `BLOCKED_UNAVAILABLE_HSE_ADAPTER`, `RENDER_FAILED`, `QA_VISUAL_PENDING`. Nessuno coincide con “DUVRI APPROVATO”.

## Criteri oggettivi di chiusura tecnica

- 4 fascicoli generati realmente, con **4 checklist DOCX** e allegati del caso.
- 4 tentativi distinti in backend privato; nessuna contaminazione fra documenti, note, revisori e file di fascicoli diversi.
- 4 bozze DOCX **se autorizzate dalla modalità demo**; in alternativa, blocchi espliciti e spiegati per ciascun fascicolo, senza successi fittizi.
- Interferenze coerenti con gli attori, le attività contemporanee e le evidenze. Scenari con documentazione critica mancante non possono diventare “sicuri”.
- Nessun testo di supermercato/punto vendita in uno scenario che descrive centro logistico; nessuna frase di scenario precedente riciclata per errore.
- Tutti i campi previsto→compilato riconciliati; *11/12* come caso H deve essere segnalato, non corretto automaticamente.
- Bozze marcate in ogni pagina Word, revisioni Word/PNG legate allo stesso hash e registro di revisione reale: **mai approvare per semplice numero pagine**.
- Il vecchio modulo checklist deve conservare i test esistenti e rimanere operativo anche **con il generatore spento**. Il generatore deve funzionare con DOCX ricevuti dall'esterno anche senza dati della PWA checklist.
- **Zero € di costi AI**, nessuna API cloud, nessuna installazione automatica, nessun invio dati cliente, nessun merge/deploy.
- D1/D2 e approvazione umana sono decisioni tecniche aziendali separate: non sono “test tecnici da far passare” artificiosamente.

## Comandi di sviluppo

```bash
node --test tests/duvri-realistic-synthetic-acceptance.test.js
python3 -m unittest discover -s tests/python -p "test_duvri_realistic_synthetic_*.py" -v
python3 tools/duvri_realistic_synthetic_bundle.py --out /tmp/duvri_synthetic_corpus
```

Il generatore di fixture **non genera il DUVRI finale**: quello è precisamente ciò che deve dimostrare il backend privato indipendente. I test GitHub verificano contratti, file di ingresso reali e divieti; Codex fornisce le prove Word end-to-end dal PC.