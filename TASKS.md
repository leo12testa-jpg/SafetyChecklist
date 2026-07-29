# 📋 TASKS.md — Roadmap Safety Checklist v1.0

Riferimento obbligatorio: `PROJECT.md`. Ogni fase produce codice funzionante e testabile prima di passare alla successiva.

---

## Fase 0 — Setup progetto

- [ ] Creare struttura cartelle come da `PROJECT.md` §4
- [ ] `index.html` minimo con collegamento a `css/style.css` e agli script in `js/`
- [ ] `manifest.json` base (nome, icone placeholder, `display: standalone`)
- [ ] `service-worker.js` che cachea l'App Shell

**Prompt per Claude Code:**
> Leggi PROJECT.md. Crea lo scheletro base del progetto: index.html, manifest.json e service-worker.js che cachea gli asset statici (App Shell). Segui esattamente la struttura cartelle definita in PROJECT.md §4. Non implementare ancora la logica applicativa, solo l'ossatura installabile come PWA.

---

## Fase 1 — Home e navigazione

- [ ] Schermata Home con 3 bottoni (Nuovo sopralluogo / Storico / Impostazioni)
- [ ] Router semplice in `app.js` (mostra/nasconde "schermate" senza reload di pagina)
- [ ] Stile mobile-first in `style.css`

**Prompt per Claude Code:**
> Implementa in app.js un router minimale a singola pagina (mostra/nasconde sezioni via show/hide, niente framework). Crea la schermata Home come da PROJECT.md §7.1, con i tre bottoni che per ora portano a schermate vuote/segnaposto per Nuovo sopralluogo, Storico, Impostazioni.

---

## Fase 2 — IndexedDB (`db.js`)

- [ ] Apertura/creazione DB `SafetyChecklistDB` con gli object store definiti in PROJECT.md §6
- [ ] Funzioni CRUD: crea sopralluogo, aggiorna risposta, salva foto (blob), leggi sopralluogo, elenca sopralluoghi, salva/leggi impostazioni
- [ ] Gestione versioning DB (onupgradeneeded)

**Prompt per Claude Code:**
> Implementa db.js come wrapper Promise-based su IndexedDB, con gli object store descritti in PROJECT.md §6 (sopralluoghi, foto, checklists_cache, impostazioni). Esporta funzioni chiare per: creare un sopralluogo, salvare/aggiornare una risposta a una domanda, salvare una foto (blob) collegata a un sopralluogo/domanda, leggere un sopralluogo completo con le sue foto, elencare tutti i sopralluoghi ordinati per data, salvare/leggere le impostazioni.

---

## Fase 3 — Motore checklist (`checklist.js`)

- [ ] Caricamento di un file JSON da `checklists/` (fetch + cache in `checklists_cache`)
- [ ] Calcolo totale domande (per "Domanda X di Y")
- [ ] Navigazione domanda per domanda (avanti/indietro) mantenendo lo stato
- [ ] Validazione: risposta obbligatoria prima di "Avanti"
- [ ] Trigger automatico del sotto-form NC quando la risposta è "NC"

**Prompt per Claude Code:**
> Implementa checklist.js: carica un file JSON checklist (schema in PROJECT.md §5), tenendone una copia in checklists_cache per l'uso offline. Gestisci la navigazione una-domanda-alla-volta (avanti/indietro) salvando ogni risposta su db.js in tempo reale. Quando la risposta è "NC" mostra automaticamente il sotto-form (Descrizione, Priorità, Foto, Scadenza) come da PROJECT.md §7.4, obbligatorio per Descrizione e Priorità.

---

## Fase 4 — Schermata "Nuovo sopralluogo" e Compilazione (UI)

- [ ] Form Cliente/Sede/Tecnico/Checklist con dropdown+testo libero (PROJECT.md §7.2)
- [ ] Schermata di compilazione con barra progresso, domanda, 4 opzioni C/PC/NC/NA, pulsanti Note/Foto (PROJECT.md §7.3)
- [ ] Collegamento UI ↔ checklist.js ↔ db.js

