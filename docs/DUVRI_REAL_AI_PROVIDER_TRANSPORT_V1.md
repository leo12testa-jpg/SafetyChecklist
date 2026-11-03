# Colligo DUVRI AI — Trasporto per modelli AI reali

**Stato:** codice server-only con richiesta HTTP reale predisposta, NON connesso al worker privato e NON eseguito con un provider pagato. Nessun documento cliente, credenziale o servizio AI è stato attivato.

## Connessione

Il modulo `server/duvri-ai-real-provider-gateway.cjs` integra l'endpoint Vercel AI Gateway `https://ai-gateway.vercel.sh/v1/chat/completions`, usando il formato compatibile Chat Completions. Fonte: https://vercel.com/docs/ai-gateway/sdks-and-apis . Modelli, prezzi e accessi devono essere verificati sul catalogo corrente prima di scegliere un ID produttivo.

Il factory `createPrivateGateway` torna disabilitato per impostazione predefinita. Solo il backend privato può fornire i callback `loadAuthorizedRun`, `reserveBudget`, `settleBudget`, `recordAudit`, `getServerApiKey` e abilitare `enabled=true` dopo le autorizzazioni.

Il metodo `invoke` accetta soltanto jobId, agentId e revisioni di analisi, estrazione e run: nessun prompt, modello, URL, token o flag di approvazione viene accettato dal browser. L'identità, il modello esatto, le istruzioni statiche, la regione autorizzata, i testi minimizzati e le fonti devono essere ricavati dal backend.

## Gate prima del traffico

1. Verifica reale lato server dell'utente/ruolo, fascicolo, revisione, autorizzazione aziendale, trattamento dati/retention e regione del provider effettiva.
2. Riserva atomica di budget massimo per richiesta prima di ogni invio; divieto di retry automatici non contabilizzati.
3. Audit prima della richiesta; segreto `AI_GATEWAY_API_KEY` soltanto da storage segreti server-side. Mai nel browser, nella PR o nel testo dei log.
4. Richiesta con timeout 25 s, risposta JSON e validatore già esistente `duvri-agent-contract.js`. Qualsiasi risposta non conforme, fuori fascicolo o con risk_score non autorizzato viene rifiutata.
5. Contabilizzazione della richiesta e audit di chiusura. La risposta candidata resta a disposizione solo del backend, per confronto sostanziale delle citazioni e revisione HSE professionale.

Il trasporto NON prova da solo che il gateway elabori dati soltanto nella regione desiderata: un approvatore deve verificare condizioni concrete del fornitore/modello. È vietato assumere residenza UE in assenza di prova.

## Stato di sicurezza

Anche con JSON valido l'output è `candidate_for_private_source_verification`: **mai un'approvazione del DUVRI**. D1/D2, QA Word, verifica fonti e autorizzazioni di emissione restano separati. In caso di endpoint non abilitato, autorizzazioni mancanti o budget insufficiente NON parte alcun traffico.

## Handoff Codex

Controllare il worker privato prima di integrarlo: è in Deno/TypeScript, mentre questo trasporto è CJS Node testabile separatamente. Se non esiste un runtime Node privato, portare il contratto in Deno adattando i callback di ACL, riserva budget, secret store e audit. Evitare un secondo orchestratore. Confrontare PR #60 (supervisore) e #62 (preflight) senza usare codice delle PR non unite come se fosse già su main.

Prima di qualunque chiamata vera: Colligo deve scegliere provider/modello/regione, autorizzare privacy e budget, configurare credenziali e gateway privato, quindi consentire un unico smoke test con **soli dati sintetici**. Fino ad allora il worker deve restituire `HSE_ADAPTER_UNAVAILABLE`.

## Test

`node --test tests/duvri-ai-real-provider-gateway.test.js` — 19 test con provider HTTP finto: default-off, chiamata strutturata, privacy, autorizzazione aziendale, regione, riserva budget, audit, credenziali, errori HTTP, JSON, schema e validazione delle fonti. Test HTTP simulato non equivale alla prova con un modello AI vero.