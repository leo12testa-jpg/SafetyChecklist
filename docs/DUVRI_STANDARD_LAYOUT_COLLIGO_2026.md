# Standard grafico Colligo DUVRI 2026 — profilo v1

**Scopo:** ogni nuova **bozza DUVRI** deve partire dal modello Colligo controllato, con l'impostazione grafica esemplificata nei due DUVRI 2026 esaminati offline. I file campione e i loro dati cliente **NON sono pubblicati nel repository** e non devono diventare materiale da copiare in nuovi DUVRI.

## Regole di impaginazione

- **Copertina:** A4 verticale, logo Colligo, logo del committente **solo se fornito e autorizzato**, titolo specifico, tabella azzurra di committente/appaltatori/subappaltatori con spazi firma vuoti, riga data e grafica originale del piede. Il numero delle imprese è variabile.
- **Margini di copertina:** circa 2,01 cm sopra, 1,45 sotto, 1,09 a sinistra, 0,99 a destra (tolleranza 0,15 cm).
- **Corpo A4 verticale:** 2,50 cm sopra, 2,00 sotto, 2,00 sinistra/destra; **orizzontale A4:** 2,30 sopra, 2,00 sotto, 2,00 sinistra, 2,50 destra. Orientamento e numero sezioni variano secondo allegati e tabelle.
- **Indice:** con il titolo *INDICE DEL DOCUMENTO*, numerazione capitoli, puntini di riempimento e riferimenti pagina aggiornati. Nei due PDF visivi l'indice inizia a pagina 2. La verifica su un PDF realmente renderizzato in Word Desktop è necessaria; il solo XML non può dimostrare l'assenza di pagine vuote.
- **Font e colori:** corpo in Arial circa 10 pt, titoli principali circa 12 pt, etichette di copertina variabili; celeste firme **C6D9F1**, intestazioni delle tabelle **DBE5F1** quando appropriate. NON applicare un font arbitrario a tutto il pacchetto: preservare stili, numerazioni, tabelle, caselle, immagini e relazioni originali.
- **Tabelle, intestazioni e piè di pagina:** colonne proporzionate, intestazioni tabella ripetute quando lunghe, numerazione pagine aggiornata e riferimenti all'intervento nell'intestazione; legende e documenti sorgente leggibili, senza nomi file spezzati lettera per lettera.
- **Sezioni:** mai convertire automaticamente una sezione nextPage in continuous per risparmiare pagine: un precedente collaudo Microsoft Word ha mostrato la sovrapposizione dell'indice sulla grafica di copertina. La geometria va rispettata per singola sezione, senza imporre il numero di sezioni del caso V5.
- **Commenti:** la rimozione è consentita solo quando il relativo rilievo editoriale è effettivamente risolto. Nessun commento o decisione tecnica HSE può essere cancellato dal normalizzatore grafico.

## Generazione e controlli

1. Le due aree visibili dell'app restano: **un file checklist Word** e **tutti gli altri allegati**.
2. Il pulsante **Genera bozza DUVRI (Word)** crea **solo un lavoro server di bozza** tramite il gateway documentale esistente, autenticato. Invia dati al provider soltanto dopo consenso esplicito; la risposta queued non viene spacciata per DOCX già creato.
3. Il worker dovrà utilizzare il modello ufficiale Colligo conservato su storage privato, in versione fissata per hash. È vietato sostituirlo con uno dei DUVRI cliente come matrice per il nuovo lavoro.
4. Prima di offrire il DOCX nel download: QA **read-only** tools/duvri_layout_contract_v1.py, verifica effettiva del modello, provenienza delle informazioni, controllo Word Desktop/indice/pagine/legenda. Se il QA fallisce, non marcare il file come pronto.
5. Sempre issuance_allowed=false fino a verifica Titolo IV/art. 26, valutazioni interferenziali, revisione umana HSE e decisioni D1/D2. Non compilare automaticamente nominativi, firme, piani di emergenza, soggetti o valutazioni non supportati dalle fonti.

## Confini attuali

Questo intervento introduce **l'azione reale di accodamento nella UI** e il contratto tecnico di impaginazione. **Non abilita il backend cloud**, non modifica il server per agganciare automaticamente il QA, non compila Word mediante AI locale e non installa l'app su Windows. Il collegamento al compilatore Windows installato (--mode postprocess-v5) è limitato alla **V5 sintetica fissata per SHA**, NON applicabile in automatico ai clienti. La pubblicazione o il merge richiedono il collaudo end-to-end con backend attivo, Word Desktop e una vera bozza sintetica prodotta tramite due upload.
