# DUVRI — controllo indipendente della dicitura NON EMETTIBILE nel DOCX

**Scopo:** verificare offline che una **copia di prova** del DUVRI riporti all'interno del documento almeno una candidatura testuale alla dicitura `NON EMETTIBILE`, anziché soltanto nel nome file. Questo controllo **non** attesta che la scritta sia visibile, leggibile o posizionata correttamente sulla pagina: tali condizioni richiedono **rendering e QA visivo indipendente di tutte le pagine**.

## Perché

Il collaudo privato Codex del 3 novembre 2026 ha prodotto una bozza Word non emettibile e strutturalmente valida, ma con **5 evidenziazioni gialle, 7 commenti e nessuna scritta `NON EMETTIBILE` all'interno del documento**. La sola dicitura nel nome del file è insufficiente.

## Funzionamento e limiti

`tools/duvri_word_draft_label_check.py`:
- opera **localmente in sola lettura**, senza rete, credenziali o modifiche al DOCX;
- riutilizza i controlli di sicurezza ZIP/OOXML di `duvri_word_template_audit.py`;
- cerca il testo `NON EMETTIBILE` nei paragrafi del corpo o di parti header/footer, anche se suddiviso in più run;
- non conta istruzioni di campo, commenti, revisioni eliminate e run palesemente nascosti/bianchi;
- riporta soltanto un **booleano di candidato testuale** e i conteggi di commenti/highlight/revisioni, mai il testo del cliente, i percorsi o le note dei commenti;
- mantiene tutti gli esiti **non emettibili**, anche quando la stringa viene trovata.

**Attenzione:** una frase trovata nell'OOXML non garantisce che venga effettivamente renderizzata. Una parte header/footer non referenziata, un oggetto coperto, un testo fuori pagina o contenuti non visualizzati possono passare la rilevazione strutturale. Perciò `label_visually_verified=false`, `word_visual_qa_approved=false`, `d1_approved=false`, `d2_approved=false`, `issuance_allowed=false` **sempre**.

La funzione è un *preflight*, non un test di layout e non un timbro di approvazione.

## Come usarlo nel workspace privato

```powershell
py -3 tools/duvri_word_draft_label_check.py "C:\PERCORSO_PRIVATO\BOZZA_NON_EMETTIBILE.docx"
```

Su Linux/macOS usare `python3`. Evitare di condividere DOCX, screenshot, hash, log di dati cliente o contenuti del Word nelle issue pubbliche.

### Integrazione suggerita a Codex

1. Usare questo controllo **sulla copia di bozza generata**, dopo il timeout/kill e il QA OOXML indipendente già presenti localmente.
2. Se manca la dicitura, restare bloccati e chiedere una modifica **solo al documento copiato**, senza alterare il master.
3. Inserire preferibilmente una dicitura ben riconoscibile nel frontespizio e/o header approvato da Colligo, non una stringa nascosta né una semplice nota/commento.
4. Richiedere a un verificatore indipendente il rendering della copia e l'ispezione di **tutte le pagine**, non affidarsi a un match testuale.
5. Valutare come gestire i 5 highlight e i 7 commenti residui, distinguendo campi aperti da note tecniche: non cancellarli automaticamente.
6. Anche dopo la verifica della dicitura, D1/D2, approvazione professionale e mappatura del Word rimangono obbligatori.

## Test

```bash
node --test tests/duvri-word-draft-label.test.js
python3 -m unittest discover -s tests/python -p "test_duvri_word_draft_label.py" -v
```

I **12 test Python sintetici** coprono etichetta presente nel corpo, spezzata su più run, in header, assente ma presente nel filename, hidden run, testo bianco, testo eliminato, commenti, highlight, riservatezza del report CLI e DOCX danneggiato. Nessun file reale è usato o caricato su GitHub.
