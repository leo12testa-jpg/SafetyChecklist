# Verifica pilota prima dell’abilitazione

Colligo fornisce l’elenco approvato di 2–3 persone: risorsa/sigla CRM, nome, cognome e username. Fino ad allora non creare account reali né approvare alias reali.

Per ogni persona, usare la procedura descritta in GUIDA_IDENTITA.md. Controllare nell’anteprima la risorsa scelta, UID legacy, conteggio sessioni e minuti. Confermare solo l’identità indicata nell’elenco. Verificare che il nuovo account abbia ruolo tecnico e che la risorsa futura punti al suo UID.

Confrontare prima/dopo: gli ID e i tecnico_uid delle sessioni storiche devono essere identici; nelle analisi la persona deve comprendere storico e nuove ore tramite l’alias; nessun altro segnaposto deve cambiare. L’audit deve indicare admin, data e valori precedenti e nuovi. Verificare un accesso reale del pilota e che non veda dati di colleghi.

Prove preparatorie: il browser simula creazione account e collegamento; ore-pilot-identity-db.sql verifica tre risorse sintetiche con rollback completo, conservando gli UID storici. Queste prove non sostituiscono il collaudo dei 2–3 account reali dell’elenco.

Smoke tecnico dopo ogni deploy: usare `node tests/ore-live-permissions.cjs`, con ORE_SMOKE_PASSWORD fornita tramite secret e ORE_SMOKE_FOREIGN_SESSION impostato a una sessione esistente di altro proprietario. Il programma controlla il ruolo e il contrassegno account_test, tutte le azioni admin e la modifica altrui. Non stampa token/password e non scrive ore. Creazione una tantum: scripts/ore-create-test-account.cjs richiede anche ORE_ADMIN_TOKEN, mai conservato nel repository.
