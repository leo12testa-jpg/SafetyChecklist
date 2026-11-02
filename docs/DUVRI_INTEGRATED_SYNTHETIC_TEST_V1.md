# Colligo DUVRI AI — collaudo integrato dei contratti HSE sintetici

**Stato:** test di integrazione del codice pubblico isolato. **Non** è un collaudo del backend privato, un collegamento a un provider AI, una produzione di Word, una valutazione professionale dei rischi o un'autorizzazione DUVRI.

Il file `tests/duvri-integrated-synthetic-gates.test.js` compone **gli stessi moduli reali già in `main`**, anziché imitare i risultati con un unico test che restituisce sempre successo.

## Flusso verificato

```text
Manifest DOCX+PDF sintetici
 -> attestazioni estrazione sintetiche, con SHA/revisioni
 -> scope HSE delle fonti
 -> risposte screening documentate (lavori in quota)
 -> pacchetto coordinato di specialisti (simulati: nessuna AI)
 -> verifica testuale esatta contro fatti dell'estrazione
 -> registro chiarimenti
 -> instradamento al tecnico (mai invio al cliente)
 -> revisione HSE collegata a packet/revisioni
 -> gate Word QA senza rapporto ufficiale: BLOCCATO
 -> preflight provider senza autorizzazione: BLOCCATO
```

Gli agenti sono **semplici fixture dati sintetiche**, non vengono eseguiti modelli o prompt. Il digest fittizio per pacchetto, il flag `backend_verified:true` e il contesto revisore servono **solo** a provare il contratto: non rappresentano hash o autorizzazioni server reali.

## Casi di accettazione

1. Fascicolo completo: può giungere a `draft_findings_reviewed` con citazioni coerenti, ma `issuance_allowed=false`, Word e AI restano bloccati.
2. Screening elettrico incerto: produce richieste interne di chiarimento; l'instradamento non invia email, non risolve la domanda e non supera il gate HSE.
3. Allegato PDF sostituito: l'attestazione dell'estrattore precedente diventa invalida; il sistema nega lo scope HSE e l'analisi.
4. Testo di una citazione inventato: il matching con il fatto estratto rifiuta il finding.
5. OCR o fonte non confermata: non può diventare una citazione confermata soltanto attraverso il pacchetto specialista.
6. Digest/revisione del pacchetto cambiati: le decisioni del tecnico precedenti vengono bloccate.
7. Assenza di autorizzazione provider/consenso: un fascicolo revisionato non permette trasferimenti o chiamate AI.

## Da fare prima del collaudo del backend privato

Codex/Claude Code deve eseguire la matrice `docs/DUVRI_COLLAUDO_END_TO_END_GATE_V1.md` nel workspace locale privato. Per dichiarare un test end-to-end reale servono anche:

- upload effettivo di DOCX/PDF/XLSX/JPEG/PNG attraverso il backend locale autenticato;
- storage privato/RLS, hash ricalcolati dai byte, revisioni e audit Postgres;
- OCR e conferme umane su ogni riga richiesta;
- adapter HSE **reali autorizzati** oppure gate `HSE_ADAPTER_UNAVAILABLE` esplicito; non chiamare lo screening a parole chiave “agente AI”;
- confronti delle citazioni con gli estratti reali della commessa;
- convalida del master Word Colligo privato con 22 segmenti e 27 commenti, QA dopo popolamento;
- blocchi D1/D2 e autorizzazione professionale, senza generazione/emissione automatica;
- verifica compatibilità OCR/Worker sul runtime finale prima di ogni deploy.

## Esecuzione

```bash
node --test tests/duvri-integrated-synthetic-gates.test.js
node --test tests/*.test.js
```

Le regressioni browser audit e raccolta DVR sono **fuori** dal perimetro di questo test e devono restare coperte dai workflow preesistenti.

**Riservatezza:** solo fixture sintetiche in questo repository pubblico. Nessuna checklist reale, modello Word, fotografie, documenti aziendali, credenziali o log cliente.
