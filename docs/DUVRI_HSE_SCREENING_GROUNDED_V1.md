# COLLIGO DUVRI AI — Screening specialisti con evidenze

**Stato:** modulo isolato su PR #28; non collegato al worker e non abilitato in produzione.

## Problema risolto

La selezione degli specialisti non deve considerare **"no"** un rischio assente se il dato è stato soltanto estratto automaticamente da un PDF o dalla checklist Word senza conferma. L'agente va attivato soltanto secondo criteri documentati e lo screening incompleto rimane da chiarire.

## Componenti

- `js/duvri-hse-screening.js`
- `tests/duvri-hse-screening.test.js` (16 test sintetici)

`normalizeSpecialtyScreening` riceve:
- `jobId`: identificatore del fascicolo, ricavato dal backend;
- `answers`: risposte strutturate per categoria (`yes` / `no` / `unknown`) con eventuali fonti;
- `allowedFileIds`: identificatori dei file del fascicolo ammessi, determinati **esclusivamente dal backend** tramite autorizzazioni reali.

## Regole

| Risposta | Fonte | Risultato di routing | Stato |
| --- | --- | --- | --- |
| `yes` | Documento confermato | `yes`: specialista attivato | Può avanzare se tutte le altre domande sono risolte |
| `yes` | Estratta, non confermata | `yes`: specialista attivato comunque | Conferma richiesta |
| `no` | Documento confermato | `no`: specialista non attivato automaticamente | Non equivale a prova assoluta di assenza |
| `no` | Estratta, non confermata | `unknown`: non escludere lo specialista in silenzio | Conferma richiesta |
| `unknown` | Nessuna fonte | `unknown` | Screening richiesto |
| Risposta mancante | Nessuna fonte | `unknown` | Screening richiesto |
| Qualsiasi sì/no | Nessuna fonte | `blocked` | Errore di provenienza |
| Qualsiasi risposta | File di un altro fascicolo o precedente storico 2026 | `blocked` | Fonte non autorizzata per lo screening attuale |

**Nota tecnica:** un riferimento storico Colligo 2026 non può dichiarare assente o presente un rischio nel nuovo intervento. Lo storico serve solo come precedente consultabile.

Il modulo restituisce solo segnali e conteggi (non contiene estratti, nomi clienti o identificativi dei file nelle osservazioni). Non valuta rischi, conformità o applicabilità del DUVRI.

## Uso da parte del coordinatore

Un futuro backend dovrebbe:
1. leggere e autorizzare i file correnti del fascicolo;
2. normalizzare le risposte con `normalizeSpecialtyScreening`;
3. **bloccare l'avanzamento** se `state` è `blocked` o `needs_confirmation`, salvo passaggio esplicito a raccolta delle informazioni;
4. usare `signals` soltanto quando le risposte sono state verificate e salvate;
5. inoltrare i segnali a `routeSpecialists` e conservare anche le fonti originali nella scheda privata.

Non trasformare `no` in una valutazione tecnica automatica di assenza di interferenza. Anche in stato `ready`, il coordinatore, la verifica normativa e il revisore competente restano obbligatori.

## Test isolati

```bash
node --test tests/duvri-hse-screening.test.js
```

Il modello generale DUVRI è ancora in fase di collaudo locale presso Claude Code; non sono stati importati file aziendali e non sono avviate API AI a pagamento.
