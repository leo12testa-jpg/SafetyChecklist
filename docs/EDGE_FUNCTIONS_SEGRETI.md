# Edge Functions — segreti e variabili d'ambiente

Questo documento elenca **solo i nomi** delle variabili richieste dalle Supabase Edge
Functions di SafetyChecklist. Nessun valore di chiave va scritto qui, nel codice, nei
test o nei commit.

## Perché esiste `SAFETYCHECKLIST_FIREBASE_API_KEY`

Le funzioni verificano l'ID token Firebase dell'utente chiamando, lato server,
l'Identity Toolkit API (`identitytoolkit.googleapis.com/v1/accounts:lookup`;
`manage-users` usa anche `accounts:signUp` e `accounts:delete`).

Fino a questa modifica la chiave Web API del browser era scritta nel codice come
valore di riserva. Ora:

- la chiave server arriva **solo** dalla variabile `SAFETYCHECKLIST_FIREBASE_API_KEY`;
- non esiste più alcun valore di riserva nel codice;
- se la variabile manca (fuori dagli emulatori), ogni richiesta autenticata risponde
  **HTTP 503** con il messaggio
  `Configurazione server incompleta: chiave Firebase non impostata.`
  e nei log compare un `console.error` che nomina la variabile (mai il valore);
- `OPTIONS`/CORS e i rifiuti per token assente (401) restano invariati: il controllo
  avviene per richiesta, non all'avvio della funzione.

Chiavi previste in Google Cloud Console (progetto `safety-checklist-colligo`):

| Chiave | Dove si usa | Restrizioni consigliate |
|---|---|---|
| Chiave **browser** (già pubblica in `js/firebase-config.js` e `ore-produttivita/app.js`) | PWA e app Ore nel browser | Restrizione HTTP referrer (`https://leo12testa-jpg.github.io/*` più eventuali host locali di sviluppo) e solo le API Firebase usate dal browser |
| Chiave **server** (nuova, separata) | Edge Functions, tramite `SAFETYCHECKLIST_FIREBASE_API_KEY` | Solo restrizione API: *Identity Toolkit API*. **Nessuna** restrizione referrer: le chiamate server non inviano l'header `Referer` |

## Variabili per funzione

Legenda: **obbligatoria** = senza di essa la funzione non serve richieste autenticate;
*piattaforma* = fornita automaticamente da Supabase alle Edge Functions.

### `manage-users`

| Variabile | Note |
|---|---|
| `SAFETYCHECKLIST_FIREBASE_API_KEY` | **obbligatoria**; altrimenti 503 |
| `SUPABASE_URL` | *piattaforma*; registro utilizzo |
| `SUPABASE_SERVICE_ROLE_KEY` | *piattaforma*; registro utilizzo |
| `SAFETYCHECKLIST_FIREBASE_PROJECT_ID` | opzionale; predefinito `safety-checklist-colligo` |
| `FIREBASE_AUTH_EMULATOR_HOST`, `FIRESTORE_EMULATOR_HOST`, `FIREBASE_API_KEY`, `FIREBASE_PROJECT_ID` | **solo collaudo con emulatori** (progetto `demo-*`); `FIREBASE_API_KEY` è letta solo se è impostato l'emulatore Auth |
| `PORT`, `LISTEN_HOST` | solo esecuzione locale |

### `photo-access`

| Variabile | Note |
|---|---|
| `SAFETYCHECKLIST_FIREBASE_API_KEY` | **obbligatoria**; altrimenti 503 |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | *piattaforma*; se mancano la funzione non si avvia (comportamento invariato) |
| `SAFETYCHECKLIST_FIREBASE_PROJECT_ID` | opzionale; predefinito `safety-checklist-colligo` |
| `PHOTO_ALLOWED_ORIGINS` | opzionale; elenco separato da virgole, predefinito `https://leo12testa-jpg.github.io` |
| `FIREBASE_AUTH_EMULATOR_HOST`, `FIRESTORE_EMULATOR_HOST`, `FIREBASE_API_KEY`, `FIREBASE_PROJECT_ID` | **solo collaudo con emulatori** |
| `PORT`, `LISTEN_HOST` | solo esecuzione locale |

### `document-jobs`

| Variabile | Note |
|---|---|
| `SAFETYCHECKLIST_FIREBASE_API_KEY` | **obbligatoria**; altrimenti 503 |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | *piattaforma*; senza di esse 503 «Backend documentale non configurato.» |
| `SAFETYCHECKLIST_FIREBASE_PROJECT_ID` | opzionale; predefinito `safety-checklist-colligo` |
| `DOCUMENT_PIPELINE_ENABLED` | `true` rende obbligatorio il consenso `aiDataProcessingConsent` alla creazione |
| `DOCUMENT_AI_CREDIT_BUDGET_USD` | opzionale; budget di riferimento per il riepilogo consumi (predefinito 40) |

