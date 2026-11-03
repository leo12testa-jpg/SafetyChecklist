# Colligo DUVRI AI — Scheda decisioni D1/D2 e autorizzazione del pilota

**Modello vuoto di coordinamento — nessuna approvazione è stata concessa.** Non compilare qui informazioni di clienti, commenti riservati del master, nomi dei dipendenti, hash di documenti aziendali, firme o screenshot. Le delibere effettive e gli allegati restano esclusivamente nel workspace documentale privato Colligo e sono referenziati mediante ID opachi.

## Stato e finalità

- **A — pilota tecnico sintetico:** raggiunto *localmente secondo il rapporto Codex del 3 novembre 2026*. Non è una verifica indipendente di ChatGPT dei commit Windows.
- **B — pilota con dati reali autorizzati:** non approvato; richiede sicurezza e privacy, accesso riservato e test staging.
- **C — sistema operativo con AI ed emissione controllata:** non approvato; richiede inoltre D1, D2, provider e rilascio.
- La bozza sintetica locale è di **30 pagine**, etichettata `BOZZA SINTETICA – NON EMETTIBILE – NON APPROVATA`, con manifest del rendering validato. **Manca la revisione visiva umana di tutte le pagine**; la verifica automatica/OCR di alcune pagine non è equivalente.
- La compilazione riferita usa **fixture dimostrative** e **0 fatti reali di una commessa**: A non autorizza l'uso sul cliente.

La presente scheda è pensata per preparare decisioni alla Direzione/Responsabile tecnico HSE Colligo, non per sostituirne la competenza.

---

## D1 — metodologia rischi interferenziali (decisione professionale)

**Proprietario della decisione:** [ruolo tecnico autorizzato Colligo, nel documento interno]

**Stato iniziale:** `DA_APPROVARE`

| ID | Decisione necessaria | Alternative da valutare | Evidenza e accettazione richieste |
|---|---|---|---|
| D1.01 | Scala di valutazione ufficiale | Matrice 1–9 / I.R. 1–3 / altro metodo aziendale | Regola approvata, versione, campo d'applicazione |
| D1.02 | Definizione dei fattori e dei livelli | Probabilità, gravità, esposizione o altre variabili | Definizioni tecniche, criteri univoci e motivati |
| D1.03 | Metodo applicabile a ciascuna interferenza | Interferenze tra committente, imprese, utenti, lavorazioni contemporanee | Confini del DUVRI e casi fuori campo documentati |
| D1.04 | Conversione fra scale | Vietata / autorizzata con tabella approvata / non applicabile | Approvazione esplicita: **non presumere equivalenza** |
| D1.05 | Misure di coordinamento, rischio residuo e incertezza | Procedura aziendale da approvare | Chi propone, verifica e approva ogni misura; gestione dati mancanti |
| D1.06 | Casi con dati insufficienti o contraddittori | Blocco + richiesta chiarimento | Nessun punteggio fittizio, nessuna approvazione automatica |
| D1.07 | Riesame dopo modifiche a documenti/fatti | Invalidazione delle analisi dipendenti | Revisione/hash verificati, audit e nuova validazione HSE |

**Criterio di chiusura D1:** il titolare tecnico approva nel sistema privato un metodo identificato, versionato, applicabile a un insieme di esempi sintetici (anche casi limite), con tracciabilità di revisore, data e motivazioni. In assenza di questa evidenza: `D1_NOT_APPROVED`; nessun algoritmo di scoring attivo.

---

## D2 — master DOCX, mapping e regole editoriali (decisione professionale)

**Proprietario della decisione:** [ruolo responsabile del modello Word Colligo, nel documento interno]

**Stato iniziale:** `DA_APPROVARE`

| ID | Decisione necessaria | Evidenza privata e criteri |
|---|---|---|
| D2.01 | Master ufficiale e versione | SHA-256 dei byte del master, riferimento e approvazione archiviati internamente |
| D2.02 | Catalogo campi/segmenti logici | Mappa `ID_campo → parte OOXML → sorgente consentita → regola inserimento`; ogni elemento senza decisione rimane bloccato |
| D2.03 | Differenza nei conteggi | Separare **31 campi** menzionati nel rapporto locale dai **22 segmenti con testo** e dai **27 commenti**: sono grandezze diverse finché non esiste una riconciliazione 1:1 verificata |
| D2.04 | Commenti editoriali | Per ciascuno dei **27** commenti: `MANTIENI` / `MODIFICA` / `ELIMINA` / `DA DISCUTERE`, sempre con motivazione e approvazione umana |
| D2.05 | 12 questioni editoriali residue della bozza | **5** highlight di sola formattazione; **7** commenti: 4 `MANTIENI` e 3 `DA DISCUTERE` erano *proposte*, non decisioni approvate |
| D2.06 | Elementi di sola formattazione | Definire se e quando i segni di paragrafo vuoti/evidenziati sono ammessi; non cancellarli automaticamente |
| D2.07 | Marcatura della bozza | Posizione, colore, testo e frequenza di `BOZZA SINTETICA – NON EMETTIBILE – NON APPROVATA`, senza alterare il master o coprire contenuti |
| D2.08 | Controllo contenuti + struttura | Stili, tabelle, sezioni, intestazioni, immagini, numerazioni, firme e inserti; distinguere integrità XML da qualità documentale |
| D2.09 | Rendering e QA visuale | Tutte le pagine della **stessa revisione** DOCX, pagine Word/PDF concordi, manifest/hash PNG integri, esame indipendente e registrazione pagina per pagina |
| D2.10 | Gestione documenti non emettibili | Errori di origine, OCR, citazioni, D1/D2, firma e revisione bloccano emissione; non nascondere blocchi dal tecnico |

