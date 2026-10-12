# SafetyChecklist V1: architettura e rilascio

## Dati e identità

Firebase Authentication fornisce la sessione. Il profilo `utenti/{uid}` deve corrispondere all'account, essere attivo e avere ruolo `admin` o `tecnico`. I controlli di interfaccia non sostituiscono Firestore e backend. L'area utenti e `manage-users` verificano il ruolo admin sul server; un account Auth senza profilo attivo non ottiene accesso ai dati.

I tecnici attivi della stessa azienda condividono la collezione sopralluoghi: il collaboratore non è il proprietario esclusivo del documento. Non esiste una seconda azienda/tenant in questa V1. `foto_accesso_uids`, quando presente, restringe le fotografie a quell'elenco e agli admin; soltanto un admin può modificarlo. I documenti legacy senza ACL restano condivisi con i tecnici attivi. Il rilascio non aggiunge ACL né migra i dati aziendali.

IndexedDB `SafetyChecklistDB`, versione 2, contiene sopralluoghi, blob fotografici, checklist cache, impostazioni e PDF. I commit locali precedono ogni richiesta cloud. Firestore trasporta risposte, metadati e riferimenti fotografici; il merge conserva le modifiche a domande diverse e le versioni precedenti nei conflitti sulla stessa domanda. L'outbox audit è persistente e invia soltanto eventi dell'identità corrente. La rimozione di un documento remoto non cancella automaticamente il lavoro locale. L'avvio non ripulisce il cestino né i documenti legacy.

Il logout nasconde le schermate e rimuove il profilo di sessione; non elimina i dati locali. I dati offline già salvati non possono essere revocati da un server mentre il dispositivo è disconnesso. La protezione dell'accesso fisico al profilo browser rimane necessaria, come per qualunque applicazione offline.

## Fotografie e documenti

Il frontend invia il Firebase ID token al gateway `photo-access`. Il gateway verifica Firebase, progetto/issuer, scadenza/revoca del token, profilo attivo e documento Firestore usando il token del chiamante. Per lettura ed eliminazione il percorso deve essere già referenziato dal sopralluogo; sono rifiutati traversal, riferimenti ad altri documenti e percorsi arbitrari.

Storage conserva gli stessi nomi e bytes delle fotografie esistenti. Il servizio usa `SUPABASE_SERVICE_ROLE_KEY` soltanto sul server. Nessuna service role o signed URL viene inviata al browser; ogni download remoto viene nuovamente autorizzato, con `private, no-store`. I caricamenti sono immutabili: il retry degli stessi bytes è accettato, una sostituzione differente è rifiutata.

La policy restrittiva in `supabase/photo-security/private-photo-policy.sql` interseca le policy precedenti e nega l'accesso diretto al solo bucket `foto-sopralluoghi` per `anon` e `authenticated`. Non elimina policy precedenti, oggetti o altri bucket. Il bucket deve restare privato. Tutti gli altri progetti e funzioni `ore-*` sono esclusi dalla distribuzione.

I PDF sono generati localmente. L'importazione verifica testo visibile e associazioni; le righe incerte richiedono conferma. Le nuove Raccolte dati DVR usano i sette JSON già pubblicati: i cinque generali sono visibili nel menu, chimico e MMC restano apribili dallo storico. Lo ZIP contiene risposte strutturate, note e foto rinominate per codice domanda; le foto mancanti sono segnalate. La firma grafica non è prevista.

## PWA

Il service worker precarica asset e tutte le dodici checklist. Una cache è pronta solo quando tutti i file richiesti sono disponibili. Un'installazione fallita mantiene la versione precedente. Il client confronta la build in esecuzione con `version.json`, attende il nuovo shell e i salvataggi pendenti e ricontrolla schermata/dialoghi prima di ricaricare. Compilazione e anteprima d'importazione rimangono protette dal reload automatico.

## Procedura di rilascio

1. Parti da `origin/main` aggiornato e confronta le PR: nessun merge cieco di branch obsoleti.
2. `./pubblica.sh --prepare` prepara la build sulla branch. Non esegue operazioni sui servizi.
3. Esegui QA isolata, regressioni, PDF/ZIP, browser desktop/tablet/mobile e gate Deno/Storage reale su dati fittizi. Controlla conteggi, exit code, cleanup e artefatti. Un mock Storage non certifica le policy Postgres.
4. Verifica e documenta separatamente Safari/dispositivi fisici: viewport o WebKit automatizzato non equivalgono a un telefono fisico.
5. Prima del frontend, distribuisci esclusivamente i backend SafetyChecklist verificati. `manage-users` e `photo-access` devono accettare Firebase JWT e usare `verify_jwt=false` nel gateway Supabase, perché la verifica Firebase avviene nel codice. Mantieni le variabili server per progetto/API key Firebase e Storage. Non inserire segreti in HTML/JS.
6. Solo dopo il collaudo della configurazione separata, applica regole Firestore e policy restrittiva Storage. Nessuna trasformazione, cancellazione o riscrittura dei dati è necessaria. I vecchi client conserveranno localmente gli upload negati fino all'aggiornamento e al retry.
7. Unisci la PR solo con tutti i controlli obbligatori verdi e il backend verificato. Pages è automatico su `main`: non usare il push frontend per aggirare un blocco di sicurezza.
8. Verifica URL, build, bytes pubblicati, caricamento e aggiornamento PWA. I controlli post-deploy non devono creare account o scrivere dati aziendali. Aggiorna il rapporto con URL dei workflow, commit, versione e impedimenti residui.

Se un gate fondamentale o il deploy coordinato resta non verificato, la PR rimane candidata e il prodotto non è dichiarato V1.0 completato.
