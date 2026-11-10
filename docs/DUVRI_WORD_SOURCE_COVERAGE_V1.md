# DUVRI — controllo contenuti attesi nel Word (read-only, V1)

Questo strumento è un **preflight testuale** per il compilatore DUVRI privato.
**Non genera il DUVRI**, non esegue agenti AI, non legge file cliente da
GitHub, non prova la veridicità delle fonti e **non autorizza l'emissione**.
Il modello Word Colligo, le checklist compilate e gli allegati restano nel
workspace privato.

## Perché serve

La verifica SHA-256 e della struttura OOXML non dimostra che i **dati
specifici dell'intervento** siano stati inseriti. Il controllo confronta un
elenco di frammenti attesi forniti dal backend privato con i paragrafi
(incluse tabelle) effettivamente presenti in word/document.xml.

Un'assenza blocca il controllo; una presenza è solo evidenza candidata
di copertura testuale. Non prova collocazione nella sezione corretta,
valutazione interferenziale, congruità delle misure, completezza degli
allegati, testo in tutte le caselle o leggibilità delle pagine.
Per queste verifiche restano necessari D1/D2, QA Word, rendering e revisione HSE.

## Manifest privato (valori sintetici non collegati ad alcun documento)

~~~json
{
  "schema_version": "colligo-duvri-word-source-coverage/1.0",
  "job_id": "JOB_SYNTHETIC_001",
  "document_revision_id": "DOCX_SYNTHETIC_001",
  "draft_sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "source_files": [
    {"file_id": "FILE_SYNTHETIC_001", "sha256": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}
  ],
  "required_claims": [
    {
      "claim_id": "CLAIM_SYNTHETIC_001",
      "file_id": "FILE_SYNTHETIC_001",
      "locator": "page:1:line:5",
      "exact_text": "Controllo accessi da verificare"
    }
  ],
  "forbidden_markers": ["Segnaposto demo"]
}
~~~

Gli ID, revisioni e SHA devono essere assegnati e verificati dal backend
autenticato, non da un agente AI o dal browser. L'elenco required_claims
contiene soltanto i fatti che il backend richiede esplicitamente di
riportare nel Word. Il backend deve comprovare l'ACL e gli hash sorgente;
nessuna AI può decidere da sola quali parti omettere.

## Utilizzo nel workspace privato

~~~bash
python3 tools/duvri_word_source_coverage_check.py --docx "/private/draft.docx" --manifest "/private/coverage.json"
~~~

Il manifest e il DOCX **non vanno pubblicati**. L'output contiene soltanto
contatori, booleani e codici fissi, senza nomi, testi, hash o percorsi.
Exit code 0: candidate_text_coverage. Exit code 2: blocked.

Test sintetici:

~~~bash
python3 -m unittest discover -s tests/python -p 'test_duvri_word_source_coverage.py' -v
~~~

## Integrazione richiesta nel compilatore privato

1. Dopo l'estrazione, il backend seleziona tutti i fatti che devono
   apparire nel Word, ognuno associato a fonte, hash, pagina/riga e revisione.
2. Dopo la compilazione, ricalcola l'hash DOCX e prepara un manifest
   immutabile. I testi attesi non devono essere scelti dall'AI generativa.
3. Esegue il preflight in isolamento sul DOCX realmente compilato. Se
   l'esito è blocked, il documento non può essere attestato completo.
4. Esegue separatamente QA del master, impaginazione, rendering, commenti,
   interferenze e approvazioni D1/D2, HSE e Titolo IV/art.26.
5. Il verificatore restituisce SEMPRE issuance_allowed=false.

**Stato:** modulo pubblico generico offline, non ancora collegato al
gateway Windows privato né al coordinatore AI V14.
