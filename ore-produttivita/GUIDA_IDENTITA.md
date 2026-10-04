# Collegare un tecnico allo storico CRM

L'admin usa Dashboard → Collegamenti CRM espliciti. Colligo fornisce l'elenco di persone e account: il programma non deduce le identità dai nomi.

1. Per un account già esistente, selezionarlo nella riga e premere **Collega anche lo storico**. Per un nuovo tecnico premere **Crea tecnico e collega**, compilare nome, cognome, username e password iniziale di almeno 12 caratteri.
2. L'anteprima mostra risorsa, UID legacy, sessioni e minuti storici, alias attuale e destinazione. Verificare l'identità della persona, poi spuntare la conferma e premere il comando finale.
3. Il server verifica i permessi admin e l'account attivo. Collega la risorsa per le importazioni future e crea un alias tracciato. Non aggiorna l'UID o le ore delle sessioni storiche, comprese quelle confermate.
4. Dashboard, archivio ed economia raggruppano UID storico e account tramite l'alias. Il dettaglio conserva anche l'UID originale. I costi sono applicati per UID/alias e periodo di validità, mai per somiglianza del nome.

La creazione Firebase e il collegamento Supabase sono due sistemi: se il secondo fallisce, l'interfaccia mostra l'UID dell'account creato. Riprendere con **Collega anche lo storico** selezionando quell'account; non creare un secondo account. Se una risposta alla creazione è incerta, controllare prima l'elenco account. La password non è salvata nel browser o nell'audit.

Un alias già presente richiede un'anteprima aggiornata prima di essere corretto. Un conflitto o giornate che sommate supererebbero 24h bloccano il collegamento per verifica umana. Nessuna correzione storica è automatica.
