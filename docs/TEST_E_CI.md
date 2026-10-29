# Test e CI — SafetyChecklist

Riferimento per capire quali controlli bloccano una pull request, quali girano solo dopo il merge su
`main` e quali script **non devono mai** essere eseguiti in CI.

## 1. Workflow e momento di esecuzione

| Workflow (file) | Pull request verso `main` | Push su `main` | Cosa copre |
|---|---|---|---|
| SafetyChecklist quality gate (`safetychecklist-ci.yml`) | sì, sempre | sì | Guardia anti smoke live (§3), sintassi `js/*.js` e service worker, coerenza manifest checklist/loghi clienti, `node --test tests/*.test.js` (tutti i test unitari, compresi `ore-*` e `document-generation-*`). |
| SafetyChecklist core check (`final-v1-check.yml`) | sì, se cambiano `tests/**`, `index.html`, `css/**`, `js/**`, `service-worker.js`, `version.json`, `firestore.rules`, `checklists/**` | sì | Test unitari esclusi `ore-*`, sintassi, coerenza build/ruoli, smoke PWA e PDF in Chromium, smoke layout locale. Solo dopo il push: attesa della build pubblicata, smoke layout live e smoke di sicurezza pubblico. |
| SafetyChecklist isolated QA (`safetychecklist-qa-v1.yml`) | sì, se cambiano app, `firestore.rules`, `manage-users`, `tests/qa-*` | no | Emulatori Firebase locali + test browser Chromium/Firefox/WebKit su dati sintetici. |
| SafetyChecklist Storage and Deno security (`safetychecklist-storage-security.yml`) | sì, sempre | no | `deno check` delle Edge Function (manage-users, photo-access, document-jobs con `validation.ts`, document-worker con `anthropic-client.ts`, `docx-generator.ts`, `duvri-agent.ts`, `cost-meter.ts`), `deno test supabase/functions/document-worker/ supabase/functions/document-jobs/` (senza permessi: rete, env e `Deno.serve` simulati), Supabase **locale** (Storage + RLS reali) e test di autorizzazione Deno con emulatori Firebase. |
| Interparking browser regression (`interparking-browser-check.yml`) | **no** | sì (percorsi app) | Marker Interparking su Chromium/Firefox/WebKit. |
| Ore Produttivita check (`ore-produttivita-check.yml`) | **no** | sì (percorsi `ore-*`) | Contratto UI Ore, `node --test tests/ore-*.test.js`, test browser locali, poi smoke **statici** sulla build pubblicata su Pages (solo `curl` di file pubblici e screenshot). Nessun secret, nessun login. |

