# SafetyChecklist

PWA per sopralluoghi HSE con salvataggio locale IndexedDB, sessioni Firebase Auth, sincronizzazione Firestore e fotografie su Supabase Storage. JavaScript senza framework; librerie browser vendorizzate, senza build npm dell'app.

Checklist disponibili: Coin, Interparking, Restage, Melluso e Carrefour, definite in `checklists/index.json` e nei relativi JSON. Il flusso corrente consente risposte C/PC/NC/NA, note, fotografie, compilazione incompleta, storico, cestino e PDF. La firma grafica non è implementata.

Il collaudo del 9 ottobre 2026 parte da `main` al commit `aa67eec` e conserva il layout esistente. **Il rilascio rimane bloccato** per le verifiche fondamentali non completate: vedere [rapporto finale](reports/COLLAUDO_SAFETYCHECKLIST_V1_20261009.md).

## Documentazione

- [Accesso, ruoli e servizi](docs/ACCOUNTI_E_ACCESSO.md)
- [Esecuzione del collaudo isolato](docs/COLLAUDO_ISOLATO.md)
- [Specifiche originarie](PROJECT.md) e [roadmap originaria](TASKS.md): contengono anche requisiti mai implementati e non descrivono lo stato attuale del prodotto.

## Test

Richiede Node.js 22 aggiornato, Java 21, Google Chrome, Playwright e Firebase CLI. Gli strumenti di test non sono dipendenze runtime dell'app.

```sh
firebase emulators:exec --only auth,firestore --project demo-safety-qa-v1 --config firebase.qa.json "node tests/qa-v1-run.cjs"
```

La suite usa account, foto e sopralluoghi fittizi in un progetto demo locale. Non eseguire gli harness `release-live-browser.cjs` o `final-security-smoke.mjs` come sostituti del collaudo isolato: contattano servizi di produzione. L'app Ore Produttività è un progetto distinto ed è esclusa dalla suite.
