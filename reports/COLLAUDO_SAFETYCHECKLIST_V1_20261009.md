# SafetyChecklist V1.0 — rapporto finale di collaudo

**Data:** 9 ottobre 2026. **Build candidata:** `20261009-qa-v1`.

**Giudizio: NON PRONTA.** Tutti i 313 casi eseguibili della suite finale sono superati, ma la firma grafica richiesta è assente e l'autorizzazione effettiva delle fotografie non è stata collaudata con policy Supabase reali in un progetto separato. Questi punti impediscono la certificazione completa richiesta. Nessun merge o deploy è stato eseguito.

## Base, isolamento e protezione dei dati

- Repository: `leo12testa-jpg/SafetyChecklist`.
- Base: `main`, commit `aa67eec93768168cc72cb8c9126bf07bcc08963e`, ottenuto con fetch prima delle modifiche.
- Branch: `qa/safetychecklist-v1-20261009`, in un worktree separato. La copia originale, con modifiche non committate, è stata preservata.
- Firebase Auth/Firestore: emulatori locali, progetto **`demo-safety-qa-v1`**. Nessuna operazione sui progetti aziendali.
- Storage: mock HTTP locale in memoria. Account `qa.*`, sedi `QA-*`, fotografie canvas e PDF sintetici. Sono bloccate le richieste browser esterne al server locale e agli emulatori.
- Nessun sopralluogo, utente, fotografia o documento reale modificato, cancellato o sovrascritto. Nessuna migrazione o cancellazione massiva in produzione.
- Nessun servizio a pagamento attivato. Il repository è pubblico; la nuova CI usa runner Ubuntu standard e strumenti di test gratuiti.
- Ore Produttività, le sue funzioni Supabase, i suoi test e gli altri progetti non sono stati modificati.

L'audit finale [cleanup.json](qa-v1/cleanup.json) ha verificato **zero** sopralluoghi, eventi audit, record utilizzo, profili e account Auth residui nel namespace demo e **zero** profili browser temporanei. Il mock fotografico è stato svuotato e gli emulatori vengono arrestati a fine lavoro. PDF e screenshot sintetici sono conservati soltanto come evidenza di QA.

## Conteggio dei test realmente eseguiti

| Gruppo nella suite finale | Eseguiti | Superati | Falliti |
|---|---:|---:|---:|
| Sintassi JavaScript dell'app | 1 | 1 | 0 |
| Manifest, checklist, loghi, build e controllo ambito | 1 | 1 | 0 |
| Regressioni unitarie SafetyChecklist, 29 file | 261 | 261 | 0 |
| Generazione/importazione/anteprima/download PDF in Chromium | 12 | 12 | 0 |
| Accesso, ruoli, CRUD, foto, sincronizzazione e interfaccia | 31 | 31 | 0 |
| PWA, crash, aggiornamento e offline | 7 | 7 | 0 |
| **Totale finale** | **313** | **313** | **0** |

Nessun test unitario saltato. Il conteggio rappresenta i casi della **suite finale**, senza sommare ripetizioni dello stesso caso durante le correzioni né conteggiare ogni singola asserzione come un test. Anche la suite iniziale è stata realmente eseguita: 234/234 test superati; i problemi aggiuntivi sono emersi estendendo il collaudo.

Evidenze: [riepilogo macchina](qa-v1/summary.json), [TAP unitario completo](qa-v1/unit-final.tap), [scenari browser](qa-v1/browser/results.json), [scenari PDF](qa-v1/pdf/results.json), [scenari PWA](qa-v1/pwa/results.json). L'esecuzione finale locale si è svolta dalle 17:12:50 alle 17:14:07, ora italiana; ulteriori regressioni mirate e audit di pulizia sono documentati nei log `qa-v1-*-before/after.tap`.

## Analisi repository e workflow

