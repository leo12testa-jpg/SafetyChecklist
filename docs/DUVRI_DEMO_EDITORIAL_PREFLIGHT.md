# DUVRI — verifica editoriale automatica prima della demo

**Scope:** soltanto bozze DOCX non emettibili. Questo tool non produce, approva o modifica un DUVRI, non invia file a GitHub/AI e non controlla il filesystem aziendale.

`tools/duvri_demo_editorial_gate.py` riceve **la copia di prova** del DOCX e legge OOXML in sola lettura. Produce soltanto codici e conteggi (mai testo, percorsi, nominativi, PDF, immagini o commenti). Non esegue macro né Word COM.

```bash
python3 tools/duvri_demo_editorial_gate.py /percorso/BOZZA_REAL_SYN_01_V5_NON_EMETTIBILE.docx
```

Su Windows, da un terminale autorizzato, sostituire `python3` con `py -3` e indicare la copia V5 sintetica **effettivamente generata**. Il comando non va lanciato su documenti reali senza approvazione.

## Blocchi strutturali rilevati

- Dicitura `NON EMETTIBILE` assente dal testo o da intestazioni/piè di pagina.
- Vecchio `SOMMARIO DA AGGIORNARE IN WORD`, o codice `DUVRI_[DATO NON DISPONIBILE]` rimasto visibile.
- Celle delle tabelle con oltre 600 caratteri (candidato difetto d'impaginazione, non divieto professionale).
- Mancanza di collegamenti interni e marker INT01/INT02 nel caso sintetico di riferimento.
- Revisione AI dichiarata incompleta; riferimento residuo al vecchio file di checklist sintetica (da verificare sulla fonte, non cancellare automaticamente).

I commenti Word residui vengono **contati**, non rimossi. La presenza di un errore restituisce codice di uscita `2`, quindi la CI può bloccare la consegna della demo. Tutti i risultati, positivi o negativi, restano `issuance_allowed=false`.

## Limiti

La scansione non prova correttezza dei dati, sostituzione nel master Colligo, leggibilità di ogni pagina, validità dei link evidenza, numero pagine Word, funzionamento reale AI, Titolo IV/art.26, HSE, D1/D2 o firme. Questo richiede la V5 locale e il portale locale. Non pubblicare documenti riservati nel repository.

Test:

```bash
node --test tests/duvri-demo-editorial-gate.test.js
```

**Priorità**: usare il gate sulla nuova V5 e non su una versione precedente, poi eseguire controllo visivo Word Desktop e una prova completa checklist DOCX + PDF/XLSX → download Word.
