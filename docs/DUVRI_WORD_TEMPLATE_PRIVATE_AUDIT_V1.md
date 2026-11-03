# Colligo DUVRI — audit indipendente e PRIVATO del master Word (D2)

**Modulo offline, di sola lettura. Non approva il master né autorizza emissione DUVRI.**

## Problema risolto

Il master Word locale descritto da Codex presenta 22 campi logici / 27 commenti editoriali; una diversa copia conservata nella Libreria ChatGPT mostra 24 commenti e 40 marcature gialle XML. Questi valori sono **categorie differenti**, non una prova che i due file siano uguali o diversi. Prima di mappare D2 bisogna stabilire **quale file esatto** è in uso.

`tools/duvri_word_template_audit.py` analizza offline il DOCX senza modificarlo, senza utilizzare provider AI e **senza esporre estratti, nomi, autori o commenti**. Restituisce esclusivamente hash e conteggi: SHA-256 dei byte esatti; hash strutturale dei tag XML principali (non del testo); numero di tabelle, paragrafi, proprietà sezione, commenti, ancoraggi, riferimenti, nodi e gruppi gialli, shading e modifiche tracciate. I gruppi gialli sono calcolati in modo deterministico **per paragrafo**: non sono una mappatura dei placeholder.

### Esecuzione SOLO nel workspace privato Codex/Claude

Da root del repository:

```powershell
py -3 tools/duvri_word_template_audit.py "C:\PERCORSO_PRIVATO\MASTER_APPROVATO.docx"
py -3 tools/duvri_word_template_audit.py "C:\PERCORSO_PRIVATO\MASTER_APPROVATO.docx" --compare "C:\PERCORSO_PRIVATO\COPIA_ALTERNATIVA.docx"
```

Su Linux/macOS sostituire `py -3` con `python3`.

**Non incollare nella issue GitHub l'output SHA, percorsi privati o metadati da file aziendali**; conservarlo in un report di audit interno con controlli accessi. Il comando CLI non stampa path né contenuti. La modalità `--compare` restituisce soltanto se i byte sono identici e i **nomi** delle metriche cambiate (non il testo delle parti).

### Limiti di interpretazione

- Due DOCX con stesso hash **di file** sono esattamente identici; due DOCX con diverso hash possono contenere lo stesso testo. Un hash **strutturale** identico non prova identità visiva né qualità.
- `yellow_highlight_nodes`, `yellow_highlight_groups_per_paragraph` e `comments` non sono i 22 campi logici di Colligo. Separare e revisionare il mapping con un tecnico.
- Gli ancoraggi considerati sono quelli in `word/document.xml`; commenti in altri *stories* (header/footer e simili) richiedono estensione e verifica manuale.
- Non verifica il rendering, il layout pagina, gli indici di rischio, le 27 decisioni editoriali né l'esito del compilatore. Occorre QA visivo indipendente sulla bozza realmente compilata.
- Non è il server. Non carica il modello Word in GitHub, Supabase o provider AI e non cambia i file. Il processo rifiuta archivi DOCX sospetti (zip path traversal, parti XML troppo grandi, DTD, archivi cifrati o con entry duplicate).

**Gli output mantengono sempre:** `d1_approved=false`, `d2_approved=false` e `issuance_allowed=false`.

## Test e accettazione

Test completamente sintetici, eseguibili con:

```powershell
py -3 -m unittest discover -s tests/python -p "test_duvri_word_template_audit.py" -v
```

Il wrapper `tests/duvri-word-template-audit.test.js` richiama i **10 test Python** da `node --test`, rendendoli parte del quality gate del repository (su Windows cerca `py -3` e su Linux `python3`).

I test coprono conteggi distinti, SHA vs struttura, commenti non appaiati, shading diverso da highlight, file malformato, path traversal, DTD, nessuna perdita di testo privato e confronto di versioni.

## Handoff D2

Il backend Codex deve prima identificare quale master stia usando per la bozza Word **non emettibile**, verificare la SHA rispetto alla versione approvata da Colligo e confrontarne commenti, evidenziazioni e strutture. **Non approvare automaticamente D2** in base ai conteggi: richiedere conferma del titolare tecnico del modello.

Non intervenire su PR #21/#28 né sul backend Word locale senza una riconciliazione preventiva degli sviluppi.
