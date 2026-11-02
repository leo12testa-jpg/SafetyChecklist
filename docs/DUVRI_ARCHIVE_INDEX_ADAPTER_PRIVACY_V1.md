# COLLIGO DUVRI AI — Adattatore privacy per il catalogo storico locale

**Stato:** isolato nel ramo della PR #28, non collegato al filesystem aziendale. La pubblicazione ridotta della ricerca storica è gestita separatamente nella PR #29.

## Problema

Claude Code ha prodotto localmente un catalogo DUVRI 2026 versione 2, ma i nomi reali delle colonne e le convenzioni non sono ancora disponibili qui. Non possiamo supporre lo schema del CSV né caricare su GitHub informazioni aziendali riservate.

## Modulo proposto

`js/duvri-archive-index-adapter.js` permette a un servizio **privato e autorizzato** di trasformare righe già classificate in un indice composto esclusivamente da:

- `archive_id` (identificatore opaco);
- `year` e `year_status` (anno 2026 confermato);
- `document_status` (bozza, revisione, finale, sconosciuto);
- `activity_tags` e `interference_tags` (vocabolario controllato).

Il modulo richiede un mapping `columns` che selezioni esplicitamente sei colonne, senza indovinarne i nomi. Richiede inoltre un `approvedManifest` con `archive_scope='duvri_2026_local_only'`, `approved=true`, revisione e conteggio delle righe verificate. Il manifest deve essere prodotto e controllato dal backend autorizzato, non da un browser o dall'AI.

**Non copiare la struttura del catalogo reale in GitHub:** il codice usa intestazioni sintetiche nei test. Il mapping concreto dovrà essere compilato da Claude in locale e revisionato, usando il CSV/XLSX effettivo.

## Garanzie e limiti

1. Tutti i metadati diversi dai sei campi sono scartati prima di creare l'output, compresi cliente, sede, percorso, testo, email e hash degli originali.
2. I documenti non confermati come 2026 vengono esclusi; una riga malformata blocca l'operazione invece di produrre un indice parziale potenzialmente inesatto.
3. Le classificazioni HSE devono essere controllate: il modulo non determina da solo i rischi interferenziali e non permette tag arbitrari.
4. L'indice normalizzato passa al motore `findHistoricalReferences`; non viene mandato a servizi esterni.
5. L'indicizzazione non conferisce permessi di lettura degli originali: l'eventuale risoluzione di `archive_id` in un DOCX/PDF deve avvenire soltanto in storage privato con ACL.
6. Questo è un filtro di contenuti e schema, non una garanzia che dati riservati non siano stati impropriamente inseriti dentro un ID opaco o un tag approvato. Gli ID devono provenire da generazione controllata lato backend.

## Test

`tests/duvri-archive-index-adapter.test.js`: 15 casi, tutti con dati sintetici. Coprono filtro privacy, esclusione dei dubbi, errori di schema, obbligo di mapping esplicito, manifest approvato, duplicati e compatibilità con il retrieval.

```bash
node --test tests/duvri-archive-index-adapter.test.js
```

Non introdurre questo adattatore nella produzione prima che Claude Code confermi le intestazioni reali del catalogo v2 e che Colligo autorizzi l'utilizzo delle informazioni archiviate.