L'app è una SPA JavaScript senza framework, con HTML/CSS, IndexedDB, Firebase compat SDK, Supabase JS, jsPDF, AutoTable, PDF.js e JSZip vendorizzati. Moduli esaminati: routing/dashboard, nuovo sopralluogo, checklist, navigatore, database, login/identità/audit, gestione utenti, storico/cestino/filtri, camera, sincronizzazione testuale e foto, generazione PDF, estrazione PDF, matching e aggiornamento PWA. Esaminate tutte e cinque le checklist, le configurazioni, le regole e la funzione `manage-users`.

PROJECT.md e TASKS.md erano specifiche/roadmap originarie: indicavano assenza di login/cloud, firma, sotto-form NC e validazioni che non corrispondono al codice corrente. README citava un JSON `people_design` assente; la guida account citava bootstrap e Firebase Cloud Functions non presenti. La documentazione è stata riallineata, preservando la roadmap come riferimento storico.

Ultimi workflow letti da GitHub prima del collaudo: quality gate [37801089374](https://github.com/leo12testa-jpg/SafetyChecklist/actions/runs/37801089374), core check [37801089400](https://github.com/leo12testa-jpg/SafetyChecklist/actions/runs/37801089400) e Pages [37801088859](https://github.com/leo12testa-jpg/SafetyChecklist/actions/runs/37801088859), tutti `success` su `aa67eec`. Le versioni precedenti mostravano anche fallimenti: non sono state scambiate per esito del candidato attuale.

Le coperture mancanti includevano numeri riutilizzati, foto di domande eliminate, mapping legacy basato solo sul conteggio, conservazione delle note concorrenti, note lunghe con frasi ripetute, crash con foto non sincronizzata, filtri cambiati durante un refresh, modifica ruolo online, cancellazione selettore foto, foto tardiva dopo navigazione e contratto telemetria backend. Gli harness PDF precedenti non rimuovevano gli script cloud versionati e non gestivano il login corrente; il nuovo harness ha un test di isolamento dedicato.

## Errori riprodotti e corretti

| Problema | Causa e correzione verificata |
|---|---|
| Risposta/nota assegnata a domanda diversa con numero riutilizzato | Il numero era accettato con similarità minima 30%. Ora serve testo sufficientemente forte e univoco; altrimenti conferma manuale. |
| 75 righe Interparking considerate automaticamente certe | Conteggio/posizione potevano anche ritirare righe o risolvere conflitti senza evidenza testuale. Ora sono proposte da verificare; rimosso il risolutore automatico numerico dei conflitti. |
| Foto collegata mediante numero di didascalia di domanda eliminata | La didascalia numerica poteva cadere sull'id corrente. Ora il collegamento usa righe importabili oppure testo univoco; resta non assegnato se incerto. |
| Nota lunga troncata tra pagine | Il banner AutoTable ripetuto azzerava il proprietario della continuazione. Conservato il contesto della riga. |
| Frasi ripetute di note multipagina perse | La deduplicazione per sottostringa eliminava contenuti legittimi. Le note consecutive vengono concatenate integralmente e in ordine. |
| Nota/foto concorrente sulla stessa domanda persa | Il merge conservava soltanto il valore vincente. Ora conserva versioni precedenti con risposta, nota e foto; UI di consultazione/ripristino e sincronizzazione dei blob storici. |
| Salvataggio in coda e realtime potevano usare nuovi controlli/domanda | Ora destinazione e valori sono catturati prima dell'attesa; il realtime non ridisegna controlli durante salvataggi/navigazione. Le note sono salvate anche durante la digitazione. |
| Evento audit perso se Firestore falliva | L'eccezione usciva prima dell'accodamento. Ora l'evento resta nell'outbox locale e viene ritentato. |
| Filtri storico modificati dall'utente ripristinati ai valori precedenti | Il render catturava lo stato prima delle letture async. Ora legge i filtri correnti e scarta render obsoleti. |
| Ruolo UI rimaneva obsoleto dopo modifica server | Il ricontrollo verificava solo `active`. Ora rilegge il profilo, aggiorna i privilegi e protegge la rotta già aperta. |
| Telemetria frontend senza azioni backend corrispondenti | Aggiunte `usagePing`/`usage`, scrittura per uid verificato e timestamp server; regole emulatore con accessi negati agli altri utenti. |
| Elenco utenti limitato ai primi 100 | Gestita la paginazione Firestore e verificato il 101° account mediante mock del contratto. |
| Primo avvio offline dopo aggiornamento: `fotoSync is not defined` | URL di precache priva del parametro di versione. Allineata all'HTML; regressione controlla ogni script/stile con URL esatta. |
| Annullamento selettore foto lasciava il pulsante bloccato | Gestito l'evento nativo `cancel`; la promise termina senza errore. |
| Upload foto terminato dopo cambio domanda | Il completamento usava i controlli della nuova domanda. Ora aggiorna il proprietario originale usando i dati salvati più recenti. |

Ogni correzione dispone di regressioni effettivamente eseguite. I log di riproduzione contengono fallimenti reali prima della correzione; i test precedenti che si aspettavano associazioni numeriche non sicure sono stati aggiornati per richiedere verifica, senza nascondere i conflitti.

## Importazioni e generazione PDF

| Checklist | Domande confrontate una per una | Pagine renderizzate | Foto sintetiche | Righe da confermare |
|---|---:|---:|---:|---:|
| Coin | 60 | 8 | 1 | 2 |
| Interparking | 73 | 8 | 1 | 0 |
| Restage | 55 | 8 | 1 | 0 |
| Melluso | 57 | 8 | 1 | 0 |
| Carrefour | 75 | 9 | 1 | 4 |
| **Totale** | **320** | **41** | **5** | **6** |

Tutte le risposte C/PC/NC/NA, le risposte mancanti e le note sono state confrontate con il record sorgente; nessun trasferimento sulla domanda precedente/successiva. Ogni documento contiene una nota di **7.774 caratteri**, con frasi ripetute e marcatore finale, conservata integralmente attraverso le pagine. Le righe da confermare non vengono importate automaticamente; il test usa il pulsante esplicito di conferma associazione.

Un ulteriore PDF fittizio di vecchia versione verifica domande rinumerate, spostate, eliminate, simili e senza risposta. Risposta e nota rimangono nel pacchetto sorgente. L'anteprima non crea un sopralluogo; la conferma lo salva una volta sola. Il caricamento dal vero input file è stato eseguito, così come annullamento, rifiuto PDF corrotto, anteprima canvas, download reale e riapertura con PDF.js. Foto e record fotografico risultano sulla stessa domanda.

Controllo visivo eseguito su tutte le 41 pagine mediante i cinque contact sheet e su pagine singole a maggiore risoluzione: intestazioni, griglie, continuità delle note, numeri, legenda C/PC/NC/NA, foto/didascalie e loghi. Carrefour compare correttamente senza PNG corrotto. I segni NC sono nelle colonne previste; non è presente un sotto-form NC dedicato né una sezione firma.

Documenti e immagini: [Coin](qa-v1/pdf/coin.pdf), [Interparking](qa-v1/pdf/interparking.pdf), [Restage](qa-v1/pdf/restage.pdf), [Melluso](qa-v1/pdf/melluso.pdf), [Carrefour](qa-v1/pdf/carrefour.pdf). Contact sheet nella stessa cartella, suffisso `-contact.png`.

## Sincronizzazione e sicurezza degli accessi

Tre contesti browser con profili isolati hanno scritto lo stesso sopralluogo tramite Firestore emulator. Verificati modifiche su domande diverse, stessa domanda, conservazione e ripristino delle note concorrenti, foto su secondo dispositivo, Storage 503, interruzione Firestore, retry, offline, reload, ritorno online e conservazione dei blob. La prova di crash usa realmente `Page.crash`: nota e foto erano solo locali, il documento remoto era ancora 404; dopo riapertura sono stati riletti dal profilo persistente.

Login errato/corretto, logout, persistenza, cambio account e cambio password sono passati usando Auth emulator. Negati accesso anonimo a Firestore, profilo inattivo, elevazione del tecnico, audit falsificato e scrittura utilizzo di un altro uid. Verificati gestione utenti admin, creazione fittizia, duplicati, password corta, compensazione del fallimento del profilo, disattivazione e cambi ruolo. Nessun errore JavaScript applicativo negli scenari finali.

Gli errori di rete/HTTP deliberatamente provocati sono presenti nei log e non vengono presentati come console pulita in quelle fasi. Nei contesti emulati lo Storage verifica trasporto/retry, **non** l'autorizzazione del bucket reale. Nessun risultato positivo viene attribuito alle policy Supabase non testate.

## Interfaccia e prestazioni

Chromium/Google Chrome, desktop `1440×1000`, tablet `768×1024`, smartphone `390×844`. Verificati home, nuovo sopralluogo, compilazione, storico e PDF, assenza di overflow orizzontale, ricerca, radio risposta, note, file chooser foto, ridimensionamento JPEG a 1280 px, chiusura/riapertura, modifica, cestino e ripristino dei soli record fittizi. Conservati screenshot; nessun restyling effettuato.

Misure nel run locale finale: creazione locale e ricezione 233 ms; generazione/anteprima PDF 832 ms desktop, 735 ms tablet e 649 ms smartphone. Il caso con ritardo rete artificiale di 700 ms sulle checklist si è completato in 1.495 ms. Sono misure del computer di test, non benchmark di dispositivi fisici né garanzie del cloud produttivo.

## Verifiche non eseguibili e problemi residui

Cinque gruppi di verifica non completati, registrati separatamente dai 313 test superati:

1. **Firma grafica e firma nel PDF:** funzione assente nel codice corrente; nessun esito positivo dichiarato. È un requisito della richiesta e blocca il rilascio completo.
2. **Policy effettive Storage:** manca un progetto Supabase di test con policy equivalenti. Il client usa la chiave publishable e non inoltra automaticamente il login Firebase; non si può certificare la protezione foto dal solo login UI. Verifica fondamentale bloccante.
3. **Runtime Deno/Supabase reale:** Deno e Docker non disponibili. Il codice della funzione è stato eseguito con shim e API emulata, ma non nel runtime ospitato.
4. **Safari/WebKit, telefono fisico e camera fisica:** WebKit non installato e nessun dispositivo disponibile. Chromium responsive e file chooser sono verificati; questi risultati non certificano Safari/iOS o l'hardware.
5. **PDF aziendali storici originali degli harness legacy:** `test-sample` non è presente su `main`. La compatibilità è verificata con PDF sintetici dalle checklist reali e versioni fittizie mutate, non con un corpus aziendale completo.

I controlli obbligatori non completati impediscono merge e pubblicazione anche con la suite automatica verde. Il nuovo backend/regole richiederebbe un rilascio coordinato separato; nessuno è stato eseguito. Restano anche limiti di prodotto originari documentati: niente sotto-form NC dedicato e condivisione di tutti i sopralluoghi fra tutti gli utenti attivi.

## Commit, PR e riproducibilità

Commit delle correzioni: [`0e0ac2a`](https://github.com/leo12testa-jpg/SafetyChecklist/commit/0e0ac2a).

Pull Request **in bozza**: [#13 — Collaudo V1: correggi perdita dati e importazioni PDF non sicure](https://github.com/leo12testa-jpg/SafetyChecklist/pull/13). La CI `SafetyChecklist isolated QA` esegue la stessa suite negli emulatori, senza deploy. Le evidenze locali non vengono confuse con lo stato dei check GitHub della PR.

Istruzioni: [COLLAUDO_ISOLATO.md](../docs/COLLAUDO_ISOLATO.md). Il rapporto documenta attività realmente eseguite e limiti verificati; non certifica una pubblicazione o il funzionamento di servizi produttivi non collaudati.

**NON PRONTA — verifiche fondamentali non completate.**