**Criterio di chiusura D2:** SHA/versione del master approvati, mappa completa e senza ambiguità, decisioni editoriali documentate, verifica indipendente del DOCX compilato e **QA visuale umano completo** sulla versione finale. **Nessuna approvazione può essere dedotta da un test che conta elementi XML.**

### Registro visuale riservato — struttura da creare privatamente

Per ogni pagina del documento generato, registrare nel sistema privato:
`draft_revision`, `render_run_id`, `page_number`, `page_image_sha256`, `reviewer_id`, `reviewed_at`, `legible`, `header_footer_ok`, `tables_ok`, `overflows_found`, `label_visible`, `comments_or_highlights_reviewed`, `notes`, `review_decision`.

Le **30 pagine** del test locale sono tutte `PENDING_HUMAN_REVIEW` finché un revisore non registra il controllo reale. Dopo ogni modifica alla bozza i controlli pertinenti vanno ripetuti su una nuova revisione; non riutilizzare attestati di una bozza diversa.

---

## Abilitazioni distinte A / B / C

| Gate | Stato iniziale | Chiusura verificabile |
|---|---|---|
| A — test sintetici locali | `REPORTED_REACHED_LOCALLY` | Test riproducibili su commit esatto, ambiente isolato, output marcato non emettibile e limiti dichiarati |
| B.1 — autorizzazioni aziendali per dati reali | `BLOCKED` | Finalità, ruoli, clienti e perimetro d'uso approvati |
| B.2 — privacy, retention e fornitori | `BLOCKED` | Documentazione, accessi e obblighi contrattuali confermati |
| B.3 — staging Supabase/Storage | `BLOCKED` | Progetto separato autorizzato, migrazioni, RLS/ACL, test di isolamento/concorrenza/backup con **soli dati sintetici** |
| B.4 — QA Word e revisione tecnica del pilota | `BLOCKED` | Bozza non emettibile, revisione umana, controllo delle fonti e documentazione approvata |
| C.1 — approvazione D1/D2 | `BLOCKED` | Evidenza delle due approvazioni professionali nel repository/documentale **privato** |
| C.2 — gateway e specialisti AI reali | `BLOCKED` | Provider/regione/privacy/costi approvati, test su output, fonti e prompt injection |
| C.3 — release, dispositivi e piano di rollback | `BLOCKED` | Test browser/mobile/iOS Safari, verifica Edge/runtime, autorizzazione deploy e monitoraggio |
| C.4 — emissione ufficiale | `BLOCKED` | Procedura formale approvata, responsabilità e firme previste, revisione finale del documento |

**Regola assoluta:** gli stati dei gate qui elencati sono solo un **modello di preparazione decisionale**. L'applicazione non può considerare la tabella un'autorizzazione. Tutte le operazioni di emissione devono continuare a rispondere `issuance_allowed=false` finché il backend privato non verifica ogni approvazione effettiva, secondo il workflow professionale Colligo.

## Evidenze e responsabilità

Per ogni decisione da approvare registrare **soltanto nel sistema interno**:

- ID decisione, revisione e classificazione del documento;
- opzione selezionata e motivazione tecnica;
- titolare autorizzato e data di firma/approvazione;
- riferimenti interni agli allegati, hash e versioni;
- effetto sul motore, sui test e sulle bozze;
- esito QA indipendente prima dell'abilitazione del gate.

**Non compilare questa scheda pubblica con dati cliente, commenti del modello o firme.**

---

## Azioni tecniche immediate per Codex

1. Recuperare i commit locali `71728ef` → `46e501f`, senza push o reset, verificarne le differenze e leggere le consegne private A–G.
2. Trasformare questo schema in **due moduli di approvazione realmente compilabili nel sistema privato**, non in flag client-side. Non attivare D1/D2 finché mancano decisioni.
3. Predisporre il QA umano delle 30 pagine, con revisore diverso dal generatore, feedback e invalidazione delle revisioni se il DOCX cambia.
4. Mantenere separati gli specialisti sintetici dal provider reale e `HSE_ADAPTER_UNAVAILABLE`.
5. Preparare staging isolato e hardening prima del pilota B; non usare dati reali né creare risorse cloud senza autorizzazione.

Questa è una checklist di coordinamento, **non un documento tecnico HSE approvato**, né un contratto di riservatezza o una delega di emissione.
