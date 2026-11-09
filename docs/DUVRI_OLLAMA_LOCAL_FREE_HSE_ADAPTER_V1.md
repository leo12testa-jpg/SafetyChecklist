# Colligo DUVRI AI — Adapter Ollama SOLO LOCALE, costo API zero

**Stato:** modulo per backend Node PRIVATO, disabilitato per impostazione predefinita. Non installa né scarica Ollama o modelli, non usa account cloud, non crea chiavi o costi, non fa richieste all'import. Non è collegato al worker Deno né alla PWA pubblica.

## Funzionamento e limiti

`server/duvri-ollama-local-adapter.cjs` esporta `createLocalOllamaAdapter({enabled:false,loadSyntheticCase,verifyLocalRuntime,recordAudit,fetchImpl})`.

Quando il backend abilita esplicitamente il test, l'operazione `invoke({jobId,agentId,analysisRevisionId,extractionRevisionId,runRevisionId})` accetta soltanto questi cinque ID. Il modello e i fatti devono provenire esclusivamente dal backend privato. **Solo fascicoli sintetici**, mai dati cliente. Il risultato resta `candidate_for_private_fact_verification`, non è una valutazione professionale, non prova le citazioni e non autorizza il Word.

L'adapter non costruisce 12 modelli diversi: riusa un modello già installato con le dodici istruzioni specialistiche presenti in `js/duvri-hse-agent-instructions.js`. Il coordinamento tra le fasi del lavoro rimane nel supervisore della PR #60, non ancora integrato.

## 0 € — barriera tecnica obbligatoria

1. Il codice usa **esclusivamente** gli URL letterali `http://127.0.0.1:11434/api/tags` e `http://127.0.0.1:11434/api/chat`, con `redirect:'error'`. NON usa Ollama cloud, OpenAI, Vercel, Anthropic o altri provider. Non esistono chiamate `/api/pull`, `/api/create` o comandi di installazione.
2. La callback trusted `verifyLocalRuntime` deve verificare dal sistema locale che l'Ollama **effettivamente in esecuzione** abbia le funzioni cloud disattivate e sia accessibile solo sul loopback; non può limitarsi a riportare un booleano fornito dalla UI.
3. Secondo la documentazione ufficiale Ollama: impostare per il processo Ollama `OLLAMA_NO_CLOUD=1` oppure `{ "disable_ollama_cloud": true }` in `~/.ollama/server.json`, quindi **riavviare Ollama**. Verificare nel log che compaia `Ollama cloud disabled: true`. Fonte: https://docs.ollama.com/faq . Controllare anche che `OLLAMA_HOST` non esponga l'API in LAN e che non siano configurati tunnel.
4. Per verificare i modelli locali già installati: `ollama list` oppure GET `/api/tags`. Un modello assente produce `LOCAL_MODEL_NOT_INSTALLED`: l'adapter NON tenta alcun download e non lo sostituisce con un modello cloud.
5. Il codice rifiuta nomi che contengono `cloud`, inclusi tag `:cloud`; persino un modello elencato in `/api/tags` non diventa ammissibile se cloud. I dati inviati sono contrassegnati e verificati come sintetici.
6. L'esecuzione locale non ha tariffe API, ma richiede hardware adeguato, elettricità e spazio disco. Prima di attivarla, Codex deve verificare l'hardware Windows e la memoria disponibile in sola lettura, senza installazioni non richieste.

Documentazione API: https://docs.ollama.com/api/chat e https://docs.ollama.com/api/tags . Ollama può offrire anche modelli cloud; è per questo che il **blocco cloud effettivo** è un requisito e non solo una preferenza.

## Sicurezza del worker

- Il backend deve costruire `loadSyntheticCase` dopo aver controllato proprietà del fascicolo, permessi, revisioni, soli file sintetici, minimizzazione e fonti ammesse; non leggere il payload direttamente dal browser.
- L'adapter confronta ogni riferimento esplicito `file_id` / `file_ids` (anche annidato e varianti `sourceFileId`) con l'allowlist del fascicolo, richiedendo almeno una fonte corrente; citazioni arbitrarie o di altri fascicoli vengono bloccate prima di chiamare Ollama. Questo controllo non sostituisce il successivo confronto fattuale dei testi citati.
- La callback `recordAudit` deve scrivere un evento prima dell'esecuzione locale; se fallisce, non si avvia Ollama. Un errore di audit finale blocca l'output. Eventi senza testo privato.
- Il processo controlla che il modello sia già installato, limita gli input a 22k caratteri, usa JSON strutturato, timeout 120s e verifica il contratto `duvri-agent-contract.js`.
- Una risposta sintatticamente valida non è fonte certa: `duvri-hse-fact-match.js`, controllo dei conflitti, giudizio del tecnico e QA Word rimangono obbligatori.
- L'adapter non deve essere compilato nella PWA GitHub Pages né incluso in una funzione cloud: lì `127.0.0.1` non corrisponde al PC del tecnico.

