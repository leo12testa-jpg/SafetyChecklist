# Colligo DUVRI AI — invalidazione delle revisioni e degli elaborati (v1)

**Stato:** modulo puro e isolato, non collegato al backend, all'interfaccia, agli agenti AI o al compilatore Word. Nessuna modifica dei dati salvati, dei documenti aziendali o della produzione.

## Problema

Un fascicolo non può riutilizzare le decisioni HSE, le conferme OCR, le risposte del cliente, la bozza Word o il rapporto QA quando cambia uno dei documenti o delle versioni tecniche da cui dipendono. I blocchi già presenti nei diversi moduli intercettano alcune revisioni obsolete. Questo piano riunisce le **dipendenze da invalidare**, senza pretendere di eseguirle automaticamente.

Il modulo `js/duvri-revision-invalidation.js` confronta due snapshot del **medesimo fascicolo** verificati dal backend e individua le parti da aggiornare. Controlla l'identità della commessa, gli ID di revisione, le impronte complete SHA-256 riportate nei metadati e il controllo di concorrenza dichiarato dal server.

## Dipendenze considerate

| Cosa cambia | Cosa va considerato obsoleto |
|---|---|
| Checklist o allegati (`manifest_sha256`) | Estrazione, conferme OCR, fonti, screening, analisi, chiarimenti, revisione HSE e Word |
| Risposte e integrazioni fornite dal cliente | Scope delle fonti, screening, specialisti, chiarimenti, HSE e Word |
| Estrazione / conferma OCR | Scope delle fonti, specialisti, verifiche citazioni, HSE e Word |
| Screening / analisi specialistica | Analisi e decisioni successive, preflight AI, revisione e Word |
| Pacchetto HSE | Matching citazioni, chiarimenti, triage, revisione e Word |
| Registro chiarimenti / sua gestione | Decisioni tecniche, bozza e QA Word |
| Revisione HSE | Bozza Word, QA e preflight tecnico |
| Master Word, mapping D2 | Bozza, QA e preflight tecnico |
| Metodo D1 | Riesame metodo di rischio, bozza, QA e preflight tecnico |
| Configurazione provider | Preflight AI, analisi specialistica e risultati a valle |

L'insieme di componenti viene unito senza duplicati e restituito in ordine deterministico, con `changed_fields` e `invalidate_artifacts`. Il modulo rifiuta snapshot modificati senza un nuovo ID di revisione, avanzamenti senza modifiche dichiarate, fascicoli diversi, hash malformati o contesti di autorizzazione inconsistenti.

## Contratto per l'integrazione privata Codex / Claude

**La funzione è `plan({previous,current,trustedContext})`: non scrive nel database.**

1. Recuperare `previous` e `current` dallo storage autenticato, senza fidarsi di snapshot inviati dal browser, dall'AI o dal documento caricato. Ricalcolare impronte sui file veri e manifest canonici prima di dichiarare verificati gli snapshot.
2. Garantire che ogni variazione materiale dei documenti, dell'OCR o dei risultati comporti una nuova revisione persistita. La lista dei 15 campi deve essere completata dallo schema privato reale; se qualche campo è sconosciuto, usare `null` solo quando non ancora prodotto, **non** per ignorare un cambiamento.
3. Validare il ruolo/tenant e le autorizzazioni sul fascicolo. Il flag `authenticated:true` o `current_snapshot_server_verified:true` **non è** una prova se arriva dal client; deve essere costruito dal backend.
4. Eseguire il piano all'interno di una transazione Postgres **CAS** che verifica la revisione originale; rendere obsolete **tutte** le righe derivate indicate e creare audit append-only. I retry devono essere idempotenti. Se il commit non è riuscito, il fascicolo resta bloccato.
5. Impedire che il nuovo fascicolo venga letto come pronto per agenti, revisione o Word finché le dipendenze richieste non sono state ricostruite e nuovamente verificate. Nessun invio automatico e nessuna generazione Word ufficiale sulla base del solo piano.
6. Una modifica dell'approvazione di un provider, del metodo D1 o del modello Word D2 richiede nuove verifiche pertinenti. **Non trasformare** l'esito del piano in una concessione di permessi o di emissione.

**Confine:** `plan_applied=false`, `persist_allowed=false`, `reanalysis_completed=false`, `duvri_approved=false` e `issuance_allowed=false` in ogni stato. È una descrizione delle invalidazioni da fare, non un'operazione eseguita.

## Collaudo

`node --test tests/duvri-revision-invalidation.test.js`

28 test sintetici su cambiamenti dei documenti e revisioni, OCR, screening, pacchetti HSE, chiarimenti, Word, D1/D2, budget/provider, CAS e non emissione. Il test integrato verifica che un PDF sostituito non possa riutilizzare l'attestazione di estrazione precedente, e che l'invalidazione proposta raggiunga HSE e Word.

**Limiti espliciti:** nessun database, locking, SHA calcolato sui file, permessi reali o revisione del modello riservato in questo modulo. Confrontare la lista di dipendenze con l'effettivo schema backend locale prima di adottarla; evitare duplicazioni con i meccanismi di invalidazione di Claude/Codex.
