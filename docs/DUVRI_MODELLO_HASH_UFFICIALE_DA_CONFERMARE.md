# DUVRI — impronta ufficiale del modello Word (controllo di sicurezza)

**Problema individuato nel codice preesistente:** `js/document-intake.js` usava una stringa SHA-256 completa non confermata (`69b2f63c…`) e un numero di immagini 17, mentre Claude Code ha comunicato il prefisso `69B2F63C…` e 19 immagini. La copia Word accessibile durante la sessione è invece un file diverso, con SHA-256 che inizia con `C6C8AB57…`. I due file non devono essere considerati identici.

**Correzione:** la configurazione DUVRI imposta `sha256:null` finché il responsabile del modello non fornisce l'impronta completa di quello approvato. Il solo prefisso rimane informativo. Il confronto strutturale informativo è limitato ai 13 tavoli e alle 19 sezioni documentati; la struttura non può supplire all'identità crittografica. `inspectTemplate` restituisce `controlled:false` se manca un SHA-256 completo e valido; il gate D1 resta anch'esso chiuso.

## Sblocco controllato

1. Claude Code ricalcola *sul suo PC* lo SHA-256 integrale del vero file ufficiale e produce un manifest di versione approvato (senza pubblicare contenuto cliente).
2. Si confrontano le due copie: non basta che si chiamino entrambe `DUVRI_BASE_GENERALE_2026.docx`.
3. Il valore completo approvato viene configurato in una successiva integrazione autenticata, con versione e audit aziendale, non da una risposta AI o da un upload del cliente.
4. Prima di ogni generazione il backend verifica la copia effettiva e l'integrità del DOCX, poi procede esclusivamente su una copia di lavoro, con mappatura D2 verificata e D1 approvata.

**Non è un'abilitazione del generatore.** È una correzione che impedisce l'errore di trattare per ufficiale un template non verificato. I controlli sulla bozza reale compilata restano da effettuare.