## Handoff Codex dopo il recupero Claude

1. **P0 indipendente:** riportare in esito positivo i 2 test Word con processi reali ancora falliti; identificare perché lo scenario H non genera il pacchetto reale di 30 pagine. Nessuna falsa approvazione basata sul test solo sintetico.
2. Mantenere il branch locale di recupero isolato finché sono presenti processi Claude attivi e non è dimostrato quale worktree usino. Non copiare/mergiare ciecamente.
3. Verificare che Ollama sia già installato tramite controlli **sola lettura** e raccogliere RAM/GPU senza scaricare software. Se assente, riportare `LOCAL_OLLAMA_UNAVAILABLE` e non installarlo automaticamente.
4. Leggere i contratti JS esistenti e integrare solo un singolo adapter nel backend Node privato, se effettivamente in esecuzione sul PC Windows. Se il backend sarà su Supabase remoto, la macchina remota NON può raggiungere il `127.0.0.1` del PC. In quel caso prevedere un servizio locale autenticato e autorizzato separato, senza esporre Ollama alla rete, oppure mantenere l'attivazione bloccata.
5. Prima di abilitare `enabled=true` in una configurazione **solo sintetica**, verificare l'effettiva modalità `OLLAMA_NO_CLOUD=1`, il binding loopback, i log, l'identità del processo, l'assenza di tunnel e l'elenco dei modelli già installati.
6. Eseguire un primo smoke test con un unico agente e solo fonti sintetiche. Controllare struttura, citazioni, qualità e latenza. Solo dopo provare i 12 ruoli con il coordinamento già previsto; non trattare output senza fonti come evidenza verificata.
7. I test non sbloccano D1/D2, revisione visiva Word, emissione ufficiale o utilizzo su dati cliente.

## Test

`node --test tests/duvri-ollama-local-adapter.test.js`

**25 scenari mock**, senza accesso al localhost reale, verificano stato OFF, 2 endpoint letterali, cloud disabilitato e binding locale, modello installato, nessun download, no dati reali, ACL/revisioni, istruzioni dei 12 profili, audit, JSON, risposte illegittime e blocco dell'emissione.

**Limite esplicito:** un test con provider mock NON dimostra che Ollama sia installato e in esecuzione sul computer Windows dell'utente. La prima esecuzione con modello vero deve essere svolta da Codex **localmente**, in condizioni di costo e rete verificate.

### Diagnostica Windows rafforzata

Lo script `tools/duvri_ollama_local_diagnostic.ps1` consulta in **sola lettura** le porte in ascolto tramite `Get-NetTCPConnection` e verifica se il servizio usa solo `127.0.0.1` o `::1`. Cerca inoltre l'ultima segnalazione `Ollama cloud disabled: true/false` nei log Windows `%LOCALAPPDATA%\Ollama\server.log`. Queste sono **evidenze diagnostiche**, non una prova dell'attestazione runtime: `cloud_disabled_effectively_verified` rimane `false` finché Codex non collega in modo affidabile log e configurazione al processo Ollama attualmente in ascolto. Se il controllo della porta non è disponibile, il risultato resta prudenzialmente non verificato.

## Diagnostica Node senza PowerShell

Se la policy di esecuzione PowerShell aziendale impedisce lo script `.ps1`, **non modificarla**. È disponibile un diagnostico read-only alternativo: `node tools/duvri_ollama_local_diagnostic.cjs`. Richiede soltanto Node (già presente nel progetto).

Il diagnostico Node fa una sola richiesta GET a `http://127.0.0.1:11434/api/tags`; il client HTTP nativo non segue redirect. Effettua inventario read-only RAM e, su Windows, cerca la CLI con `where.exe`, osserva le socket con `netstat.exe`, legge soltanto le impostazioni cloud-off nel file `~/.ollama/server.json` e la coda del log locale. Non stampa file personali, credenziali o contenuti dei documenti; non interroga altri indirizzi, non installa e non avvia Ollama, non esegue `pull` e non modifica la policy.

**Il processo cloud-off non è attestato automaticamente.** Anche in presenza di configurazione e log favorevoli il risultato mantiene `effective_ollama_process_cloud_disabled_verified=false`: Codex deve correlare il processo realmente in esecuzione alla configurazione, senza affidarsi a variabili d'ambiente del processo diagnostico. Se il servizio o un modello non esistono, il risultato è un blocco, non un'autorizzazione.

Con circa 15,5 GiB di RAM totale ma soltanto 2,5 GiB disponibili (ultimo controllo Windows riportato da Codex), **non procedere automaticamente con un modello 4B**. Verificare la memoria libera al momento della prova e scegliere eventualmente un modello più piccolo solo dopo approvazione operativa; nessun download automatico.

Test del diagnostico Node: `node --test tests/duvri-ollama-local-diagnostic-node.test.js` (11 casi sintetici, senza chiamata a un servizio Ollama reale).