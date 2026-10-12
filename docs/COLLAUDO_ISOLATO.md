# Collaudo isolato SafetyChecklist V1

Gli harness usano esclusivamente `demo-safety-qa-v1`: Auth `127.0.0.1:19099`, Firestore `127.0.0.1:18085`, configurazione `firebase.qa.json`. Non eseguire due suite contemporaneamente nello stesso namespace. Nessun login/test account viene creato in produzione.

## QA applicativa

Node 22 aggiornato, Java 21, Google Chrome e strumenti di test: Playwright 1.55.0 e Firebase CLI 15.31.0. In Actions vengono installati anche Firefox e WebKit. I browser hanno profili temporanei separati e un blocco di rete che ammette soltanto server locale ed emulatori.

```sh
firebase emulators:exec --only auth,firestore --project demo-safety-qa-v1 --config firebase.qa.json "node tests/qa-v1-run.cjs"
```

Con `QA_CROSS_BROWSER=1` si aggiungono i 31 scenari di Firefox e WebKit. `QA_BROWSER=firefox` seleziona una singola esecuzione di `qa-browser.cjs`. Il loader Windows può riutilizzare i browser/driver già presenti, registrando separatamente il motore usato; la CI usa versioni coerenti installate nel job.

La QA include tutte le regressioni originali V1, 320 domande audit con roundtrip PDF, tutti i 262 quesiti DVR, sette PDF/ZIP, menu e layout 1440/768/390 px, controlli strutturati, login/ruoli/utenti, concorrenza, foto lente, retry/outbox, cestino, ricerca, crash del renderer e riapertura del browser, aggiornamenti e cache offline. I fixture storici sono copie anonimizzate, con risposte, note, foto e didascalie fittizie; gli originali non sono necessari alla CI e non vengono modificati.

Chromium verifica anche il flag offline del browser e il crash reale tramite CDP. Sugli altri motori il guasto di rete viene riprodotto chiudendo le risposte HTTP e bloccando Firestore: queste due strategie sono registrate distintamente. Un viewport mobile/WebKit automatizzato non certifica una fotocamera fisica, Safari iOS o l'installazione su telefono.

## Deno e Storage reale separato

Il workflow `safetychecklist-storage-security.yml` crea container effimeri Supabase/Postgres/Auth/Storage, applica le tre concessioni legacy anonime più il gate restrittivo, poi esegue il codice TypeScript reale con Deno 2.5.4 e Firebase emulatori. Nessun progetto produttivo viene usato come ambiente di staging.

```sh
deno check supabase/functions/manage-users/index.ts supabase/functions/photo-access/index.ts
supabase start --workdir tests/storage-local --exclude realtime,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor
supabase status --workdir tests/storage-local -o env > /tmp/storage-env.txt
node tests/qa-storage-env.cjs /tmp/storage-env.txt
```

Fuori da Actions, `qa-storage-env.cjs` scrive un file locale ignorato dal Git con variabili `QA_REAL_STORAGE_URL`, `QA_REAL_STORAGE_KEY`, `QA_REAL_STORAGE_ANON`. Importale nell'ambiente del processo senza stampare valori, poi esegui:

```sh
firebase emulators:exec --only auth,firestore --project demo-safety-qa-v1 --config firebase.qa.json "node tests/qa-deno-security.cjs"
supabase stop --workdir tests/storage-local --no-backup
```

Il gate prova accesso autorizzato byte-per-byte ai percorsi legacy, anonimi/inattivi/non autorizzati, revoca, traversal, upload immutabile e retry, listing Storage e utenti Supabase autenticati senza identità Firebase. Le chiavi privilegiate restano soltanto nell'ambiente Deno. L'output dichiara esplicitamente se Storage è reale o mock; solo il caso reale certifica RLS. Docker assente sul PC non impedisce di usare il job CI isolato.

## Evidenze e pulizia

`reports/qa-v1/summary.json`, risultati browser/PDF/DVR/PWA, TAP e immagini sono rigenerati per ogni esecuzione. Gli artefatti Actions contengono solo dati fittizi. Gli exit code e i casi fatali fanno fallire il gate, anche con zero test contati.

`qa-cleanup-audit.cjs` verifica che namespace Firebase e profili temporanei siano vuoti; non cancella dati. Il gate Deno verifica la rimozione degli oggetti e dell'account Supabase creati nel container separato. Non ripulire database produttivi o cartelle di lavoro dell'utente. La firma grafica è esclusa dai requisiti V1; nessun mock o emulatore autorizza a dichiarare superato un test fisico.
