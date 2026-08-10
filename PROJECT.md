# 🦺 Safety Checklist — PROJECT.md

**Versione:** 1.0
**Tipo:** Progressive Web App (PWA) offline-first
**Costo:** Zero (nessuna libreria a pagamento, nessun backend a pagamento)
**Stato:** Specifiche congelate per lo sviluppo — Claude Code segue questo documento come fonte di verità.

---

## 1. Obiettivo

Digitalizzare le checklist HSE (Health, Safety, Environment) consentendo:

- compilazione da smartphone, **anche offline**;
- foto e note per ogni domanda;
- gestione automatica delle Non Conformità (NC);
- firma digitale a fine sopralluogo;
- generazione automatica di un **report PDF**;
- installazione come app (PWA) senza passare da store.

Nessun server è richiesto per il funzionamento base: tutto vive sul dispositivo (IndexedDB) e i PDF vengono generati lato client (jsPDF).

---

## 2. Stack tecnologico

| Livello | Tecnologia | Note |
|---|---|---|
| Struttura | HTML5 | Single Page App, no framework (no React/Vue) |
| Stile | CSS puro | Mobile-first, nessun framework CSS |
| Logica | JavaScript vanilla (ES6+) | Moduli separati per responsabilità |
| Offline | Service Worker + Cache API | App Shell + asset caching |
| Storage | IndexedDB | Dati sopralluoghi, foto (blob), checklist |
| Manifest | Web App Manifest | Installabilità (Add to Home Screen) |
| PDF | jsPDF (+ jsPDF-AutoTable se serve tabellare) | Generato client-side |
| Foto | `<input capture>` / MediaDevices API | Compressione lato client prima del salvataggio |

**Vincolo:** nessuna dipendenza a pagamento, nessun account cloud richiesto per il funzionamento offline.

---

## 3. Architettura generale

```
Home
  │
  ├─▶ Nuovo sopralluogo
  │       │
  │       ├─▶ Seleziona Cliente / Sede / Tecnico / Checklist
  │       │
  │       └─▶ Compilazione (una domanda alla volta)
  │               │
  │               ├─▶ (se NC) sotto-form: Descrizione, Priorità, Foto, Scadenza
  │               │
  │               └─▶ Riepilogo → Firma → Genera PDF → Salva
  │
  ├─▶ Storico (elenco sopralluoghi salvati, riapri PDF)
  │
  └─▶ Impostazioni (dati azienda, logo, gestione checklist)
```

L'app è **offline-first**: ogni scrittura va prima su IndexedDB; la Cache API serve gli asset statici (HTML/CSS/JS/JSON/logo) quando non c'è rete.

---

## 4. Struttura cartelle del progetto

```
SafetyChecklist/
│
├── index.html
├── manifest.json
├── service-worker.js
│
├── css/
│   └── style.css
│
├── js/
│   ├── app.js         → routing/schermate, stato applicazione, orchestrazione
│   ├── db.js          → wrapper IndexedDB (CRUD sopralluoghi, foto, checklist)
│   ├── checklist.js   → motore di compilazione (caricamento JSON, navigazione domande, validazione)
│   ├── pdf.js         → generazione report con jsPDF
│   └── camera.js       → acquisizione/compressione foto
│
├── checklists/
│   └── people_design.json   → definizione checklist (NON hardcoded nel codice)
│
├── assets/
│   └── logo.png
│
└── reports/            → (opzionale) PDF esportati/scaricati localmente
```

**Regola fondamentale:** le checklist sono **dati**, non codice. Aggiungere una nuova checklist = aggiungere un nuovo file JSON in `checklists/`, senza toccare `checklist.js`.

---

## 5. Formato JSON delle checklist

Schema di riferimento (`checklists/<id>.json`):

```json
{
  "id": "people_design",
  "titolo": "People Design",
  "versione": "1.0",
  "sezioni": [
    {
      "titolo": "Audit Documentale",
      "domande": [
        {
          "id": 1,
          "testo": "Nomina del RSPP",
          "tipo": "C-PC-NC-NA",
          "foto": true,
          "note": true
        }
      ]
    }
  ]
}
```

### Regole del formato

