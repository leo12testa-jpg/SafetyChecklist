# Colligo DUVRI — gate di messa in prova backend (solo dati sintetici)

**Stato:** prerequisiti tecnici da completare prima di qualsiasi deploy.

## Ambienti

- SafetyChecklist usa già un progetto Supabase produttivo per altre funzioni: non installare qui il backend DUVRI in bozza.
- Utilizzare un ambiente Supabase separato (progetto o branch di sviluppo); crearlo solo dopo aver verificato costi e autorizzazione, perché un branch può avere tariffazione oraria.
- La migrazione SQL attuale è un *draft*: in uno staging nuovo inizializza `document_type_configs.duvri.enabled=false`. Non cambiare la configurazione per superare i test.
- Nessuna checklist cliente, PDF cliente, logo o versione reale dei documenti deve finire nei test pubblici, log GitHub, issue o artefatti CI.

## Checkpoint applicativi, in sequenza

1. **Database e bucket**: RLS attiva su tutte le tabelle documentali, privilegi `anon`/`authenticated` negati, bucket privato, accesso solo tramite gateway autenticato. Verifica degli advisor di sicurezza.
2. **Gateway**: esigere ID token Firebase valido e ruolo autorizzato. Upload checklist `.docx` + allegati, controllo tipo *per magic bytes*, limiti dimensione, isolamento per utente, hash e cleanup errori. Il flag server `DOCUMENT_PIPELINE_ENABLED` rimane spento.
3. **Worker**: segreto server-only, nessuna chiamata a provider AI senza configurazione e consenso esplicito; audit, limiti di costo, timeout, idempotenza, no prompt injection.
4. **Compilatore Word**: modello ufficiale approvato e fissato per SHA, nessuna alterazione sezioni/layout, nessuna firma automatica, QA indipendente, output solo `BOZZA NON EMETTIBILE`.
5. **Analisi HSE**: ogni fatto referenziato alla fonte; non inventare valori di rischio. Differenza tra matrice 1–9 e indice 1–3 da risolvere formalmente prima dei punteggi.
6. **Tre fascicoli interamente sintetici**: prove in quota/elettriche, refrigerazione e vasca/spazio confinato. Verificare flusso 2 upload -> analisi -> Word -> PDF Word Desktop -> QA/risultati HSE. Fallimenti e lacune devono bloccare emissione.
7. **Attivazione limitata**: abilitare gateway e worker solo ad account tecnici individuati, con modalità non-emettibile e revisione obbligatoria. La UI di produzione resta con `DOCUMENT_GENERATION_CLOUD_ENABLED=false` fino al superamento dei gate precedenti.

## Criterio di promozione

Passare da codice staging a deploy reale soltanto quando CI, privacy, abilitazioni, Word Desktop e revisione HSE hanno evidenze verificabili. **Non utilizzare un ambiente operativo con clienti per i test di integrazione.**