Conseguenza: `interparking-browser-check` e `ore-produttivita-check` **non bloccano mai** la PR
`feat/documenti-ai-checklist` (#18); i loro esiti compaiono solo dopo il merge.

Tutti i workflow hanno `permissions: contents: read` e non usano secret.

## 2. Test della generazione documentale

- `tests/document-generation-ui-contract.test.js`: test **comportamentali**. `js/document-generation.js`
  viene eseguito in un contesto `vm` con un DOM minimo costruito dal markup reale di `index.html`,
  `fetch` spia e `appIdentity` finto. Verifica: con cloud disattivato nessuna richiesta di rete e
  scheda solo locale senza contenuto dei file; checklist obbligatoria; date incoerenti; consenso AI
  obbligatorio prima del caricamento; richiesta `create` autenticata e multipart; messaggi d'errore
  del gateway; traduzione di tutti gli stati del job e azioni ammesse; revisione solo per admin;
  divieto di `innerHTML`.
  Include la regressione del controller corretta (inizializzazione annidata nel click di "Aggiungi
  impresa"): coda letta al caricamento, nessun listener duplicato, apertura dal menu.
- Test Deno (workflow Storage/Deno, nessun permesso richiesto):
  - `document-worker/anthropic-client.test.ts`: richiesta per agente (modello, effort, thinking,
    max_tokens), assenza di parametri di campionamento, header beta Files API solo con file,
    stop_reason, classificazione HTTP ritentabile/non ritentabile, upload e cancellazione file;
  - `document-worker/cost-meter.test.ts`: costi token e durata del credito;
  - `document-worker/duvri-agent.test.ts`: validazione bozza e QA, revisione umana obbligatoria;
  - `document-jobs/index.test.ts` e `validation.test.ts`: chiave Firebase fail-closed (503),
    proprietà del job, transizioni, consenso, validazione file (estensione, MIME, magic bytes).
- `tests/document-generation-backend-contract.test.js`: solo ciò che non ha equivalente
  comportamentale. Verifica che i Deno test sopra esistano e siano nel workflow; lo schema
  `schema.draft.sql` (RLS, bucket privato, claim atomico), che non viene applicato in CI; il
  collegamento interno del worker (`index.ts` chiama `Deno.serve` all'import e non esporta le
  fasi): attivazione e consenso prima di ogni fase, cancellazione dei file dal provider in
  `finally`, gate DOCX e regola di rischio, consumo per agente. Verifica inoltre che il motore usi
  solo Claude API (nessun riferimento a OpenAI; `DOCUMENT_AI_PROVIDER` resta solo come guardia).
  Per renderlo comportamentale servirebbe esportare `processOne`/`extractDocuments` con
  dipendenze iniettabili.

### Chiave Firebase nei test

Le Edge Function leggono la chiave Web API Firebase solo da `SAFETYCHECKLIST_FIREBASE_API_KEY` e
rispondono 503 se manca. Nei test si usa sempre il valore fittizio `qa-only`, mai la chiave reale:
- `tests/admin-contract-v1.test.js` e `tests/qa-support.cjs` (manage-users in `vm`) impostano
  `SAFETYCHECKLIST_FIREBASE_API_KEY: 'qa-only'`; un test verifica il 503 senza chiave e l'assenza
  di chiamate a Identity Toolkit;
- `tests/qa-deno-security.cjs` avvia in Deno reale solo manage-users e photo-access, che usano il
  ramo emulatore (`FIREBASE_AUTH_EMULATOR_HOST` + `FIREBASE_API_KEY=qa-only`);
- document-jobs e ore-produttivita-api non hanno ramo emulatore: document-jobs è testato in Deno con
  fetch simulato e chiave fittizia; nessun workflow li avvia come server.

Regola: una modifica ai test fatta per "far tornare verde la CI" deve dire nel commit se l'asserzione
è stata rafforzata, resa equivalente o indebolita, e perché.

## 3. Smoke live di produzione: `tests/ore-live-permissions.cjs`

Lo script effettua il login su **Firebase di produzione** con l'account `test.tecnico` e chiama la
Edge Function **di produzione** `ore-produttivita-api`. È uno strumento manuale da lanciare dal PC
dell'operatore dopo un deploy (vedi `ore-produttivita/VERIFICA_PILOTA.md`).

Politica:

1. **Non deve mai essere eseguito in CI**, né su PR né su push.
2. Nessun workflow può nominarlo né usare `ORE_SMOKE_*` / `ORE_ADMIN_TOKEN`. Lo verifica lo step
   "Production live smokes are never wired into CI" di `safetychecklist-ci.yml` (gira su ogni PR):
   fallisce se in `.github/workflows` compaiono il nome dello script, `ore-create-test-account`,
   variabili `ORE_SMOKE_*`, `ORE_ADMIN_TOKEN` o un glob `tests/*.cjs`.
3. `tests/ore-live-permissions.test.js` importa lo script solo per la funzione pura `adminActions`.
   L'esecuzione live parte esclusivamente con `require.main === module`, quindi l'import dai test non
   effettua chiamate di rete.
4. I glob usati dai workflow (`tests/*.test.js`, `tests/ore-*.test.js`, `find ... -name '*.test.js'`)
   non includono file `.cjs`; `scripts/prepare-release.cjs` esegue solo `*.test.js` non `ore-*`.
5. Anche se venisse lanciato su un runner Linux senza secret, lo script si fermerebbe prima della
   rete (`localCredentials` richiede Windows o `ORE_SMOKE_PASSWORD`). La guardia aggiuntiva
   raccomandata nello script stesso è descritta sotto.

Guardia raccomandata in `tests/ore-live-permissions.cjs` (all'inizio di `run()`), da applicare
con una PR separata: il gate di QA (`tests/qa-v1-run.cjs`) vieta modifiche a `tests/ore-*` in questa PR.

```js
if (process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true') {
  throw new Error('Smoke live di produzione: esecuzione in CI vietata.');
}
```

## 4. Supabase locale nel workflow Storage/Deno

Nei run della PR #18 lo step "Start dedicated local Storage and real RLS" è fallito più volte con
`toomanyrequests` durante il pull delle immagini Docker (registry `ghcr.io`), mai per porte,
versione della CLI o test. Il workflow ora:

- ritenta solo `supabase start` fino a 3 volte, con `supabase stop --no-backup` e attesa crescente
  tra un tentativo e l'altro (gli strati già scaricati restano in cache);
- ha un timeout di 15 minuti sullo step;
- usa `concurrency` con `cancel-in-progress` per la stessa PR, così i push ravvicinati non
  avviano decine di pull paralleli.

Nessun test viene saltato: se l'avvio fallisce tre volte il job fallisce.

## 5. Comandi locali

```bash
node --test tests/*.test.js
npx -y deno@2.5.4 test supabase/functions/document-worker/
```

Prima di qualunque test manuale che possa contattare Firebase o Supabase, bloccare le chiamate verso
i servizi di produzione: la sincronizzazione Firestore è attiva indipendentemente dall'hostname.
