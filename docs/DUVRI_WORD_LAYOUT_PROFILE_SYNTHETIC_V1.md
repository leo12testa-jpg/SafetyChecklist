# DUVRI — profilo deterministico di impaginazione Word (solo prove sintetiche)

## Obiettivo

Correggere **all'origine** i difetti osservati nella bozza sintetica V5: nomi di file sorgente lunghissimi spezzati in molte righe, colonna delle evidenze troppo stretta e interruzioni di sezione superflue. **Non cambiare i margini del master Colligo**; il problema era la distribuzione del contenuto, non i valori dei margini.

Il modulo `tools/duvri_word_layout_profile.py` è un **post-processore offline per sole bozze sintetiche**, non un generatore completo e non un componente attivo in produzione. Deve essere invocato dal generatore locale soltanto dopo che ha realmente creato una bozza DOCX basata sul master approvato, e prima del QA Word, solo su copia temporanea.

## Trasformazioni previste

1. Riceve un profilo locale esplicito contenente `synthetic_only=true`, `section_count=19`, una tabella di mapping fonte `S1/S2/S3/... ↔ nome completo`, i numeri di interruzione preventivamente approvati e le larghezze delle tre colonne della tabella di verifica Titolo IV/art. 26.
2. Verifica che il Word contenga marcatura `NON EMETTIBILE` e `SIMULAZIONE`, una sola tabella di verifica identificabile e il registro fonti con i nomi completi. Fallisce se mancano o sono cambiati.
3. Abbrevia i richiami ai nomi dei file **solo nelle citazioni nel corpo**, preservando il registro autorevole del documento. Rimuove eventuali `w:br` esclusivamente all'interno dei nomi abbreviati, senza eliminare altri contenuti.
4. Ribilancia le colonne `Verifica / Elementi documentali pertinenti / Esito del tecnico` con larghezze fisse esplicitamente autorizzate. Non cambia altre tabelle.
5. Trasforma in `continuous` soltanto le sezioni consentite dal profilo, rifiutando cambiamento fra orientamenti verticali e orizzontali.
6. Confronta ogni parte del DOCX prima e dopo: immagini, stili, numerazioni, commenti, relazioni e impostazioni **devono essere identici byte per byte**. Solo `word/document.xml` può cambiare.

## Gate

- Il documento originale non viene mai sovrascritto; l'output deve essere nuovo.
- Non si applica automaticamente a documenti reali o ad altri master con sezioni diverse.
- I commenti tecnici HSE rimangono; questo modulo **non li contrassegna come risolti e non li cancella**.
- Non esegue Word COM, AI, calcolo rischi, approvazioni D1/D2, firma o emissione.
- `issuance_allowed=false` in ogni rapporto.
- Il risultato deve essere renderizzato e verificato su **tutte le pagine** prima di utilizzare l'output nella demo.

## Collaudo locale della V5 sintetica (senza includerla in GitHub)

Su una copia privata della V5 originale è stato provato il prototipo: 120 nomi abbreviati, una tabella adattata, sette interruzioni compatibili riprofilate, 19 sezioni, 28 tabelle e 7 commenti mantenuti; **solo `word/document.xml` cambiato, le altre 57 parti identiche**; rendering LibreOffice di **51 pagine**. Queste cifre sono evidenza sul corpus privato di prova e **non** vanno usate per approvare documenti cliente o per affermare parità pixel tra Word e LibreOffice.

Per confrontare Microsoft Word desktop e layout effettivo, Codex dovrà applicare la stessa trasformazione in ambiente locale su copie temporanee, eseguire il parser di commenti e poi verificare tutte le pagine nel renderer del tecnico. La PR non è l'integrazione del compilatore DOCX privato, che rimane su Windows.

## Test CI

```bash
node --test tests/duvri-word-layout-profile.test.js
python3 -m unittest discover -s tests/python -p 'test_duvri_word_layout_profile.py' -v
```

Test negativi: documenti non sintetici, fonte assente, struttura master diversa, salto con cambio orientamento, mappatura non approvata, macro, percorso sorgente insicuro, duplicazione ID, ZIP malformato e output già esistente.

**Integrazione richiesta:** la procedura di generazione locale deve produrre un profilo riferito esclusivamente alla revisione DOCX attuale e al registro delle fonti già verificato, eseguire il tool una sola volta, conservare vecchio/nuovo SHA, quindi Word QA indipendente. Nessun merge/deploy/uso cliente senza ulteriori approvazioni.

Il collaudo CI deve riferirsi allo SHA corrente della PR. Non attribuire a questo profilo un’approvazione delle decisioni tecniche HSE o un test Microsoft Word Desktop che non è stato eseguito.
