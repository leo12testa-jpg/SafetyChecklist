# DUVRI — SHA-256 sui byte effettivi: modulo isolato e non autorizzativo

## Ambito e motivazione

`js/duvri-case-manifest.js` controlla la struttura dei metadati, ma non legge i file del fascicolo. Questo è intenzionale: un hash passato dal browser non è prova sufficiente del contenuto conservato nel backend privato.

`js/duvri-source-bytes.js` aggiunge un secondo controllo distinto, che riceve da un chiamante affidabile il manifest e i byte recuperati dal backend e ricalcola SHA-256 per ciascun file. Rifiuta file assenti, ID duplicati, dimensioni incongruenti, impronte non corrispondenti, firme magiche incompatibili, input errati e insiemi con file extra.

Non modifica l'interfaccia Checklist, non carica file, non chiama AI, non legge documenti privati da solo, non scrive su Storage e non autorizza alcun DUVRI.

## Integrazione richiesta al backend privato (NON ancora implementata)

1. Autenticare il tecnico e applicare ACL/RLS sul fascicolo e sui file.
2. Leggere il manifest canonico e i **byte realmente conservati** nello Storage privato; non usare byte/hash passati dal browser.
3. Verificare l'associazione ID fascicolo ↔ revisione ↔ singolo file.
4. Passare file e byte al modulo con il validatore metadati affidabile e WebCrypto SHA-256.
5. Legare l'esito alla revisione in modo transazionale, usando parser DOCX/PDF/immagini separati.

API di esempio (soltanto in backend autenticato):

```js
const outcome = await duvriSourceBytes.assessBytes(
  {jobId, documents: canonicalRecords, inputs: trustedStoredBytes},
  {manifestValidator: duvriCaseManifest.assessManifest, cryptoProvider: crypto}
);
```

Ogni input ammette esclusivamente `file_id` e `bytes: Uint8Array | ArrayBuffer`. Limite per file: 64 MiB, totale: 256 MiB, massimo 200 documenti. Fascicoli maggiori richiedono una futura implementazione streaming con limiti adeguati, non la rimozione dei controlli.

## Limiti espliciti

- `bytes_matched_manifest=true` dimostra solo la corrispondenza fra i byte forniti e gli hash dichiarati. Se un attaccante controlla entrambi, può modificarli. Per questo il modulo restituisce sempre `source_authenticated=false` e `private_storage_verified=false`.
- Per DOCX e XLSX il controllo magico riconosce solo ZIP, **non** verifica Office OpenXML, relazioni o contenuti. `format_structure_verified=false` resta obbligatorio fino al parsing indipendente.
- I formati senza firma magica affidabile (RTF, DOC legacy, HEIC) richiedono revisione/parsing separato.
- `issuance_allowed=false` sempre. Restano obbligatorie evidenze, interferenze, HSE, D1/D2, verifica visiva Word e approvazione umana.
- Non esiste ancora integrazione produttiva del modulo nel backend privato. I test sono sintetici e offline.

## Test

```bash
node --test tests/duvri-source-bytes.test.js
```

La suite completa `tests/*.test.js` è eseguita in CI nelle PR confrontate con `main`; la PR resta in bozza, con base di sviluppo sulla PR sintetica #69.

## Flusso applicativo previsto per Colligo

Il Generatore DUVRI deve mantenere **due caricamenti distinti**: il primo riceve una sola checklist cliente compilata in Word DOCX; il secondo riceve tutti gli allegati dello stesso fascicolo (PDF, fotografie, planimetrie, XLSX e documenti di supporto). Nessuno dei due ingressi deve leggere implicitamente il database della PWA Checklist/Sopralluoghi.

Il backend privato deve ricalcolare il digest dei byte realmente conservati, salvarlo con revisione del fascicolo e locator di provenienza, quindi rifiutare allegati di altre commesse prima dell'estrazione e dell'analisi AI. Le lacune e contraddizioni devono rimanere aperte per il tecnico; il Word usa il master approvato e resta NON EMETTIBILE fino ai gate umani.

Lo stato di questa PR è soltanto **componente verificatore pronto da integrare**, non flusso applicativo già funzionante nel backend privato.
