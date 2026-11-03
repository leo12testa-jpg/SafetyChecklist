# DUVRI Colligo — verifica dell'integrità delle pagine Word renderizzate (v1)

**Stato:** controllo **offline e in sola lettura**, destinato al workspace privato Codex. Non genera immagini, non modifica DOCX, non interroga provider AI, non approva la qualità visiva e **non autorizza mai l'emissione**.

## Problema

La prima bozza Word Colligo generata localmente dal backend aveva un QA strutturale indipendente, ma **nessuna verifica visiva**. Per ispezionare tutte le pagine occorre prima dimostrare che esiste un insieme **completo e coerente** di immagini riferite esattamente alla versione del DOCX da controllare. Un singolo screenshot o un insieme riferito a un vecchio Word non bastano.

Lo strumento `tools/duvri_word_render_evidence_check.py` riceve:

1. il DOCX **già compilato** e conservato privatamente;
2. un manifest JSON generato dal renderer locale;
3. una cartella privata contenente le immagini PNG `page-0001.png`, `page-0002.png` ecc.

Verifica la validità OOXML del DOCX, il suo SHA-256 effettivo rispetto al manifest, la sequenza completa 1..N senza duplicati, l'assenza di immagini PNG aggiuntive/stale, la presenza di ogni PNG, la struttura dei chunk PNG e relativi CRC, dimensioni minime e massime e SHA-256 effettivo di ogni immagine. Rifiuta symlink, nomi non previsti, percorsi relativi, manifest con campi inaspettati e schemi sconosciuti.

**Limite di fiducia:** il `page_count` e i dati di rendering provengono dal renderer. Il controllo non può provare **da solo** che il renderer abbia contato tutte le pagine del Word o che le immagini corrispondano a ciò che un'applicazione Word mostrerebbe. Il backend deve associare il manifest a una esecuzione isolata e autenticata, legare gli SHA al fascicolo e far verificare indipendentemente il numero di pagine.

## Contratto JSON del renderer (soltanto esempio sintetico)

```json
{
  "schema_version": "colligo-duvri-render-evidence-manifest/1.0",
  "draft_sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "render_run_id": "SYNTH_RENDER_RUN_001",
  "renderer_name": "LIBREOFFICE_HEADLESS",
  "renderer_version": "EXAMPLE_1",
  "page_count": 2,
  "page_images": [
    {"page": 1, "filename": "page-0001.png", "sha256": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"},
    {"page": 2, "filename": "page-0002.png", "sha256": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"}
  ]
}
```

Gli hash dell'esempio **non** corrispondono a file reali. Il backend deve ricalcolarli sui byte dei file e produrre il manifest atomicamente dopo il rendering completo. Non recuperare un manifest arbitrario dal browser.

### Utilizzo privato

```powershell
py -3 tools/duvri_word_render_evidence_check.py --docx "C:\WORKSPACE_PRIVATO\BOZZA.docx" --manifest "C:\WORKSPACE_PRIVATO\render.json" --images-dir "C:\WORKSPACE_PRIVATO\pages"
```

Su Linux/macOS sostituire `py -3` con `python3`. Il comando emette **solo contatori, stati e codici**, nessun testo Word, screenshot, commento, hash, nome cliente o percorso.

Lo stato positivo è esclusivamente `page_render_evidence_ready_for_independent_review`, accompagnato sempre da:

- `rendered_content_visually_reviewed=false`;
- `render_provenance_independently_attested=false`;
- `word_visual_qa_approved=false`;
- `d1_approved=false`, `d2_approved=false`, `issuance_allowed=false`.

Una CRC corretta e un'immagine completa **non** dimostrano che sia nitida, leggibile, posizionata correttamente o che contenga tutte le sezioni. Inoltre l'audit della dicitura `NON EMETTIBILE` nel DOCX (PR #54) e il QA indipendente del rendering restano controlli distinti.

## Cosa deve fare Codex dopo questo preflight

1. Renderizzare in un ambiente locale isolato la **copia DOCX compilata**, non il master originale; stabilire timeout e limiti risorse.
2. Legare un manifest immutabile all'hash della bozza, all'operazione e all'operatore del backend, con numero di pagine verificato mediante il renderer e file PNG numerati.
3. Eseguire questo tool. Se si blocca, scartare il pacchetto e ripetere il rendering, non ignorare l'errore.
4. Creare una **scheda privata per ogni pagina** con esito del revisore indipendente, verificando almeno: prima e ultima pagina, frontespizio, margini, tagli, intestazioni, tabelle, separazioni, inserimenti, riferimenti, dicitura `NON EMETTIBILE` effettivamente visibile e leggibile.
5. I 5 highlight e i 7 commenti residui della bozza locale devono essere esaminati dal tecnico: non rimuoverli automaticamente. Tutti i commenti e i campi devono essere coerenti con le decisioni D1/D2.
6. Conservare report ed immagini in storage privato; non caricarli su GitHub, non allegarli a issue pubbliche e non trasferirli a provider esterni.
7. **Non** usare l'esito di questo controllo come un'approvazione: un processo futuro separato deve verificare gli attestati professionali e D1/D2.

## Test

```bash
node --test tests/duvri-word-render-evidence.test.js
python3 -m unittest discover -s tests/python -p "test_duvri_word_render_evidence.py" -v
```

I **19 test Python** creano solo DOCX/PNG sintetici in cartelle temporanee. Coprono render completo, Word modificato, pagina mancante o extra, hash errato, CRC alterato, PNG danneggiato, numerazione errata, nomi/percorso non consentiti, manifest incompleto o duplicato, dimensioni insufficienti, Word illeggibile, symlink, uscita CLI senza dati riservati, IEND mancante e campi estranei.

Nessun PDF, Word o screenshot reale Colligo è pubblicato nel repository. Lo strumento non è integrato nella produzione e **l'assenza di un collaudo visivo rimane un blocco**.
