# Ruoli di Ore & Produttività

Il ruolo Ore è distinto da quello della piattaforma principale, che resta invariato. Il server verifica il token Firebase e il profilo attivo, poi legge il ruolo Ore dalla tabella privata `ore_ruoli_utenti`. Un account tecnico resta tecnico; un admin senza assegnazione Ore esplicita dispone dei soli permessi operativi.

| Accesso | Tecnico | Admin operativo | Direzione |
| --- | --- | --- | --- |
| Rendicontazione | Solo propria | Tutti | Tutti |
| Pratiche, archivio, CRM, orari, conferme | No | Sì | Sì |
| Qualità dati, quando disponibile | No | Sì | Sì |
| Costi orari, margini, Economia e preventivi | No | No | Sì |
| Assegnare ruoli Ore | No | No | Sì |

La direzione include quindi entrambi i gruppi di permessi richiesti da Colligo. Le risposte destinate agli altri ruoli escludono i campi economici, anche nei valori precedenti e successivi degli audit dell’archivio.

In Dashboard, la direzione apre **Ruoli Ore**, carica gli account admin attivi e salva la scelta. L’assegnazione registra attore, data e prima/dopo. L’ultimo account direzione non può essere declassato. Non vengono creati account né modificati collegamenti CRM da questa funzione.

Decisione Colligo del 5 ottobre 2026: Leonardo Testa e Carlo Padovan hanno direzione. Per Carlo è stato riutilizzato l’account esistente `carlo.padovan`, con UID esplicitamente confermato da Colligo. L’alias approvato collega `legacy:CP` a tale UID conservando gli identificativi delle sessioni storiche. Il profilo della piattaforma principale non è stato modificato. Gli altri account e segnaposto non vengono collegati automaticamente.