- `tipo`: attualmente solo `"C-PC-NC-NA"` (Conforme / Parzialmente Conforme / Non Conforme / Non Applicabile). Il motore deve leggere questo campo in modo generico per permettere in futuro altri tipi di risposta (es. testo libero, numerico) senza rompere la compatibilità.
- `id` della domanda: intero univoco **all'interno della checklist**, usato per riferimento nelle risposte salvate.
- `foto` / `note`: booleani, abilitano i relativi pulsanti nella schermata di compilazione.
- Ogni sezione ha un `titolo` e un array `domande`.
- Il numero totale di domande (per il contatore "Domanda X di Y") si calcola sommando le domande di tutte le sezioni.

### Risposta salvata (struttura dati interna, non nel JSON checklist)

```json
{
  "domanda_id": 1,
  "sezione": "Audit Documentale",
  "risposta": "NC",
  "note": "Testo libero",
  "foto": ["blob_id_1"],
  "nc_dettaglio": {
    "descrizione": "Manca nomina RSPP",
    "priorita": "Alta",
    "foto": ["blob_id_2"],
    "scadenza": "2026-08-30"
  }
}
```

---

## 6. Schema IndexedDB (`db.js`)

Database: `SafetyChecklistDB`

| Object Store | Key | Contenuto |
|---|---|---|
| `sopralluoghi` | `id` (uuid) | metadati (cliente, sede, tecnico, checklist_id, data, stato: "in corso"/"completato"), array risposte |
| `foto` | `id` (uuid) | blob immagine compressa, riferimento a `sopralluogo_id` e `domanda_id` |
| `checklists_cache` | `id` | copia locale del JSON checklist (per funzionare offline anche se il JSON viene aggiornato da remoto in futuro) |
| `impostazioni` | `chiave` | dati azienda, logo, preferenze utente |
| `pdf_report` | `sopralluogo_id` | blob del PDF generato al completamento del sopralluogo + nome file, per apertura/download dallo Storico senza rigenerare |

**Nota:** i blob delle foto vengono salvati compressi (es. max lato 1280px, JPEG qualità ~0.7) per contenere lo spazio occupato dato che IndexedDB non ha limiti stretti ma i dispositivi mobile sì.

---

## 7. Schermate — specifiche UX

### 7.1 Home

```
🦺 Safety Checklist

[ Nuovo sopralluogo ]
[ Storico ]
[ Impostazioni ]
```

- Bottoni grandi, touch-friendly (min 48px altezza).
- Nessuna richiesta di login.

### 7.2 Nuovo sopralluogo

```
Cliente     [ ▼ selezione / testo libero ]
Sede        [ ▼ selezione / testo libero ]
Tecnico     [ ▼ selezione / testo libero ]
Checklist   [ ▼ elenco file da checklists/ ]

[ INIZIA ]
```

- I campi Cliente/Sede/Tecnico: dropdown che si popolano con i valori usati in precedenza (salvati in `impostazioni` o derivati dallo storico), ma editabili come testo libero per inserirne di nuovi.
- Checklist: elenco dinamico, un file JSON = una checklist disponibile.
- "INIZIA" crea un nuovo record in `sopralluoghi` con stato "in corso" e passa alla compilazione.

### 7.3 Compilazione (una domanda alla volta)

```
Audit Documentale
Domanda 5 di 34

Nomina RSPP

○ C     ○ PC     ○ NC     ○ NA

[ Note ]     [ 📷 Foto ]

[ ← Indietro ]        [ Avanti → ]
```

- Barra di progresso in alto (es. 5/34).
- Titolo sezione sempre visibile.
- Selezione risposta obbligatoria per passare avanti (a meno che la domanda non preveda diversamente in futuro).
- "Note" e "Foto" appaiono solo se abilitati nel JSON (`note: true`, `foto: true`).
- Navigazione avanti/indietro conserva le risposte già date (autosalvataggio su IndexedDB ad ogni risposta, non solo alla fine).

### 7.4 Gestione automatica Non Conformità (NC)

Se l'utente seleziona **NC**, si apre automaticamente un sotto-form:

```
Descrizione   [ testo libero ]
Priorità      [ Bassa / Media / Alta ]
Foto          [ 📷 aggiungi foto ]
Scadenza      [ selettore data ]

[ Conferma ]
```

- Obbligatorio compilare almeno "Descrizione" e "Priorità" prima di poter proseguire.
- Questi dati confluiscono in una tabella "Non Conformità rilevate" nel PDF finale.

### 7.5 Riepilogo

```
Riepilogo sopralluogo

Totale domande: 34
✔ Conformi: 28
⚠ Parz. conformi: 2
✘ Non conformi: 3
– Non applicabili: 1

[ Firma ]
```

