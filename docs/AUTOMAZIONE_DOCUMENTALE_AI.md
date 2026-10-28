# Progetto: generazione documentale AI in SafetyChecklist

## Obiettivo

Integrare nella SafetyChecklist esistente un flusso documentale asincrono che trasformi i dati di una checklist completata in una o più bozze di documenti aziendali (inizialmente un solo tipo di documento), mantenendo il PC del tecnico non necessario dopo l'invio del lavoro.

Il progetto deve essere incrementale: prima un prototipo isolato e verificabile, poi estensione a informative COIN, DUVRI e ulteriori elaborati.

## Vincoli non negoziabili

- Non compromettere sopralluoghi, raccolte dati DVR, sincronizzazione, foto, PDF/ZIP, autenticazione o funzionalità esistenti.
- Non toccare `ore-produttivita/` o le funzioni `ore-*`.
- Conservare l'architettura PWA vanilla/offline-first e i flussi di accesso già presenti.
- La compilazione checklist deve continuare a funzionare offline. La richiesta di generazione parte quando il dispositivo è online; se offline, deve essere segnalata come in attesa e riprovabile.
- Non eseguire lavori AI nel browser né inserire chiavi API, service-role key o segreti nel frontend.
- I lavori devono continuare nel cloud dopo che il tecnico chiude la pagina o spegne il PC/telefono.
- Le elaborazioni devono essere tracciabili, idempotenti, riprovabili e protette da accessi non autorizzati.
- I file generati sono bozze: nessun DUVRI, informativa o documento di sicurezza è approvato automaticamente. È obbligatoria la revisione di personale competente.
- Non inventare dati tecnici, rischi, misure, date o riferimenti. Le informazioni mancanti e le incertezze devono essere esplicitate.
- I modelli Word ufficiali vanno mantenuti invariati per layout, font, colori, intestazioni e piè di pagina salvo istruzione esplicita.
- Nessun deploy in produzione o uso di dati reali durante il prototipo senza QA e approvazione.

## Contesto tecnico attuale

- PWA JavaScript vanilla, pubblicata tramite GitHub Pages.
- Dati locali in IndexedDB, sincronizzazione online con Firebase Authentication e Firestore.
- Supabase Edge Functions e Storage sono già utilizzati per servizi backend selezionati.
- Le checklist e le raccolte DVR sono definite come JSON; i PDF/ZIP attuali sono generati dal client.
- Il repository contiene suite di test e una procedura di rilascio tramite PR e gate obbligatori.
- Riferimenti primari: `AGENTS.md`, `README.md`, `docs/ARCHITETTURA_V1.md`, `reports/RILASCIO_V1_20261012.md`.

## Flusso utente previsto

1. Il tecnico compila e salva una checklist come fa oggi.
2. Al completamento, l'app mostra un'azione esplicita "Genera documenti" (eventualmente pre-selezionata solo per checklist abilitate). Non inviare dati automaticamente a un provider AI senza un'azione chiara e informativa.
3. Il sistema controlla i campi obbligatori e presenta eventuali dati mancanti prima di creare il lavoro.
4. Il backend crea un job persistente e restituisce un identificativo; l'app può chiudersi.
5. Un worker cloud prende il job dalla coda, legge solo i dati autorizzati, esegue la procedura e salva bozza, log di stato e anomalie.
6. La schermata "Documenti generati" mostra stato: in coda, in elaborazione, da revisionare, completato, errore o annullato.
7. Un utente autorizzato apre/scarica la bozza da PC o telefono, corregge se necessario e registra l'esito della revisione.
8. Errori temporanei consentono retry idempotente; non devono creare documenti duplicati.

## Architettura proposta (da validare prima dell'implementazione)

### Frontend SafetyChecklist
- Nuova sezione isolata "Documenti AI" nella scheda di una checklist completata e nello storico.
- Invio di una richiesta autenticata al backend, con ID checklist/sopralluogo e tipo di documento richiesto.
- UI mobile-first per stato, anomalie, download e revisione.
- Nessun cambiamento al formato dei sopralluoghi legacy, se evitabile; preferire entità documentali separate.

