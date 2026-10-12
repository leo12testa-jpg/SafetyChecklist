# Collaudo isolato SafetyChecklist

Il progetto di test è esclusivamente `demo-safety-qa-v1`. `firebase.qa.json` espone Auth su `127.0.0.1:19099` e Firestore su `127.0.0.1:18085`. Non usare gli harness con un progetto produttivo né eseguirli contemporaneamente nello stesso namespace demo.

## Esecuzione

Prerequisiti: Node.js 22 aggiornato, Java 21, Google Chrome, Firebase CLI e Playwright. Versioni CI: `playwright@1.55.0`, `firebase-tools@15.31.0`. Il loader può riutilizzare Playwright dal cache npm di Windows; altrimenti installare gli strumenti nel solo ambiente di test.

```sh
firebase emulators:exec --only auth,firestore --project demo-safety-qa-v1 --config firebase.qa.json "node tests/qa-v1-run.cjs"
```

La suite esclude `tests/ore-*` e non modifica Ore Produttività. Esegue sintassi/manifest, tutte le regressioni SafetyChecklist, PDF, browser e PWA. Nel browser sono consentiti solo il server HTTP locale e gli emulatori; le richieste esterne sono bloccate. Gli account usano nomi `qa.*`, fotografie create con canvas e sopralluoghi fittizi.

## Artefatti

`reports/qa-v1/summary.json` contiene conteggi e limiti. `unit-final.tap`, `browser/results.json`, `pdf/results.json` e `pwa/results.json` conservano i singoli test. Le 41 pagine PDF sintetiche sono renderizzate come PNG; i cinque contact sheet mostrano tutti i documenti. Sono artefatti conservati per revisione, non dati nel database aziendale.

```sh
node tests/qa-visual-contact.cjs
```

## Pulizia

Ogni harness chiude i contesti browser e elimina i documenti/account creati nel namespace demo. I profili temporanei vengono rimossi dopo aver verificato il percorso nella cartella artefatti dedicata. Il mock Storage vive soltanto in memoria e viene svuotato.

`node tests/qa-cleanup-audit.cjs` verifica che `sopralluoghi`, `attivita`, `utilizzo_app`, `utenti`, gli account Auth demo e i profili temporanei siano vuoti. L'audit non cancella nulla. Un errore di pulizia fa fallire la suite.

## Gate di rilascio

Exit code zero certifica gli scenari automatizzati, **non** autorizza il rilascio. La valutazione rimane `NON PRONTA` quando una verifica fondamentale richiesta, come firma o autorizzazione Storage, è incompleta. La PR resta in bozza; nessun merge, deploy di regole/funzione o pubblicazione frontend prima di risolvere questi punti.
