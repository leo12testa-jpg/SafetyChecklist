# DUVRI — QA strutturale di due bozze Word sintetiche (read-only)

Il verificatore `tools/duvri_word_synthetic_pair_audit.py` confronta una bozza sintetica non marcata con la copia marcata **NON EMETTIBILE**, senza modificarle, renderizzarle, inviarle alla rete o usare modelli AI.

## Che cosa verifica

- Che `word/document.xml` delle due copie sia **byte-identico**. Se differisce, blocca: la marcatura non deve riscrivere il corpo.
- Che la dicitura `NON EMETTIBILE` abbia **candidati testuali non palesemente nascosti** nelle intestazioni realmente collegate alle sezioni Word. Considera `default`, `first` quando `titlePg` è attivo, `even` quando attivo, ed eredità delle intestazioni lungo le sezioni. Un header orfano non vale come prova.
- Se viene fornito un manifest JSON dichiarato `synthetic_only:true`, cerca valori attesi e termini non coerenti con lo scenario: restituisce **solo gli indici numerici**, mai testi, nomi, percorsi o altro contenuto del documento.
- Conta commenti Word ed evidenziazioni gialle rimaste nel corpo. Restituisce codici di blocco tracciabili.

**NON prova** che la dicitura sia visibile in tutte le immagini Word: anche con `marked_header_routes_have_label_candidate=true` forza `label_visible_on_every_page_verified=false`, `word_pages_visually_verified=0` e `issuance_allowed=false`. Servono le PNG effettive del renderer MSWORD_COM e un revisore tecnico indipendente. Non usare LibreOffice come sostituto della prova.

## Esecuzione nel worktree privato Codex

```powershell
py -3 tools/duvri_word_synthetic_pair_audit.py "C:\PERCORSO_PRIVATO\BOZZA_SINTETICA_NON_EMETTIBILE.docx" "C:\PERCORSO_PRIVATO\BOZZA_SINTETICA_NON_EMETTIBILE_MARCATA.docx" --manifest "C:\PERCORSO_PRIVATO\scenario_h_manifest.json"
```

Manifest **solo sintetico** locale, ad esempio:

```json
{
  "synthetic_only": true,
  "expected_values": ["Valore sintetico A", "Valore sintetico B"],
  "forbidden_terms": ["Espressione incompatibile con lo scenario sintetico"]
}
```

Indici zero-based: `missing_expected_value_indices:[1]` significa che manca la **seconda voce** del manifest. Non pubblicare il manifest di un fascicolo reale su GitHub.

## Evidenze diagnostiche sulle due bozze sintetiche del 3 novembre 2026

Il confronto indipendente, eseguito esclusivamente sui due DOCX caricati per lo scenario H, ha rilevato:

- `main_document_xml_unchanged=true`, **19 sezioni**, intestazioni `first` e `default` con candidato strutturale alla marcatura, senza un percorso di intestazione mancante.
- **12 valori sintetici attesi controllati, 1 assente**. Il candidato è la dichiarazione `Nessun subappaltatore sintetico previsto`; non si certifica che sia il binding n. 12 finché Codex non verifica il mapping effettivo.
- Quattro termini contestuali di supermercato/punto vendita rimasti nel documento logistico, **7 commenti editoriali** e **5 evidenziazioni gialle**.
- La conversione di controllo LibreOffice ha prodotto 34 pagine, mentre la prova desktop Microsoft Word dell'utente riportava 30 PNG. Questo divario non basta, da solo, a dimostrare un difetto nel renderer Word.
- Il confronto visivo LibreOffice mostra la marcatura soltanto su pagina 1; lo **stato delle 30 immagini Word rimane non verificato**. La presenza in header XML non assolve il QA visivo.

## Criteri per Codex

1. Recuperare il risultato della prova desktop Word delle 30 pagine e verificare **marcatura e layout su ognuna**; autenticazione revisore distinta dal generatore, esiti inizialmente PENDING.
2. Risolvere il valore sintetico assente tramite mapping o registrare una lacuna motivata; **non inventare** una posizione nel template, non aggiungere valori casualmente.
3. Trattare i testi contestuali errati come problemi editoriali da approvare (D2), mai riscrivere automaticamente l'intero master.
4. Mantenere commenti, evidenziazioni, tabelle rischi, D1/D2 e QA Word come **blocchi**, non come difetti di test da nascondere.
5. Non caricare dati cliente o documenti aziendali nel repository; esecuzione locale soltanto, zero costi API.

## Test

`node --test tests/duvri-word-synthetic-pair-audit.test.js` richiama `10` test Python con DOCX sintetici creati al volo; nessun documento reale è committato.