### Backend
- Usare un endpoint server-side autenticato, coerente con i servizi backend già presenti.
- Verificare lato server token Firebase, profilo attivo, ruolo e autorizzazione sul sopralluogo; i controlli UI da soli non bastano.
- Persistenza dei job e stato con un meccanismo durevole (tabella/coda cloud); non affidarsi a una promessa JavaScript o a un processo lasciato in background dopo la risposta HTTP.
- Worker separato dalla richiesta dell'utente, con timeout, retry limitati, deduplicazione e gestione degli errori.
- Provider AI configurabile server-side; chiavi conservate esclusivamente nei secret del backend.
- Documenti conservati in storage privato; download con controllo autorizzazioni a ogni richiesta.
- Registrare metadati utili (job ID, tipo e versione template/skill, timestamp, stato, autore, errori e revisione), evitando di scrivere dati sensibili superflui nei log.

### Agenti/skill logici
Per il primo MVP non è obbligatorio eseguire agenti separati: si possono implementare come fasi deterministiche con istruzioni distinte.
1. Estrattore/normalizzatore: struttura le risposte e le fonti.
2. Redattore: compila esclusivamente il modello approvato.
3. Verificatore: controlla completezza, coerenza e campi non supportati dalle fonti.
4. Validatore deterministico: verifica formato, campi obbligatori, file prodotto e integrità del modello.
5. Revisore umano: unico responsabile dell'approvazione finale.

Le skill devono essere versionate nel repository e includere esempi, criteri di accettazione e casi negativi.

## MVP — ambito iniziale

- Una checklist campione.
- Un solo tipo di documento, scelto dopo aver raccolto modello vuoto e un esempio approvato.
- Generazione di una bozza, non firma né approvazione automatica.
- Stato job visibile e possibilità di riprovare.
- Archiviazione privata e download autorizzato.
- Report delle informazioni mancanti e delle verifiche necessarie.
- Test con dati sintetici; nessuna scrittura in produzione durante la QA.

## Fasi di lavoro

### Fase 0 — analisi e decisioni
- Identificare il modello documentale iniziale e le sue fonti dati.
- Confermare il provider AI e il budget/limiti.
- Verificare le opzioni di coda e storage già disponibili.
- Definire autorizzazioni per tecnico e amministratore.

### Fase 1 — contratto e prototipo isolato
- Definire schema job, stati e API.
- Creare skill/template versionati e test di validazione.
- Implementare un worker e una generazione end-to-end con dati sintetici.
- Non modificare il flusso di completamento delle checklist esistenti.

### Fase 2 — interfaccia
- Aggiungere la sezione "Documenti AI".
- Mostrare stato, anomalie, file e revisione su desktop e mobile.
- Gestire offline, timeout, retry e sessioni scadute.

### Fase 3 — QA e sicurezza
- Test unitari, integrazione backend, autorizzazione, isolamento dati, retry, duplicati e accesso ai file.
- Verificare che le checklist audit e DVR, lo storico, PDF/ZIP e l'app offline funzionino come prima.
- Eseguire test visivi a 1440, 768 e 390 px.
- Solo dopo gate verdi, aprire PR per revisione; niente deploy diretto su `main`.

### Fase 4 — estensione
- Aggiungere tipi documentali uno alla volta.
- Usare il feedback delle revisioni per migliorare template e skill con versionamento e test di regressione.

## Criteri di accettazione MVP

- Un job avviato rimane in esecuzione e termina anche se il browser viene chiuso.
- Un job non può essere letto o scaricato da un utente non autorizzato.
- Il retry non genera duplicati e non perde lo stato.
- I campi mancanti e le affermazioni non supportate vengono segnalati, non inventati.
- La bozza mantiene la struttura del modello approvato.
- Nessuna chiave segreta compare nel client o nei log.
- Tutti i test di regressione esistenti restano verdi.
- La revisione umana è obbligatoria prima dell'uso ufficiale.

## Decisioni ancora aperte

1. Primo modello da automatizzare: informativa COIN, DUVRI o altro.
2. Provider AI: API server-side da selezionare dopo aver confrontato qualità, privacy e costo; l'abbonamento ChatGPT/Claude non implica automaticamente credito API.
3. Fonte dati iniziale: checklist di sopralluogo, raccolta dati DVR o entrambe.
4. Regole di accesso: chi può avviare, leggere, revisionare e approvare ogni documento.


## Requisiti iniziali confermati — checklist DUVRI

Queste scelte sono requisiti di progettazione e NON dati riferiti a un appalto reale:

- Scenario di riferimento per il prototipo: cantiere o area di lavoro esterna.
- Complessità: elevata.
- Imprese appaltatrici: una impresa appaltatrice; la checklist deve comunque permettere di aggiungere subappaltatori e ulteriori imprese quando pertinenti.
- Documenti inizialmente disponibili: DVR specifico e cronoprogramma lavori.
- La checklist deve chiedere e distinguere i documenti disponibili, quelli non applicabili e quelli mancanti; non deve considerare automaticamente sufficienti i due documenti selezionati.

