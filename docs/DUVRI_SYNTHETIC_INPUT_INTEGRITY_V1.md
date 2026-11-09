# DUVRI — controllo integrità dei quattro fascicoli sintetici (9 novembre 2026)

**Ambito:** esclusivamente il corpus di test fittizio `SIM-01…SIM-04`, generato da `tools/duvri_realistic_synthetic_bundle.py`. Non è una modifica alla PWA Checklist/Sopralluoghi o al generatore Word privato.

## Cosa verifica realmente

- Esattamente quattro cartelle di test con il proprio identificativo opaco, senza fascicoli supplementari.
- **Una sola checklist cliente DOCX per fascicolo** e almeno il PDF centrale; gli altri allegati restano indipendenti, senza accedere al database della PWA.
- SHA-256 e lunghezza calcolati **dai byte dei singoli documenti**, confrontati con il manifest locale; ID, job, ruolo, MIME e tipo reale dei file coerenti.
- Nessun file extra, symlink, hardlink, file mancante, ID duplicato o cross-case (un PDF di SIM-02 passato a SIM-01 provoca BLOCCO).
- Il pacchetto ZIP del corpus contiene esattamente gli stessi file delle cartelle, byte-per-byte, e il riepilogo riporta il corretto SHA dell'archivio.
- Manifest e riepilogo con `issuance_allowed=false`; D1/D2 e Word QA restano false e non possono essere elevati dal test.
- Risposta pubblicabile limitata a codici di blocco e conteggi. Niente testo dei documenti, percorsi locali, clienti o credenziali.

## Esecuzione offline

```bash
python3 tools/duvri_realistic_synthetic_bundle.py --out /tmp/duvri_corpus_fittizio
python3 tools/duvri_synthetic_input_integrity.py --corpus /tmp/duvri_corpus_fittizio
node --test tests/duvri-synthetic-input-integrity.test.js
```

La suite include 18 test negativi e positivi. La nuova QA viene eseguita nella CI Node, ma la **prova end-to-end del generatore privato** richiede comunque caricare ciascun DOCX e tutti i relativi allegati nella UI del generatore.

## Limiti e decisioni residue

Il checksum confrontato con un manifest nella stessa cartella garantisce la **coerenza interna**, non certifica da solo l'identità di un mittente ostile: per un fascicolo reale servono hash memorizzati dal backend privato, versione, provenienza, ACL e attestazioni affidabili. Il test qui non analizza il significato dei rischi, non prova le interferenze fra imprese, non esegue modelli AI, non emette Word e non valuta la visibilità della marcatura su tutte le pagine Microsoft Word.

Il Word V5 REAL_SYN_01 riferito da Codex **non è stato esaminato** da questa PR, perché si trova sul PC locale. Rimane NON EMETTIBILE; sono ancora indispensabili HSE, D1/D2, Word visivo, Titolo IV/art. 26 e chiarimenti specifici.

Questa PR serve solo a rendere rigoroso il **primo passaggio del flusso** (DOCX Word cliente + allegati), senza sostenere che il generatore sia concluso.
