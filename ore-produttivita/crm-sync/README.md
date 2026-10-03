# Colligo Ore & Produttività — sincronizzazione Agenda CRM

La sincronizzazione standard è **aziendale e automatica**: la web app non apre Edge, non avvia il CRM e non richiede credenziali CRM agli utenti.

## Configurazione consigliata

Su un solo PC aziendale che rimane normalmente acceso eseguire una volta:

`SETUP_SYNC_BACKGROUND.bat`

La configurazione:
- installa/aggiorna Playwright e il gestore credenziali Windows;
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

Durante un ciclo viene inviato un heartbeat al backend ogni 4 risorse, così la Dashboard distingue un agente realmente fermo da un ciclo ancora in corso.

Come protezione aggiuntiva, se quattro risorse diverse restituiscono esattamente la stessa agenda non vuota, le successive vengono marcate come sospette invece di essere importate automaticamente. Questo evita di attribuire a più tecnici la stessa agenda nel caso in cui il cambio risorsa nel CRM non sia avvenuto correttamente.

Il setup verifica anche la comparsa del primo file di stato locale dopo l'avvio della sincronizzazione.
