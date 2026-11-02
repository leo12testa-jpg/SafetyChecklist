# COLLIGO DUVRI AI — Protocollo di revisione dei 22 segmenti gialli

**Stato:** contratto di mapping isolato, da adottare solo dopo confronto con la cartella locale di Claude Code. Non apre né modifica documenti Word.

## Dato di partenza (comunicato da Claude Code)

Modello: `DUVRI_BASE_GENERALE_2026.docx`, copia sotto `modelli/MODELLO_DUVRI_segnaposto.docx`. Claude ha verificato l'identità *byte per byte* sul suo PC.

**SHA-256 noto in questa chat: solamente prefisso `69B2F63C…`. Non indovinare mai il valore completo.** Il backend deve ricevere l'hash intero da un manifest locale approvato, con versione e verbale di approvazione verificabile, poi ricalcolarlo sul documento utilizzato.

Segmenti evidenziati: **22** (62 run Word distribuiti fra corpo, intestazioni e piè di pagina). Il documento al momento è **NON CONFORME**: 0 segmenti assegnati, 27 commenti e firme non riconosciute; le tabelle dei rischi richiedono mapping separato.

## Problema operativo

Non possiamo automatizzare l'assegnazione a partire da etichette poco chiare. Dobbiamo utilizzare il file di Claude `uscita/collaudo_reale/revisione_campi_gialli.xlsx` in locale: la colonna F viene decisa dal tecnico dopo aver visto il contesto originale.

Il modulo nuovo `js/duvri-yellow-field-map.js` non vede il file Excel: valida soltanto un manifest *normalizzato* e anonimizzato con esattamente 22 elementi.

## Schema di ogni decisione (solo metadati)

```json
{
  "segment_id": 1,
  "mode": "field",
  "field_key": "client.legal_name",
  "reviewer_id": "TECNICO_SYNTH_001",
  "review_reference": "REVIEW_SYNTH_001",
  "reviewed": true
}
```

È possibile anche `mode: "not_applicable"`, solo con una `reason` e un revisore esplicito; oppure `mode: "unreviewed"` quando la decisione manca. Niente valori dei clienti, nomi reali, estratti o percorsi nelle chiavi.

**Questo manifest non dimostra che il campo sia compilato nel DOCX.** Dopo l'approvazione del mapping, il motore deve riempire i valori pertinenti in una copia e verificare il documento prodotto.

## Procedura per Claude Code

1. Elencare **in locale** i 22 segmenti, ognuno con `segment_id`, posizione OOXML e contesto leggibile nel foglio di revisione. Non trasmettere dati riservati alla chat o a GitHub.
2. Il tecnico decide nella colonna F il campo strutturato da associare, oppure la non applicabilità motivata. Vietato inventare una corrispondenza.
3. Claude normalizza il foglio approvato in un manifest con 22 elementi, salva localmente mappa e revisioni.
4. Il nuovo validatore restituisce `mapping_ready` solamente se ogni segmento è assegnato o giustificatamente non applicabile e la decisione è stata sottoposta a revisione. Gli elementi ancora incerti rimangono `needs_review`.
5. Dopo l'approvazione del mapping, ripetere il collaudo del Word con dati sintetici **effettivamente inseriti**, inclusi header/footer, caselle di testo e tabelle dei rischi.
6. Separatamente verificare i 27 commenti redazionali, il blocco firme e la metodologia D1. Il solo mapping dei gialli non può sbloccare l'emissione.
7. Non pubblicare la mappa reale in GitHub se contiene estratti o elementi riservati. Un report anonimo può riportare solo conteggi e stato.

## Contratto tecnico con il gate finale

`validateMapping()` produce `mapped`, `populated_expected`, `not_applicable`, `verified`, `unresolved` e `mapping_approved` ma `document_fields_populated=false` e `issuance_allowed=false` sempre.

Il backend dovrà misurare **separatamente** i campi realmente inseriti e il confronto DOCX: non copiare un `true` proveniente dal browser o dall'AI per saltare i controlli.

Il progetto DUVRI resta universale per tutti i clienti Colligo: la mappatura riguarda il modello aziendale, non una singola commessa COIN.
