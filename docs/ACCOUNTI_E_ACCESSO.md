# Account tecnici e accesso

Questa fase aggiunge Firebase Authentication (email/password usato internamente), profili `utenti/{uid}`, audit `attivita`, regole Firestore e la funzione amministrativa `manageUsers`. L'applicazione continua a usare un solo URL e le stesse collezioni condivise. Non contiene credenziali Admin SDK.

## Configurazione iniziale, da eseguire dopo approvazione

1. Nel progetto Firebase `safety-checklist-colligo`, abilitare il provider Email/Password e aggiungere `leo12testa-jpg.github.io` ai domini autorizzati di Authentication. Il mapping interno è deterministico: `username` normalizzato in lowercase e senza spazi diventa `${username}@safetychecklist.local`; l'indirizzo non è mostrato nell'interfaccia e non è usato come recapito email.
2. Installare Firebase CLI e Node.js 22. Creare il service account runtime `safety-checklist-user-admin@safety-checklist-colligo.iam.gserviceaccount.com` con i soli ruoli IAM `Firebase Authentication Admin` (`roles/firebaseauth.admin`) e `Cloud Datastore User` (`roles/datastore.user`). Il deployer deve poterlo associare alla Function. Un operatore con gli stessi permessi sui servizi avvia `gcloud auth application-default login`, poi può eseguire `node functions/bootstrap-team.js` da terminale interattivo. Lo script crea in un unico passaggio i 14 account iniziali (Leonardo Testa admin + 13 tecnici, Fabio Bassi escluso), chiede una sola password iniziale comune due volte senza mostrarla e non la scrive su file, Firestore o argomenti. Gli account già presenti vengono saltati senza duplicarli. `bootstrap-admin.js` resta disponibile se si desidera creare solo il primo admin.
3. Installare le dipendenze con `cd functions && npm install`, tornare alla root, poi distribuire la funzione amministrativa e le regole Firestore con Firebase CLI. La funzione `manageUsers` è invocabile via HTTPS, ma ogni richiesta richiede un ID token Firebase valido e per le operazioni amministrative verifica lato server il profilo admin attivo con Admin SDK. Distribuire regole e frontend come un'unica finestra coordinata: le regole nuove richiedono autenticazione e i client della vecchia build smetteranno di sincronizzare finché non effettuano l'aggiornamento e il login.
4. Dopo il bootstrap iniziale Leonardo accede e usa **Utenti** solo per la gestione ordinaria: nuovi ingressi, disattivazione/riattivazione e reset. Il backend crea l'account Auth e il profilo Firestore in modo compensativo; la password è trasmessa solo nella richiesta HTTPS e non viene persistita dall'app. Password iniziali: almeno 12 caratteri. Non esiste una registrazione pubblica.

Il reset non invia email perché gli indirizzi `.local` non sono caselle reali: il backend genera un link Firebase e l'admin lo consegna al tecnico su un canale sicuro. Il link apre il gestore di azioni Firebase configurato per il progetto. Il reset da parte dell'admin e l'eventuale cambio password dalla UI Firebase vanno provati con un account pilota prima del rollout.

## Identità, offline e dati esistenti

Firebase Auth usa persistenza `LOCAL`; SDK conserva la sessione per refresh, riapertura e PWA. Dopo una prima verifica online, il dispositivo conserva soltanto i campi non segreti del profilo (uid, username, nome, cognome, ruolo e stato) per consentire l'accesso locale offline. L'app non salva manualmente password o token; la persistenza della sessione è gestita esclusivamente dal Firebase Auth SDK. Un accesso iniziale su un dispositivo nuovo richiede rete.

Ogni sopralluogo nuovo registra i campi `creato_da_*`; le modifiche registrano `ultimo_aggiornamento_da_*`. Il campo `Tecnico` continua a indicare chi era presente. I record storici mantengono l'assenza di uid; la UI li descrive come **Dato precedente al sistema account**. Non viene eseguita alcuna migrazione massiva.

Gli eventi `attivita` non contengono risposte o note; sono accodati in IndexedDB quando offline e inviati al ritorno online. Le regole verificano proprietario, nome, tipo e timestamp server. Gli operatori leggono i propri eventi; gli admin possono leggerli tutti. Il flusso locale-first e le collezioni condivise restano comuni a tutti gli account.

Le regole Firestore richiedono un profilo attivo per leggere o modificare i sopralluoghi. Tutti gli utenti attivi continuano a condividere la stessa collection `sopralluoghi`; ogni nuovo record e aggiornamento deve includere l'identità autenticata. La disattivazione viene controllata dalla funzione amministrativa e dalle regole, e la sessione online viene ricontrollata periodicamente. In assenza di rete, una sessione già verificata resta disponibile localmente; Firestore non può sincronizzare finché la connessione non torna.

## Limiti e verifica prima della pubblicazione

Il bucket e l'integrazione Supabase restano invariati: questa fase non introduce credenziali o policy Supabase nuove. La sicurezza delle foto rimane quella attuale, separata da Firebase Auth. La pubblicazione richiederà la configurazione Auth Console e il deploy coordinato di funzione/regole, che questo candidato non esegue.

Supabase Edge Functions richiede il piano Firebase Blaze per il deploy; prima di abilitarlo vanno concordati billing account e avvisi di budget. La Function usa Node.js 22, per evitare il runtime Node.js 20 prossimo al termine del supporto.

Prima dell'approvazione finale vanno verificati con account pilota e ambienti di test isolati: login riuscito/errato, sessione persistente, disattivazione, ruoli nelle regole, creazione account/reset, audit online/offline e compatibilità delle vecchie build durante l'aggiornamento. Dopo l'integrazione vanno inoltre rieseguite le suite già esistenti realtime, local-first, foto, PDF e PWA; nessun test deve essere allentato per farlo passare.

## Bootstrap WebKit e identità multiutente

`firebase-config.js` prepara una sola istanza Firestore prima dell'avvio di Auth e applica immediatamente le settings WebKit/long-polling. `auth.js`, `sync.js`, audit e schermate account riusano quell'istanza, evitando di tentare `settings()` dopo la prima lettura Firestore. Quando un operatore modifica un sopralluogo, uid, username e nome dell'ultimo operatore ricevono tutti lo stesso timestamp di campo: il merge multi-dispositivo non può quindi ricomporre un'identità mista fra il vecchio e il nuovo operatore.


## Gestione utenti senza costi
La gestione utenti usa una Supabase Edge Function già ospitata nel progetto foto. Non richiede il piano Firebase Blaze. La disattivazione avviene sul profilo Firestore `attivo=false`; le regole Firestore bloccano immediatamente letture e scritture cloud. Il tecnico può cambiare autonomamente la propria password dall'app.
