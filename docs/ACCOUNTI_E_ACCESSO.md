# Account e accesso — implementazione corrente

Firebase Authentication verifica username/password: lo username normalizzato diventa internamente `username@safetychecklist.local`. Il profilo `utenti/{uid}` deve essere attivo. I ruoli previsti sono `admin` e `tecnico`.

La sessione è persistita dal Firebase SDK. Dopo la prima verifica online è conservato un profilo locale non segreto per consentire l'uso offline. Password e token non vengono copiati dall'app nell'audit o nei sopralluoghi. La disattivazione online provoca il logout; offline una sessione già verificata rimane disponibile fino al ritorno online. I cambi ruolo sono riletti al focus, al ritorno online e periodicamente.

## Autorizzazione

Le regole `firestore.rules` autorizzano le operazioni in base al profilo server attivo. I sopralluoghi sono condivisi da tutti i tecnici attivi: non è previsto isolamento per cliente o assegnatario. Creazioni e aggiornamenti devono riportare l'identità autenticata; account inattivi e anonimi non possono leggere o scrivere. Solo gli admin possono gestire i profili e consultare tutti gli audit.

Le rotte Impostazioni, Utenti e Il mio lavoro sono riservate agli admin. La protezione server rimane necessaria anche quando un pulsante è nascosto. L'audit salva soltanto identità, tipo di operazione e riferimenti; in caso di guasto cloud l'evento viene accodato in IndexedDB e ritentato.

## Gestione utenti

`supabase/functions/manage-users/index.ts` implementa la funzione HTTPS indicata in `js/firebase-config.js`. Verifica il token Firebase tramite l'API Auth e usa quel token per Firestore: non contiene credenziali Admin SDK o service-role.

| Azione | Autorizzazione |
|---|---|
| `sessionStatus` | Utente con token Firebase verificabile |
| `list`, `create`, `setActive`, `setRole`, `usage` | Admin attivo |
| `usagePing` | Utente attivo; scrittura soltanto su `utilizzo_app/{proprio uid}` |

L'elenco segue la paginazione Firestore anche oltre 100 utenti. La creazione compensa un errore di salvataggio del profilo eliminando soltanto l'account appena creato. È impedito cambiare il proprio ruolo o disattivare sé stessi dalla funzione amministrativa. Il tecnico cambia la propria password dalla UI, previa verifica della password attuale.

`utilizzo_app` conserva ultimo accesso, heartbeat, build e conteggi della coda. I timestamp sono trasformazioni server; non conserva note, risposte, fotografie o password. Le nuove regole e la funzione devono essere pubblicate insieme al frontend in una fase di rilascio separata. Questo collaudo non esegue deploy.

## Fotografie e limiti

Le fotografie usano il client Supabase con una chiave publishable. Questa integrazione non inoltra automaticamente l'identità Firebase allo Storage. Il login dell'app, da solo, **non dimostra** che le fotografie siano protette sul bucket: occorre collaudare le policy con account autorizzati e non autorizzati in un progetto Supabase di test. Nessuna policy o dato del bucket produttivo è stato modificato.

Il backend attuale è una Supabase Edge Function; non richiede il deploy di una Firebase Cloud Function. Le istruzioni precedenti su `functions/bootstrap-team.js`, Admin SDK e piano Firebase Blaze non corrispondevano ai file di `main` e sono state rimosse.

Il QA usa Firebase Auth/Firestore emulator e Storage mock. Il codice TypeScript della funzione viene eseguito con uno shim `Deno.serve` e API Firebase emulata. Non sostituisce una prova della funzione nel runtime Deno/Supabase reale. Evidenze e limiti: [rapporto](../reports/COLLAUDO_SAFETYCHECKLIST_V1_20261009.md).
