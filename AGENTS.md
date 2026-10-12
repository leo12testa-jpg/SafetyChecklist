# AGENTS.md – Safety Checklist

Guida per gli agenti di codice (Codex, Claude Code) che lavorano su questo repository.

## Progetto
PWA per sopralluoghi di sicurezza di Colligo Ingegneria, su GitHub Pages:
https://leo12testa-jpg.github.io/SafetyChecklist/ (branch `main`).
JavaScript vanilla, nessun framework né bundler. Offline con IndexedDB e service worker.
Riferimenti: `PROJECT.md` (specifica; §5 e §5.1 formato checklist), `TASKS.md` (fasi).

## Struttura
- `index.html` – tutte le schermate (`section.screen`, attributo `data-screen`)
- `css/style.css` – stili mobile-first
- `js/app.js` – navigazione, compilazione, riepilogo, storico, esportazione DVR
- `js/checklist.js`, `js/db.js`, `js/sync.js`, `js/foto-sync.js`, `js/pdf.js`
- `checklists/` – checklist JSON, `index.json` (con `categoria` audit/dvr), `clients.json`, `tecnici.json`
- `service-worker.js` – precarica le checklist elencate in `checklists/index.json`
- `ore-produttivita/` – **altra app: non toccare**

## Due modalità
- **Sopralluogo (audit)**: checklist C/PC/NC/NA dei clienti (Coin, Interparking, Restage, Melluso,
  Carrefour). Non modificarne checklist, layout PDF o comportamento senza richiesta esplicita.
- **Raccolta dati DVR**: checklist `dvr_*` con `"stile": "raccolta-dati"` (vedi PROJECT.md §5.1).
  La categoria si ricava dall'id (`checklistIsDvr`); nessun campo nuovo nei dati salvati.

## Regole
- Nessuna migrazione distruttiva: i sopralluoghi esistenti devono continuare ad aprirsi.
- Nelle checklist DVR: id e `codice` univoci, testo che inizia con `[codice] `, nessun ":" nel testo.
  A ogni modifica aumentare `versione` nel JSON e in `checklists/index.json`.
- Non aggiornare a mano `?v=`, `CACHE_NAME` o `version.json`: lo fa `./pubblica.sh` (test → commit →
  push → verifica GitHub Pages).
- Testi dell'interfaccia in italiano.

## Verifica
- `node --test tests/*.test.js` deve passare tutto.
- Su viewport 390 px: un sopralluogo audit esistente si apre e genera il PDF come prima; una raccolta
  DVR si avvia, si compila, arriva al Riepilogo DVR ed esporta lo ZIP.
