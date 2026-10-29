# SafetyChecklist

PWA di Colligo Ingegneria per sopralluoghi HSE e Raccolte dati DVR. L'app salva prima in IndexedDB, sincronizza i dati con Firestore e usa Firebase Authentication per accesso e ruoli. Le fotografie del candidato V1 passano dal gateway `photo-access`, che verifica account, profilo e permessi prima di accedere a Supabase Storage.

App: https://leo12testa-jpg.github.io/SafetyChecklist/

**V1.0 — build 20261029-154824.** La build aggiunge la raccolta DUVRI locale (PR #22) alla V1.0 della build 20261012-140126. Collaudo, backend distribuiti e limiti delle verifiche hardware della V1.0: [rapporto di rilascio](reports/RILASCIO_V1_20261012.md). La pubblicazione avviene tramite merge della PR verificata; tutti i gate di rilascio devono essere verdi.

## Utilizzo

1. Accedi con lo username e la password assegnati dall'amministratore. Il login iniziale richiede rete; una sessione già verificata può lavorare offline. Una disattivazione viene applicata ai servizi online immediatamente e al client alla successiva verifica online.
2. Scegli **Nuovo sopralluogo** per Coin, Interparking, Restage, Melluso o Carrefour. Compila i dati iniziali e le risposte C/PC/NC/NA, note e fotografie. Puoi riprendere un lavoro incompleto dallo storico.
3. Scegli **Raccolta dati DVR** per asili, ristoranti/alberghi, uffici, attività varie o edilizia. Il riepilogo mostra le sezioni compilate e i dati mancanti. Esporta un PDF oppure lo ZIP con `risposte.json` e `foto/` per la redazione del DVR.
4. I due modelli specifici chimico e MMC rimangono disponibili per aprire ed esportare documenti esistenti; sono esclusi soltanto dal menu di avvio.
5. Scegli **Generazione documenti** per la raccolta dati DUVRI: committente, sito, una o più imprese, stato dei documenti e allegati per categoria. La scheda viene preparata solo nel browser, con l'elenco dei dati mancanti; il pacchetto ZIP contiene `ISTRUZIONI.txt`, `scheda-duvri.json` e gli allegati originali in `allegati/`. Nessun dato viene inviato in rete, caricato nel cloud o elaborato da AI, e il DUVRI non viene generato automaticamente.
6. Nello **Storico**, usa schede audit/DVR, filtri e ricerca per aprire, modificare o scaricare documenti. Il cestino consente il ripristino. Le versioni concorrenti della stessa risposta restano consultabili e ripristinabili.
7. Importa i PDF audit dal nuovo sopralluogo. Controlla l'anteprima e conferma le associazioni incerte; un numero uguale non garantisce che la domanda sia la stessa. L'annullamento non salva una nuova raccolta.

L'indicatore di sincronizzazione segnala dati/foto ancora da inviare e consente il retry. Mantieni lo stesso browser/profilo per recuperare lavori locali: cancellare i dati del sito può rimuovere modifiche e foto non ancora sincronizzate. Gli aggiornamenti PWA preservano IndexedDB e vengono rimandati durante compilazione, importazioni e finestre aperte. Non occorre distribuire ZIP dell'app agli utenti. La firma grafica è esclusa dalla V1.0.

## Documentazione attuale

- [Architettura e rilascio V1](docs/ARCHITETTURA_V1.md)
- [Accesso, ruoli e servizi](docs/ACCOUNTI_E_ACCESSO.md)
- [Collaudo isolato e riproduzione](docs/COLLAUDO_ISOLATO.md)
- [Rapporto V1 e impedimenti verificati](reports/RILASCIO_V1_20261012.md)

`PROJECT.md` e `TASKS.md` conservano materiale storico: per comportamento, collaudo e rilascio prevalgono i documenti V1 qui collegati.

## Sviluppo e test

JavaScript vanilla e librerie browser vendorizzate, senza bundler. Strumenti QA: Node 22 aggiornato, Java 21, Playwright e Firebase CLI. Docker/Supabase CLI e Deno servono al gate Storage reale; non sono dipendenze dell'app.

```sh
firebase emulators:exec --only auth,firestore --project demo-safety-qa-v1 --config firebase.qa.json "node tests/qa-v1-run.cjs"
./pubblica.sh --prepare
```

`--prepare` esegue le regressioni SafetyChecklist e assegna una build coerente senza commit, push o deploy. Dopo la preparazione, riesegui QA e sicurezza sulla build candidata e apri una PR verso `main`. GitHub Pages pubblica il merge; `./pubblica.sh --verify` controlla versione e bytes degli asset pubblicati in sola lettura.

Account, fotografie, sopralluoghi e documenti dei test sono fittizi. Il database produttivo non è un ambiente QA. Ore Produttività è un progetto distinto: nessuna sua modifica o suite browser entra nel rilascio SafetyChecklist.
