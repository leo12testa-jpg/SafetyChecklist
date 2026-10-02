# Colligo Ore & Produttività — ponte Agenda CRM

Questo componente collega l'agenda Innova CRM personale alla schermata giornaliera di Ore & Produttività.

## Prima configurazione sul PC

Eseguire una sola volta `SETUP_CRM_SYNC.bat`.

La configurazione:
- installa/aggiorna Playwright;
- registra il collegamento locale `colligoore://`;
- abilita il pulsante **Sincronizza CRM** presente nell'app.

## Uso quotidiano

1. Accedi a Ore & Produttività con il tuo account.
2. Seleziona il giorno.
3. Premi **Sincronizza CRM**.
4. Il ponte apre Edge usando un profilo CRM separato per il tuo username.
5. Se il CRM richiede il login, accedi con il tuo account CRM personale.
6. Il programma prova a portare automaticamente l'agenda alla data selezionata.
7. Le attività riconosciute vengono inviate soltanto al tuo account Ore & Produttività.

Il collegamento account viene verificato lato server contro la risorsa CRM associata (es. LT · Leonardo Testa). Se l'account non è associato a una risorsa CRM, la sincronizzazione viene bloccata.

## Dati letti

Per ogni voce vengono cercati:
- data;
- ora inizio e fine;
- codice lavoro breve, quando presente;
- CodiceComm CRM, quando presente;
- testo/oggetto dell'attività.

La durata viene calcolata automaticamente. Se cliente o pratica sono riconoscibili dal testo, il codice non è obbligatorio.

## Sicurezza e separazione utenti

Ogni username Ore & Produttività usa una cartella browser CRM distinta sotto:

`%LOCALAPPDATA%\ColligoOreProduttivita\crm-browser\<username>`

In questo modo sessioni CRM di utenti diversi non vengono condivise nello stesso profilo del ponte.

## Diagnostica

Se una giornata non viene letta correttamente, viene salvato:

`%LOCALAPPDATA%\ColligoOreProduttivita\agenda_personale_debug.json`

Le sincronizzazioni della stessa voce usano un identificativo stabile per evitare duplicati.