- Elenco sintetico delle NC con priorità, per revisione rapida prima della firma.

### 7.6 Firma

```
Firma il sopralluogo

[  canvas per firma con il dito  ]

[ Cancella ]     [ Conferma firma ]
```

- Firma disegnata su `<canvas>`, salvata come immagine (dataURL/blob) e inserita nel PDF.

### 7.7 Generazione PDF / Salvataggio

```
[ Genera PDF ]

→ PDF generato ✔
[ Salva / Condividi ] [ Torna alla Home ]
```

- Il PDF include: intestazione (logo + dati azienda), dati sopralluogo (cliente, sede, tecnico, data), elenco risposte per sezione, dettaglio NC con foto, firma finale.
- Il sopralluogo passa a stato "completato" in IndexedDB.
- Il PDF viene reso disponibile per il download/condivisione tramite le API del browser (Web Share API se disponibile, altrimenti download diretto).
- Il PDF generato viene inoltre salvato in `pdf_report` (vedi §6), così da poterlo riaprire/scaricare dallo Storico senza rigenerarlo.

### 7.8 Storico

```
Storico sopralluoghi

[Cliente A – Sede 1 – 12/07/2026]  [Apri] [Scarica]
[Cliente B – Sede 2 – 20/07/2026]  [Apri] [Scarica]
```

- Elenco ordinato per data decrescente.
- Il PDF generato al completamento del sopralluogo viene salvato in IndexedDB (store `pdf_report`, chiave `sopralluogo_id`): Apri/Scarica riusano quel Blob, senza rigenerare il PDF né richiedere di rifare il sopralluogo.
- Sopralluoghi completati prima dell'introduzione di questo salvataggio non hanno un PDF disponibile: Apri/Scarica mostrano un messaggio in tal caso (nessuna rigenerazione automatica).

### 7.9 Impostazioni

```
Dati azienda: [ nome, logo, indirizzo ]
Gestione checklist: [ elenco file JSON disponibili ]
```

---

## 8. Comportamento offline (PWA)

- **Service Worker**: cache dell'App Shell (`index.html`, `css/`, `js/`, `manifest.json`, `checklists/*.json`, `assets/logo.png`) con strategia *cache-first* per gli asset statici e *network-first con fallback cache* per eventuali risorse dinamiche future.
- **manifest.json**: nome app, icone, `display: standalone`, `start_url`, `theme_color`.
- Nessuna funzionalità richiede connessione: creazione, compilazione, foto, firma, PDF e salvataggio avvengono interamente in locale.
- Se in futuro si aggiungerà sincronizzazione cloud, dovrà essere un livello opzionale sopra questa base, mai un requisito.

---

## 9. Obiettivi Versione 1.0 (criteri di accettazione)

- [ ] Funziona interamente offline dopo il primo caricamento
- [ ] Le checklist si caricano da file JSON esterni (nessuna checklist hardcoded in JS)
- [ ] Compilazione una domanda alla volta con progresso visibile
- [ ] Gestione automatica del sotto-form NC
- [ ] Foto allegabili a singole domande e a NC
- [ ] Note testuali per domanda
- [ ] Firma digitale a fine sopralluogo
- [ ] Generazione PDF completo e leggibile
- [ ] Salvataggio locale persistente (IndexedDB), sopravvive alla chiusura del browser
- [ ] App installabile su smartphone (Add to Home Screen)
- [ ] Storico consultabile con riapertura PDF

---

## 10. Fuori scope per la v1.0 (da valutare in versioni future)

- Sincronizzazione cloud / multi-dispositivo
- Login/multi-utente
- Editor grafico per creare checklist da interfaccia (per ora si editano i JSON a mano)
- Dashboard statistiche/analytics
- Notifiche push per scadenze NC

---

## 11. Convenzioni di sviluppo per Claude Code

- Nessun framework: JS vanilla, moduli separati come da struttura cartelle.
- Ogni file JS ha una responsabilità unica (vedi tabella struttura cartelle).
- Commentare le funzioni pubbliche di ciascun modulo.
- Non introdurre dipendenze npm/build step: il progetto deve restare apribile aprendo `index.html` (eventualmente servito da un semplice static server per via del Service Worker).
- jsPDF va incluso come libreria locale o da CDN con fallback locale per garantire funzionamento offline dopo il primo caricamento (va cacheata dal Service Worker).
- Seguire rigorosamente questo documento; eventuali deviazioni vanno segnalate, non decise autonomamente.
