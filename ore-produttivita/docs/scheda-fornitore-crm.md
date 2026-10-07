# Colligo Ingegneria — richiesta di verifica dell’agente agenda CRM

**Scopo.** Alimentare la rendicontazione interna con gli appuntamenti delle agende dei tecnici. Chiediamo al fornitore di confermare modalità consentite, timeout delle sessioni e disponibilità di API o esportazioni ufficiali.

**Cosa fa l’agente.** Sul portatile aziendale apre il CRM in un browser Edge dedicato, seleziona esplicitamente una risorsa e legge date, orari, oggetto e identificativi disponibili degli appuntamenti. Verifica che l’agenda appartenga alla risorsa selezionata. Interpreta gli orari come Europe/Rome e li converte in UTC. Non crea, modifica o cancella appuntamenti, clienti o commesse nel CRM.

**Frequenza e recupero.** Un ciclo ogni cinque minuti mentre il PC è acceso e l’utente Windows è connesso; un ciclo anche al primo accesso Windows dopo l’accensione. Dopo uno spegnimento rilegge il periodo dalla precedente giornata coperta fino a oggi, a blocchi di massimo 30 giorni per risorsa/ciclo. Gli arretrati più lunghi proseguono nei cicli successivi. La notte il portatile è spento: non è previsto accesso continuo.

**Permessi richiesti.** Un eventuale account dedicato deve poter leggere esclusivamente le agende e l’elenco delle risorse autorizzate. Nessun permesso di scrittura sul CRM, amministrazione, gestione utenti o consultazione di dati estranei alle agende. Chiediamo un identificativo stabile dell’appuntamento, conservato quando cambiano orari, oggetto o risorsa, e una modalità per rilevare cancellazioni o spostamenti.

**Accesso attuale.** Se la sessione è scaduta, Edge viene mostrato una sola volta per il login eseguito da una persona. Dopo il login l’agente torna invisibile. Non inserisce né memorizza la password CRM. Il login automatico non è implementato.

**Protezione.** La sessione browser è salvata cifrata sul PC; la chiave di cifratura e il token dell’app interna sono protetti dal Gestore credenziali Windows dell’utente che esegue il task. Nessun valore di cookie, token o password viene scritto nei log o nel repository. I log operativi contengono esito, orario e risorse lette, non gli oggetti degli appuntamenti.

**Decisioni richieste al fornitore.** Confermare se l’automazione di lettura è consentita; precisare timeout per inattività, durata massima e limiti di frequenza; indicare API/export supportati, fuso ufficiale e ID stabili. Un eventuale rinnovo automatico tramite credenziali dell’account dedicato richiederebbe una successiva approvazione di Colligo e del fornitore, incluse le regole su MFA. Non verrà introdotto prima di tale decisione.

**Collaudo.** Una giornata 09:00–18:00 con PC acceso e in carica, seguita da spegnimento serale e riaccensione mattutina. Importazioni nell’app Ore bloccate durante il collaudo; giornate confermate e mesi chiusi restano protetti.