### Principio di progettazione della checklist DUVRI

La checklist non deve essere un modulo statico uguale per tutti i lavori. Deve usare una struttura a sezioni:

1. **Dati comuni obbligatori:** committente, appaltatore, luogo, oggetto e titolo dell'appalto, date, referenti e preposto (nominativo, mansione/area di competenza).
2. **Descrizione dell'intervento:** attività dettagliate, fasi, cronoprogramma, orari, aree interessate, accessi, viabilità, depositi, eventuale lavoro in quota e condizioni del sito.
3. **Mezzi e attrezzature:** descrizione, utilizzatore, proprietario, modalità d'impiego e documentazione pertinente.
4. **DPI:** DPI previsti dall'impresa per le attività, con motivazione/fonte quando disponibile; non dedurre DPI specifici senza informazioni sufficienti.
5. **Contesto del luogo:** cantiere/area esterna, ambienti interni o scenario misto; presenza di lavoratori del committente, pubblico, altre imprese, impianti in esercizio, percorsi condivisi e possibili sovrapposizioni.
6. **Documenti e allegati:** DVR specifico, cronoprogramma, planimetrie, procedure, schede di sicurezza se pertinenti, autorizzazioni e documenti relativi a mezzi/attrezzature. Per ciascuno registrare stato (disponibile, da acquisire, non applicabile), data/versione e fonte.
7. **Interferenze e misure:** raccogliere fatti e condizioni necessarie per valutare le interferenze; separare i dati forniti dall'impresa, le informazioni estratte dai documenti e le valutazioni proposte dal sistema.
8. **Controllo di completezza:** prima della generazione, produrre un elenco di lacune e domande mirate. Le informazioni critiche mancanti devono bloccare la generazione della relativa sezione o mantenere la bozza esplicitamente incompleta, senza inventare dati.
9. **Output e revisione:** bozza Word basata sul file originale approvato, report delle informazioni mancanti e verifiche da compiere; revisione umana obbligatoria.

### Regole per gli approfondimenti condizionali

- Se sono previsti lavori in quota, chiedere accessi, modalità operative, protezioni collettive e individuali, aree sottostanti e misure per impedire la presenza di terzi, secondo le informazioni e i documenti applicabili.
- Se si usano prodotti chimici, chiedere identificazione dei prodotti e schede di sicurezza pertinenti.
- Se sono impiegati mezzi o macchine, chiedere tipo, proprietà, utilizzatore, percorsi, manovre e interferenze con pedoni o altre attività.
- Se sono coinvolte più imprese o subappaltatori, abilitare raccolte separate per ciascuna impresa e valutare le sovrapposizioni tra fasi.
- Se le attività si svolgono vicino a impianti in esercizio, aree aperte al pubblico, vie di esodo o attività del committente, chiedere le condizioni operative e le misure di coordinamento.
- Gli esempi sono regole di attivazione della raccolta dati, non una valutazione automatica esaustiva dei rischi.

### Regole del modello DUVRI da rispettare

- Modificare il file DOCX originale approvato, non ricostruire il documento da zero.
- Conservare intestazioni, piè di pagina, logo, grafica, tabelle e immagini incorporate, salvo modifiche autorizzate.
- Mantenere la struttura e i capitoli indicati nel modello Colligo, correggendo indice e numeri di pagina in fase di validazione.
- Inserire l'immagine di segnaletica fornita alla fine del capitolo 2.3 senza contorni, come richiesto.
- Mantenere la tabella "TABELLA INDICI DI RISCHIO" al termine del paragrafo "Valutazione dell'indice di rischio".
- Le tabelle finali devono conservare tutti i fattori di rischio del modello; non eliminare un fattore perché ritenuto assente. Ogni valore deve essere giustificabile con il metodo aziendale approvato e i dati disponibili.
- È presente una regola da chiarire prima dell'automazione: il modello descrive una matrice con indici da 1 a 9, mentre le istruzioni richiedono celle "I.R." da 1 a 3 e colori specifici. Non applicare una conversione arbitraria: richiedere conferma del criterio aziendale.
- Verificare i riferimenti normativi rispetto alle fonti ufficiali e registrare le verifiche; non aggiornare silenziosamente formulazioni tecniche o normative.
- Il documento generato è sempre una bozza fino alla revisione e approvazione di personale competente.
