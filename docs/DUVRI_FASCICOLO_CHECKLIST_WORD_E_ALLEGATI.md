# COLLIGO DUVRI AI — Manifest fascicolo e allegati del cliente

**Stato:** prototipo isolato della PR #28. Non collegato alla UI o allo storage privato in produzione.

## Perimetro

Il cliente riceve una **checklist Word DOCX** e la rimanda compilata, insieme a PDF, immagini, planimetrie, DVR e altri allegati pertinenti. Il fascicolo deve riferirsi a **un solo intervento**, indipendentemente dal cliente.

## Modulo

`js/duvri-case-manifest.js` valida un manifest di soli metadati, composto da:
- `job_id`: ID opaco del fascicolo;
- `file_id`: ID opaco del file;
- `role`: `client_checklist`, `supporting_document`, `photograph` o `drawing`;
- `mime_type` ammesso;
- `size_bytes` e SHA-256;
- `parse_status`: `pending`, `parsed`, `unreadable`.

È richiesta **una checklist principale in formato DOCX**. Altre versioni documentali possono essere archiviate come allegati, con logica di revisione da progettare separatamente.

Il validatore rifiuta documenti dichiarati di un altro fascicolo, ID duplicati, copie identiche, eseguibili con MIME non consentito e campi estranei. ZIP e immagini HEIC/HEIF, quando presenti fra gli allegati, sono mantenuti nel fascicolo come **file da verificare manualmente** e non sono autorizzati come evidenze per gli agenti. Un file illeggibile genera `needs_attention`, non una valutazione positiva.

## Limite di fiducia

Il manifest NON prova che il file sia sicuro o correttamente descritto. In produzione il backend deve:
1. autenticare l'utente e verificare i suoi permessi sul fascicolo;
2. caricare metadati dal database privato, non dal browser;
3. verificare i veri byte del file, il MIME e l'impronta SHA-256, con scansioni di sicurezza appropriate;
4. applicare limiti di dimensione, quote e protezione da archivio malevolo secondo policy;
5. garantire che `file_id` e `job_id` siano associati in database;
6. conservare revisioni, data di caricamento e controlli di integrità;
7. non passare a nessun agente documenti di altri incarichi;
8. effettuare separatamente l'estrazione e la verifica delle fonti prima delle conclusioni HSE.

La lista `files_for_authorization_review` è **solo candidata** a essere autorizzata dal backend; non è un'ACL e non permette di trattare automaticamente il contenuto come evidenza verificata. `manual_review_file_ids` elenca i file non leggibili o in formati non ancora acquisibili (es. ZIP e HEIC): non devono essere passati agli agenti prima di una procedura privata di verifica e conversione.

Il risultato resta `evidence_verified=false`, `requires_extraction=true`, `issuance_allowed=false` in tutti i casi.

## Test

`tests/duvri-case-manifest.test.js`: 21 test con documenti sintetici, inclusi Word principale, allegati, casi diversi, duplicati e formati non ammessi. Nessun documento aziendale e nessun costo API.

```bash
node --test tests/duvri-case-manifest.test.js
```

**Non distribuire questo componente nel runtime** prima di confrontare i suoi requisiti con il sistema di upload già presente in SafetyChecklist e il gateway privato proposto nella PR #21.

## Collegamento con il modello Colligo

Questo contratto di fascicolo **non seleziona il modello Word**. L'originale ufficiale deve essere verificato separatamente mediante SHA-256 **completo** letto dal file effettivamente approvato, non dal nome del DOCX o dal prefisso dell'impronta. La compilazione resta bloccata finché il mapping D2, i commenti, le firme e il metodo D1 non sono stati approvati.
