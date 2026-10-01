# Colligo Ore & Produttività — ponte Agenda CRM

Questo componente legge l'agenda Innova CRM dal PC del tecnico e invia le attività alla nuova app.

## Prima installazione
Eseguire `SETUP_CRM_SYNC.bat`.

## Sincronizzazione
Eseguire `SINCRONIZZA_AGENDA.bat`.

- usa la stessa utenza SafetyChecklist per autenticare l'invio;
- apre Edge con un profilo persistente dedicato, quindi la sessione CRM può rimanere memorizzata;
- legge data, ora inizio/fine, codice breve (es. 01.17-B) o CodiceComm (es. CM002568);
- calcola automaticamente la durata;
- invia le sessioni all'API `ore-produttivita-api`;
- una nuova sincronizzazione della stessa voce non deve duplicare la sessione.

Al primo collaudo il programma salva anche `%LOCALAPPDATA%\ColligoOreProduttivita\agenda_debug.json`.
Se l'agenda CRM usa strutture HTML particolari, questo file permette di affinare i selettori senza modificare a caso il resto dell'app.