**Prompt per Claude Code:**
> Implementa l'interfaccia di "Nuovo sopralluogo" (PROJECT.md §7.2) che crea un nuovo record in db.js e passa alla schermata di Compilazione (PROJECT.md §7.3), collegata al motore in checklist.js. Mostra progresso "Domanda X di Y", titolo sezione, le 4 opzioni radio C/PC/NC/NA, e i pulsanti Note/Foto visibili solo se abilitati nel JSON della domanda corrente.

---

## Fase 5 — Foto (`camera.js`)

- [ ] Acquisizione foto da fotocamera o galleria (`<input type="file" accept="image/*" capture>`)
- [ ] Compressione lato client (resize + qualità JPEG) prima di salvare su IndexedDB
- [ ] Collegamento a domande normali e a NC

**Prompt per Claude Code:**
> Implementa camera.js: cattura/selezione foto tramite input file con attributo capture, ridimensiona lato client (max lato ~1280px) e comprime in JPEG qualità ~0.7 usando canvas, poi salva il blob risultante tramite db.js collegato al sopralluogo/domanda corrente. Deve funzionare sia per foto su domande normali sia per foto nel sotto-form NC.

---

## Fase 6 — Riepilogo, Firma, PDF (`pdf.js`)

- [ ] Schermata Riepilogo con conteggi C/PC/NC/NA (PROJECT.md §7.5)
- [ ] Firma su `<canvas>`, salvata come immagine (PROJECT.md §7.6)
- [ ] Generazione PDF con jsPDF: intestazione, dati sopralluogo, risposte per sezione, tabella NC con foto, firma (PROJECT.md §7.7)
- [ ] Salvataggio/condivisione PDF (Web Share API con fallback download)
- [ ] Aggiornamento stato sopralluogo a "completato"

**Prompt per Claude Code:**
> Implementa la schermata di Riepilogo (conteggi per stato, elenco NC con priorità), la firma su canvas, e pdf.js che genera il report finale con jsPDF secondo PROJECT.md §7.5-§7.7: intestazione con logo/dati azienda, dati del sopralluogo, risposte raggruppate per sezione, dettaglio NC con foto, firma in fondo. Usa Web Share API se disponibile, altrimenti download diretto. Aggiorna lo stato del sopralluogo a "completato" in db.js.

---

## Fase 7 — Storico e Impostazioni

- [ ] Schermata Storico: elenco sopralluoghi con riapertura PDF (PROJECT.md §7.8)
- [ ] Schermata Impostazioni: dati azienda/logo, elenco checklist disponibili (PROJECT.md §7.9)

**Prompt per Claude Code:**
> Implementa Storico (elenco sopralluoghi da db.js, ordinati per data decrescente, con pulsante per riaprire/rigenerare il PDF) e Impostazioni (dati azienda e logo salvati in db.js, elenco dei file checklist disponibili in checklists/).

---

## Fase 8 — PWA, offline, rifinitura

- [ ] Verifica completa funzionamento offline (Lighthouse PWA audit)
- [ ] Cache di jsPDF e di tutte le checklist JSON nel service worker
- [ ] Icone reali per manifest.json (varie dimensioni)
- [ ] Test su dispositivo reale: installazione, compilazione, foto, PDF, storico

**Prompt per Claude Code:**
> Rivedi service-worker.js per garantire che tutti gli asset (incluse le librerie come jsPDF e tutti i file in checklists/) siano cacheati e disponibili offline dopo il primo caricamento. Verifica con un audit Lighthouse PWA e correggi eventuali problemi di installabilità.

---

## Come procedere

1. Una fase alla volta, in ordine.
2. Dopo ogni fase: test manuale su telefono prima di passare oltre.
3. Non saltare fasi anche se sembrano semplici: ogni modulo dipende dai precedenti.
4. Ogni nuova funzionalità futura (fuori scope v1.0) va aggiunta come nuova sezione in fondo a questo file, non modificando le fasi già completate.
