# Account e accesso — SafetyChecklist V1

Lo username normalizzato diventa internamente `username@safetychecklist.local`. Firebase Authentication verifica la password e conserva la sessione nel browser. Il profilo Firestore `utenti/{uid}` deve corrispondere all'account, avere `attivo=true` e ruolo `admin` o `tecnico`.

Dopo una prima verifica online, un profilo locale consente l'uso offline. La disattivazione blocca subito i servizi online, anche con token già emessi; al ritorno online il client verifica nuovamente il profilo e nasconde le schermate. I ruoli vengono riletti al focus, al ritorno online e periodicamente. I bytes già scaricati offline non sono revocabili senza rete: il logout non cancella il lavoro aziendale salvato nel profilo browser.

## Permessi

I sopralluoghi sono condivisi tra tecnici attivi della stessa azienda. V1 non ha separazione per cliente/assegnatario o più tenant. Creazioni e aggiornamenti riportano l'identità autenticata; anonimi, profili assenti e account inattivi sono respinti dalle regole. Solo gli admin gestiscono utenti e leggono l'audit di tutti.

L'area amministrativa verifica il ruolo sia nelle rotte sia sul server. Quando `foto_accesso_uids` è presente, i download di foto sono limitati a quell'elenco e agli admin; un tecnico non può cambiare l'ACL. Il controllo si applica anche al recupero dei blob locali tramite l'app. I documenti legacy senza ACL mantengono la condivisione aziendale esistente.

## Gestione utenti

`manage-users` usa il token Firebase del chiamante per Auth e Firestore; non espone credenziali privilegiate al client.

| Azione | Autorizzazione |
|---|---|
| `sessionStatus` | Token Firebase verificabile; restituisce lo stato del profilo |
| `list`, `create`, `setActive`, `setRole`, `usage` | Admin attivo |
| `usagePing` | Utente attivo, soltanto il proprio documento `utilizzo_app` |

L'elenco segue la paginazione oltre 100 utenti. Se il salvataggio del nuovo profilo fallisce, la funzione elimina soltanto l'account appena creato. Non consente di disattivarsi o cambiare il proprio ruolo durante la sessione amministrativa; mantiene almeno un admin attivo. Il cambio password personale richiede la password corrente.

La telemetria registra timestamp server, build e quantità della coda; non registra risposte, note, foto, password o token. L'audit è accodato in IndexedDB durante i guasti cloud e invia soltanto eventi dell'identità corrente.

## Fotografie

Il frontend usa `photo-access` con il Firebase ID token. Ogni richiesta verifica progetto/issuer, token, account attivo, profilo e sopralluogo. Percorsi legacy rimangono invariati. Storage è privato, con policy restrittiva che nega accessi diretti a `anon` e `authenticated` sul solo bucket `foto-sopralluoghi`; soltanto il server usa la service role. Un retry identico non sovrascrive l'oggetto e una sostituzione diversa è negata. Non vengono emessi link pubblici o firmati.

Firebase Auth, regole, funzioni e policy devono essere distribuiti come descritto in [architettura e rilascio](ARCHITETTURA_V1.md). Il rapporto distingue il codice candidato dai backend effettivamente distribuiti. Nessuna Firebase Cloud Function, Admin SDK o conversione al piano Blaze è richiesta da questo percorso.
