# Colligo Ore & Produttività — sincronizzazione Agenda CRM

La sincronizzazione standard è **aziendale e automatica**: la web app non apre Edge, non avvia il CRM e non richiede credenziali CRM agli utenti.

## Configurazione consigliata

Su un solo PC aziendale che rimane normalmente acceso eseguire una volta:

`SETUP_SYNC_BACKGROUND.bat`

La configurazione:
- installa le versioni indicate in requirements.txt (Playwright 1.55.0, keyring 25.6.0, cryptography 50.0.0);
- memorizza in modo protetto il refresh token dell'account amministratore Ore & Produttività;
- crea un profilo Edge dedicato alla sessione CRM aziendale;
- richiede il login CRM soltanto nella configurazione iniziale o quando Innova fa realmente scadere la sessione;
- registra l'attività pianificata **Colligo Ore CRM Background**, eseguita ogni 5 minuti senza finestre visibili.

## Uso quotidiano

Nessuna operazione CRM è richiesta nella web app.

La web app:
- mostra i dati già sincronizzati;
- mostra l'ultima sincronizzazione;
- permette di correggere cliente, tipologia, pratica e ore;
- il pulsante ↻ ricarica soltanto i dati dal backend e **non apre il CRM**.

L'agente aziendale:
- legge le risorse CRM attive;
- prova a selezionare ciascun tecnico nell'agenda Innova;
- legge le attività del mese corrente;
- invia gli eventi al backend con sigla e nome della risorsa;
- usa identificativi stabili per evitare duplicati;
- blocca letture anomale con troppi eventi.

## File principali

- `crm_company_agent.py` — agente aziendale invisibile.
- `RUN_COMPANY_SYNC.vbs` — avvio senza finestra.
- `SETUP_SYNC_BACKGROUND.bat` — installazione/configurazione una tantum.
- `crm_agenda_sync.py` — sincronizzazione personale manuale, mantenuta solo come fallback tecnico.
- `SETUP_CRM_SYNC.bat` — vecchio setup personale, non necessario per il flusso standard.

## Stato locale

Cartella:

`%LOCALAPPDATA%\ColligoOreProduttivita`

File utili:
- `company-agent-status.json` — ultimo stato dell'agente;
- `company-sync.log` — log tecnico;
- `crm-company-browser` — profilo CRM persistente.

## Sicurezza

Le password CRM non vengono salvate nel codice o nel database dell'app. La sessione CRM resta nel profilo browser dedicato sul PC aziendale. Il token dell'app viene conservato tramite il gestore credenziali di Windows.

Se la sessione CRM scade, l'agente non apre finestre agli utenti: si ferma e richiede una nuova esecuzione di `SETUP_SYNC_BACKGROUND.bat` sul PC aziendale.


## Robustezza del servizio

L'agente aziendale usa un mutex Windows per impedire due sincronizzazioni contemporanee. L'attività pianificata è inoltre configurata con `MultipleInstances=IgnoreNew`.

Il ciclo comunica avvio ed esito al backend. Ogni risorsa ha ultimo tentativo, ultima lettura riuscita e motivo di errore separati. Un ciclo parziale non è un successo.

Come protezione aggiuntiva, se quattro risorse diverse restituiscono esattamente la stessa agenda non vuota, le successive vengono marcate come sospette invece di essere importate automaticamente. Questo evita di attribuire a più tecnici la stessa agenda nel caso in cui il cambio risorsa nel CRM non sia avvenuto correttamente.

Il setup verifica anche la comparsa del primo file di stato locale dopo l'avvio della sincronizzazione.


## Installazione a un click

Il file standard da usare è:

`INSTALLA_SYNC_CRM_AUTOMATICA.bat`

Fa tutto lui:
- prova a installare Python 3.12 con winget se manca;
- scarica i componenti aggiornati dal repository;
- installa Playwright e keyring;
- verifica Microsoft Edge;
- configura una sola volta l'account amministratore e la sessione CRM;
- registra il task Windows ogni 5 minuti;
- avvia una prima sincronizzazione invisibile;
- verifica il file di stato dell'agente.