### `ore-produttivita-api` (in produzione per la funzione «Ore»)

**Non modificata in questo branch:** la chiave è ancora scritta nel codice. Il gate di QA
vieta modifiche all'app Ore in questa PR (`tests/qa-v1-run.cjs`), quindi il passaggio
alla variabile `SAFETYCHECKLIST_FIREBASE_API_KEY` va fatto con una PR separata. Finché non
avviene, la chiave **browser** non può ricevere la restrizione HTTP referrer senza fermare
questa funzione.

### `document-worker`

Non usa la chiave Firebase. Le sue variabili (provider AI, segreto del worker,
abilitazioni DUVRI) sono descritte in `docs/AGENTI_CLOUD_DUVRI.md` e
`docs/AUTOMAZIONE_DOCUMENTALE_AI.md`.

## Ordine obbligatorio prima del prossimo deploy

I segreti Supabase sono condivisi da tutte le funzioni dello stesso progetto. La
variabile va impostata **prima** di ridistribuire una qualsiasi delle tre
funzioni, altrimenti la versione nuova risponderà 503 a tutti gli utenti autenticati
(manage-users, photo-access, document-jobs).

```bash
# Inserire il valore solo nel terminale dell'amministratore, mai in file o chat.
supabase secrets set SAFETYCHECKLIST_FIREBASE_API_KEY=<chiave-server>
supabase secrets list   # deve comparire il NOME della variabile (il valore non viene mostrato)
```

Per non lasciare la chiave nella cronologia della shell si può usare un file locale
non versionato con `supabase secrets set --env-file <file>` e cancellarlo subito dopo.

## Checklist pre-deploy

1. [ ] In Google Cloud Console esiste la chiave **server** separata, con restrizione API
       *Identity Toolkit API* e senza restrizione referrer.
2. [ ] `supabase secrets set SAFETYCHECKLIST_FIREBASE_API_KEY=...` eseguito sul progetto
       Supabase corretto; `supabase secrets list` mostra il nome.
3. [ ] Il valore non compare in codice, documenti, test, log CI o messaggi.
4. [ ] Ridistribuire **una funzione alla volta**, iniziando da una non critica
       (`photo-access` o `document-jobs`), e verificare un accesso reale:
       nessun 503 «chiave Firebase non impostata», nessun 401 inatteso.
5. [ ] Solo dopo, ridistribuire `manage-users` e verificare login e gestione utenti.
       `ore-produttivita-api` resta invariata finché la PR separata non è approvata.
6. [ ] Se compare il 503: impostare il segreto (la funzione lo legge a ogni richiesta;
       se il 503 persiste, ridistribuirla) oppure ripristinare la versione precedente.
7. [ ] Solo quando le tre funzioni di questo branch e `ore-produttivita-api` (PR separata) usano la chiave server, applicare la
       restrizione HTTP referrer alla chiave **browser**.
8. [ ] Prima del punto 7, migrare anche gli usi non-browser della chiave browser
       (vedi sotto), altrimenti smetteranno di funzionare.

## Usi della chiave browser fuori dal browser

Questi componenti chiamano Google con la chiave browser senza header `Referer` e
**si romperanno** quando la chiave browser riceverà la restrizione referrer:

- `ore-produttivita/crm-sync/crm_agenda_sync.py` — `accounts:signInWithPassword`
  (chiave scritta nel file).
- `ore-produttivita/crm-sync/crm_company_agent.py` — `accounts:signInWithPassword` e
  `securetoken.googleapis.com/v1/token` (refresh; richiede anche *Token Service API*).
- `tests/ore-live-permissions.cjs` — smoke test live con `accounts:signInWithPassword`.

Per questi va prevista una chiave dedicata (o la chiave server, aggiungendo
*Token Service API* per il refresh) letta da variabile d'ambiente/configurazione
locale non versionata.

## Test ed emulatori

- I test con emulatori usano `FIREBASE_AUTH_EMULATOR_HOST` + `FIREBASE_API_KEY` con un
  valore fittizio e un progetto `demo-*`: il ramo emulatore è invariato.
- Gli harness Node che caricano `manage-users` **senza** emulatore devono passare un
  valore fittizio per `SAFETYCHECKLIST_FIREBASE_API_KEY` (mai una chiave reale).
