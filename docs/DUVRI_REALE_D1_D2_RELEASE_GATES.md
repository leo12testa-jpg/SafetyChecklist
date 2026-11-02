# COLLIGO DUVRI AI — Gate di preparazione alla revisione finale del modello Word reale

**Stato:** modulo isolato e deterministico. Nessuna interazione con Word, intranet, worker, AI o produzione.

## Origine dei requisiti

Il rapporto di Claude Code comunicato dall'utente (2 novembre 2026) identifica:
- il modello originale `DUVRI_BASE_GENERALE_2026.docx`, con SHA-256 comunicato **soltanto come prefisso** `69B2F63C…` (l'impronta completa non è disponibile in questa chat e non deve essere indovinata);
- 19 sezioni, 13 tabelle, 16 caselle di testo, 62 run gialli raggruppati in **22 segmenti** e **27 commenti redazionali**;
- sulla copia **non compilata** i controlli OOXML e il confronto visivo sono quasi identici;
- 0/22 segmenti mappati, 27 commenti ancora da decidere, tabella firme da riconoscere e tabelle rischi non basate sui gialli;
- modello originale verificato, adattatore in prova e metodologia di rischio D1 non approvata.

Questi dati derivano dal **rapporto dell'utente**, non da accesso diretto ai documenti sul suo computer.

## Modulo

- `js/duvri-document-readiness.js`: valuta attestazioni ricevute da componenti fidati.
- `tests/duvri-document-readiness.test.js`: 20 test su casi sintetici, incluso lo stato non conforme comunicato da Claude.
- `OFFICIAL_SHA256_PREFIX`: prefisso informativo realmente comunicato da Claude. L'hash SHA-256 **completo** va letto da un manifest locale controllato e approvato, verificato lato server; nessuna impronta inventata nel codice.
- `OFFICIAL_BASELINE`: costanti del modello attualmente verificato.

**La funzione non esamina realmente un DOCX.** Il futuro backend deve produrre le attestazioni da verifiche automatiche e revisioni HSE registrate, NON accettare flag true dal browser, dai documenti o dagli agenti.

## Requisiti minimi valutati

1. Modello originale ufficiale corrispondente alla versione controllata.
2. Tutti i **22 segmenti gialli** mappati e verificati; ognuno deve essere compilato oppure marcato **non applicabile** soltanto con decisione umana esplicita e tracciabile, senza campi lasciati irrisolti.
3. Tutti i **27 commenti** revisionati e le decisioni trasformate in condizioni documentali controllate.
4. **D1**: metodologia del rischio realmente approvata, con identificativo/versione della decisione aziendale, e tabelle rischio con righe mappate e validate.
5. Copia compilata e sottoposta a nuova verifica OOXML e **confronto visivo dopo l'inserimento dei dati**. Un confronto su documento vuoto non vale.
6. Identificazione delle firme nel vero modello, con verifica che siano rimaste vuote.
7. Review HSE collegata al fascicolo e alla revisione dell'analisi, senza blocchi aperti.

Se una qualsiasi condizione manca, lo stato è `blocked` con l'elenco motivato dei motivi (`TEMPLATE`, `YELLOW_FIELDS`, `EDITORIAL`, `RISK_METHOD`, `DOCX_QUALITY`, `HSE_REVIEW`).

Se tutti i controlli sono attestati, lo stato è **`eligible_for_final_technical_review`**, NON approvato o emesso: sia `duvri_approved` sia `issuance_allowed` restano sempre **false**.

## Collegamento alla fase D2 in Claude

I 22 segmenti gialli restano una decisione tecnica da mappare sul file Excel locale di revisione. Non introdurre mapping sulla base di un'etichetta indovinata. È accettabile predisporre un'interfaccia locale di revisione che mostri contesto, posizione nel DOCX e scelta del tecnico, ma il mapping finale va confermato.

I 27 commenti vanno valutati caso per caso: possono diventare condizioni, campi compilabili o istruzioni da eliminare dalla versione emessa, secondo la decisione Colligo. Non cancellarli indiscriminatamente dal modello originale.

Le tabelle dei rischi non vanno considerate compilate perché i campi gialli sono stati sostituiti: richiedono un mapping separato.

La verifica della firma **non deve presupporre una tabella con intestazione "Firma"**: il controllo deve operare sui reali elementi del modello.

## D1 resta vincolante

Il validatore del worker in PR #21 ha attualmente la scala 1–3, mentre altri materiali descrivono una matrice 3×3. Nessun automatismo deve scegliere una conversione. L'approvazione della metodologia deve essere esplicita, tracciabile e versionata.

## Privacy e deploy

Nessun dato reale o catalogo clienti viene inserito nel repository GitHub pubblico. Il codice è ad oggi isolato; nessuna autorizzazione a deploy né approvazione professionale è implicata da test verdi. Le future attestazioni dovranno avere identificatori opachi, referenze immutabili e audit server-side.