## Diagnostica

Se qualcosa non parte, eseguire:

`DIAGNOSI_SYNC_CRM.bat`

Mostra:
- presenza e stato del task pianificato;
- ultimo stato dell'agente;
- ultime righe del log;
- processi Python/Edge utili alla diagnosi.

La web app mostra anche l'heartbeat backend dell'agente e distingue servizio attivo, fermo, parziale o sessione CRM scaduta.


### Persistenza sessione CRM

Lo stato browser viene salvato in `%LOCALAPPDATA%\ColligoOreProduttivita\crm-auth.bin`
cifrato con Fernet. Nel Gestore credenziali Windows resta solo la piccola chiave di
cifratura, evitando il limite `CredWrite 1783`.

## Correzione selettore e recupero del 5 ottobre 2026

La risorsa viene selezionata con cboAgendaToolbar e identificativo CRM, attendendo il frame calendario corretto. Si verificano valore del select, URL del calendario e un’unica checkbox selezionata. Il controllo agenda_identica_sospetta resta attivo.

Il setup dichiara completamento solo dopo una lettura di tutte le risorse attive; altrimenti restituisce errore e il riepilogo completo Lette X su Y, fallite: .... L’elenco viene riletto dal CRM a ogni ciclo. Nuove risorse restano senza account finché l’admin approva il collegamento.

La configurazione recovery_hold=true è obbligatoria durante il recupero: il ciclo salva recovery-preview.json sul PC, aggiorna solo stato e inventario e non importa appuntamenti. Anche --preview forza questo comportamento. Non disattivare il blocco prima della conferma umana dell’anteprima. Giorni confermati e mesi chiusi non sono modificati dall’import.

## Fuso orario CRM

Tutti gli orari visualizzati sono interpretati con zoneinfo Europe/Rome e tzdata==2026.2. Il trasporto usa timestamp UTC con Z. La data di lavoro resta il giorno italiano, anche se UTC è il giorno precedente. A mezzanotte gli eventi sono separati conservando la durata totale; i casi ambigui o inesistenti al cambio ora fermano la lettura con segnalazione. Gli ID per gli eventi nello stesso giorno restano invariati. L’API rifiuta gli agenti precedenti che inviano orari senza fuso. Non correggere lo storico o abilitare importazioni senza approvazione.

## Portatile: avvio, login e recupero (7 ottobre 2026)

Il task parte al primo accesso Windows dopo l’accensione e ogni cinque minuti. Se manca una sessione valida, apre Edge una volta per il login manuale; chiudere o annullare la finestra non causa nuovi popup a ogni ciclo. RUN_COMPANY_SYNC.bat --login non inoltra argomenti: per riprovare usare python crm_company_agent.py --login oppure il setup. Non viene digitata o salvata la password CRM.

Il cursore registra la data effettivamente coperta, separata dall’orario dell’ultima lettura e dall’importazione. Ogni finestra include la precedente giornata coperta e arriva verso oggi; massimo 30 giorni per risorsa/ciclo. Gli arretrati più lunghi vengono letti dai più vecchi ai più recenti nei cicli successivi. Si leggono anche i giorni non lavorativi presenti nella finestra, così eventuali appuntamenti non vengono esclusi d’ufficio.

L’anteprima pendente viene salvata atomicamente prima dei cursori. Riletture uguali non creano righe duplicate; appuntamenti cambiati o non più presenti vengono segnalati da verificare. L’ID attuale dipende da orario/oggetto: non sostituisce un ID stabile del fornitore. Il confronto con sessioni esistenti, alias approvati, giornate confermate e mesi chiusi è solo lettura. Gli import sono bloccati nel codice durante il nuovo collaudo.

Nuovo collaudo: giornata 09:00–18:00 con PC acceso/in carica; spegnimento manuale serale; riaccensione e login manuale il mattino seguente. Il report viene prodotto da crm_workday_trial.py e non interpreta il buco notturno come un errore. Gli esiti di giornata, intervalli senza letture e recupero del giorno precedente sono separati. Lo spegnimento effettivo va verificato dai log Windows o confermato dall’operatore.
