# Colligo DUVRI AI — confronto citazioni degli agenti con fatti estratti (v1)

**Stato:** libreria deterministica e inattiva, senza provider AI, DB, OCR, accesso a documenti, Word o interfaccia. Non calcola rischi e non approva un DUVRI.

## Problema affrontato

I contratti HSE esistenti verificano che un agente citi un `file_id` incluso nell'insieme autorizzato, ma **un file autorizzato non dimostra che la frase attribuita al file sia realmente contenuta in esso**. Per esempio, un agente potrebbe inventare un dato e associare una pagina plausibile.

Il modulo `js/duvri-hse-fact-match.js` verifica che ogni citazione nei **finding** e nelle **contraddizioni** del pacchetto HSE corrisponda esattamente a un fatto estratto, confermato e recuperato dal backend privato: stesso tipo fonte, ID file, posizione, testo integrale e stato di verifica. Nessun fuzzy match o correzione automatica.

Lo storico può essere citato solo come `historical_example_only`: non può costituire la prova di un'interferenza corrente. Ogni finding deve possedere almeno una fonte corrente `confirmed`; ogni conflitto almeno due fonti correnti confermate. Le righe OCR non confermate restano bloccate. Anche un riferimento esatto non trasforma `awaiting_input`, conflitti o lacune HSE in analisi pronta.

## Integrazione Codex / Claude Code (backend privato)

1. Recuperare il fascicolo, la revisione analisi ed estrazione, il pacchetto HSE e le fonti ammesse **solo** da storage autenticato, controllando permessi dell'utente e cliente.
2. Recuperare i fatti estratti attuali dalle attestazioni di lettura locale PDF/DOCX/XLSX/OCR. I valori `sourceFacts[].text`, `locator`, `file_id`, `source_type`, `verification_status` sono dati grezzi da archiviare e verificare lato server: non accettarli dal browser o da un LLM.
3. Ricalcolare SHA-256 effettivi dei file/revisioni e confrontarli con il dossier immutabile. Il flag `backend_verified:true` **non è una firma**: deve essere impostato soltanto dopo controlli server indipendenti. Qui il modulo non legge file e non calcola hash.
4. Richiamare `verify({packet, sourceScope, sourceFacts, expectedJobId, expectedAnalysisRevisionId, expectedExtractionRevisionId, allowedHistoricalReferenceIds, allowedInternalRuleIds})`.
5. Se `blocked`, non trasmettere al revisore un pacchetto con citazioni non dimostrate. Se `awaiting_evidence`, `citations_need_confirmation` o `citations_matched_awaiting_hse_resolution`, mantenere aperti i blocchi e acquisire conferme/integrazioni. Solo `exact_citations_matched_for_review` significa che **quel controllo testuale** è superato: non autorizza la redazione, l'invio o l'approvazione.
6. Registrare lato backend l'esito associato a revisioni e hash canonici; nuova checklist, nuovo allegato, conferma OCR o nuova analisi invalidano l'esito precedente. Controlli CAS e ACL sono responsabilità del backend.
7. Non inserire testi reali, estratti riservati o dati personali in GitHub. Il report del modulo contiene solo conteggi e codici, non citazioni o testo del documento.

## Limiti

- Matching **esatto** su file, tipo, locator, testo e stato di verifica. L'OCR, la normalizzazione testuale o la ricostruzione delle tabelle possono modificare la rappresentazione: nessuna approssimazione silenziosa. È il backend che deve produrre una versione canonica e coerente del fatto estratto.
- Un testo perfettamente corrispondente **non prova** che la citazione sia pertinente alla valutazione tecnica proposta, che il documento sia vero o che un rischio sia presente. Servono ancora il coordinatore HSE e la revisione professionale.
- Non sostituisce `duvri-agent-contract.js`, `duvri-hse-evidence-scope.js`, `duvri-hse-review-session.js`, l'audit dei permessi o la verifica della validità delle autorizzazioni.
- Il motore è neutro rispetto al cliente Colligo; nessuna dipendenza da COIN o altri clienti. D1/D2, specialisti AI e Word ufficiale restano disattivati fino ad autorizzazioni.

## Test

`node --test tests/duvri-hse-fact-match.test.js`

26 test sintetici: frase o pagina inventata, altra commessa/file, revisione obsoleta, duplicati, dati estratti contraffatti, OCR non confermato, storico usato impropriamente, conflitti non risolti, mismatch di status, nessuna emissione e nessuna mutazione dei dati.
