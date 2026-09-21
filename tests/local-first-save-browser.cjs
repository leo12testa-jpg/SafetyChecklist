// Test end-to-end in browser reale (Playwright) per la robustezza del salvataggio locale:
// creazione/risposta devono scrivere su IndexedDB PRIMA e INDIPENDENTEMENTE da qualunque esito
// di rete/Firestore/Supabase (bloccati di proposito qui sotto, anche in locale, perché
// firebase-config.js punta al progetto reale indipendentemente dall'hostname che serve la pagina
// — vedi PROJECT.md). Run: node tests/local-first-save-browser.cjs
const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const server = require('./pdf-local-server.cjs');

function playwright() {
  if (process.env.PLAYWRIGHT_MODULE) return require(process.env.PLAYWRIGHT_MODULE);
  try { return require('playwright'); } catch (_) {}
  const cache = path.join(process.env.LOCALAPPDATA || '', 'npm-cache', '_npx');
  const candidates = fs.readdirSync(cache).map(d => path.join(cache, d, 'node_modules', 'playwright'))
    .filter(p => fs.existsSync(path.join(p, 'package.json')));
  if (!candidates.length) throw new Error('Playwright non disponibile: impostare PLAYWRIGHT_MODULE.');
  return require(candidates[0]);
}
function executable(name) {
  const base = path.join(process.env.LOCALAPPDATA || '', 'ms-playwright');
  if (!fs.existsSync(base)) return undefined;
  const dirs = fs.readdirSync(base).filter(d => d.startsWith(name + '-')).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  for (const dir of dirs) {
    const rel = name === 'chromium' ? ['chrome-win64/chrome.exe', 'chrome-win/chrome.exe'] : name === 'firefox' ? ['firefox/firefox.exe'] : ['Playwright.exe'];
    for (const r of rel) if (fs.existsSync(path.join(base, dir, r))) return path.join(base, dir, r);
  }
}

const BASE_URL = 'http://127.0.0.1:8765/';
const CHECKLISTS = ['coin_sopralluogo', 'interparking_sopralluogo', 'restage_sopralluogo', 'melluso_sopralluogo'];

// L'harness (pdf-local-server.cjs) rimuove già firebase/supabase/sync/aggiornamento e li stubba
// con no-op. QUI invece vogliamo il vero sync.js + firebase-config.js caricati, per verificare
// che un fallimento REALE di rete verso Firestore/Supabase non impedisca il salvataggio locale
// — quindi usiamo l'app SENZA lo stub, servita dallo stesso server statico, con le chiamate
// verso i servizi cloud bloccate/404 a livello di rete (mai eseguite realmente).
function pageCompleta() {
  return fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8')
    // Il service worker in un browser di test è solo rumore/rischio di cache tra un run e
    // l'altro: lo togliamo qui (js/aggiornamento.js è l'unico punto che lo registra), non è
    // quello che questi test verificano.
    .replace('<script src="js/aggiornamento.js"></script>', '');
}

async function creaContestoPagina(browser, { failMode = 'abort' } = {}) {
  const context = await browser.newContext();
  const chiamateRemoteViste = [];
  await context.route('**/*', (route) => {
    const url = route.request().url();
    if (/googleapis\.com|firebaseio\.com|gstatic\.com\/firebasejs|supabase\.co/.test(url)) {
      chiamateRemoteViste.push(url);
      if (failMode === '404') {
        return route.fulfill({ status: 404, contentType: 'text/plain', body: 'Not Found' });
      }
      return route.abort();
    }
    if (route.request().url().endsWith('/') && route.request().url() === BASE_URL) {
      return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: pageCompleta() });
    }
    return route.continue();
  });
  const page = await context.newPage();
  const erroriConsole = [];
  const erroriPagina = [];
  page.on('console', (msg) => { if (msg.type() === 'error') erroriConsole.push(msg.text()); });
  page.on('pageerror', (err) => erroriPagina.push(err.stack || String(err)));
  return { context, page, erroriConsole, erroriPagina, chiamateRemoteViste };
}

async function leggiSopralluoghiIDB(page) {
  return page.evaluate(() => new Promise((resolve) => {
    const req = indexedDB.open('SafetyChecklistDB');
    req.onsuccess = () => {
      const idb = req.result;
      const tx = idb.transaction('sopralluoghi', 'readonly');
      const all = tx.objectStore('sopralluoghi').getAll();
      all.onsuccess = () => resolve(all.result);
    };
    req.onerror = () => resolve([]);
  }));
}

async function apriNuovoSopralluogo(page, checklistId, puntoVendita) {
  await page.locator('text=Nuovo sopralluogo').first().click();
  await page.waitForTimeout(200);
  await page.locator('#select-checklist').selectOption(checklistId);
  await page.locator('#input-punto-vendita').fill(puntoVendita).catch(() => {});
}

async function run(browserName, browserType, launchOptions) {
  const risultati = [];
  function verifica(nome, condizione) {
    try {
      assert.ok(condizione, nome);
      risultati.push({ nome, ok: true });
    } catch (errore) {
      risultati.push({ nome, ok: false, errore: errore.message });
    }
  }

  const browser = await browserType.launch(launchOptions);

  try {
    // --- Per ciascuna checklist: creazione, risposta+nota, reload, offline ---
    for (const checklistId of CHECKLISTS) {
      const { context, page, erroriConsole, erroriPagina } = await creaContestoPagina(browser, { failMode: 'abort' });
      const puntoVendita = `E2E-${checklistId}-${Date.now()}`;

      await page.goto(BASE_URL, { waitUntil: 'load', timeout: 20000 });
      await apriNuovoSopralluogo(page, checklistId, puntoVendita);
      await page.locator('button:has-text("INIZIA")').click();
      await page.waitForFunction(() => location.hash === '#compilazione', { timeout: 10000 }).catch(() => {});

      const dopoCreazione = await leggiSopralluoghiIDB(page);
      const creato = dopoCreazione.find((s) => s.punto_vendita === puntoVendita);
      verifica(`[${checklistId}] creato subito in IndexedDB con Firestore bloccato`, !!creato);
      verifica(`[${checklistId}] stato iniziale "in corso"`, creato && creato.stato === 'in corso');

      // Storico lo mostra subito (local-first, nessuna dipendenza da sync)
      await page.locator('.screen:not([hidden]) [data-nav="home"]').first().click().catch(() => {});
      await page.waitForTimeout(150);
      await page.locator('.screen:not([hidden]) [data-nav="history"]').first().click();
      await page.waitForTimeout(300);
      const testoStorico = await page.locator('body').innerText();
      verifica(`[${checklistId}] visibile in Storico subito dopo la creazione`, testoStorico.includes(puntoVendita));

      // Riapri e rispondi con nota
      await page.locator('button:has-text("Modifica checklist")').first().click();
      await page.waitForFunction(() => location.hash === '#compilazione', { timeout: 10000 });
      await page.locator('input[type="radio"][name="risposta"][value="NC"]').first().click();
      await page.waitForTimeout(150);
      // Le note si autosalvano solo al blur (vedi checklist.js/app.js), non a ogni tasto: bisogna
      // aprire l'editor nota, scrivere e uscire dal campo prima di verificare il salvataggio.
      await page.locator('#btn-note').click();
      await page.locator('#nota-testo').fill('nota-e2e-' + checklistId);
      await page.locator('#nota-testo').blur();
      await page.waitForTimeout(400);

      const notaAttesa = 'nota-e2e-' + checklistId;
      const dopoRisposta = await leggiSopralluoghiIDB(page);
      const conRisposta = dopoRisposta.find((s) => s.id === creato.id);
      const risposta1 = conRisposta && (conRisposta.risposte || []).find((r) => r.domanda_id === 1);
      verifica(`[${checklistId}] risposta domanda 1 = NC salvata in IndexedDB`, risposta1 && risposta1.risposta === 'NC');
      verifica(`[${checklistId}] nota della domanda 1 salvata in IndexedDB`, risposta1 && risposta1.note === notaAttesa);

      // Reload pagina: risposta e nota devono restare
      await page.reload({ waitUntil: 'load' });
      await page.waitForTimeout(300);
      const dopoReload = await leggiSopralluoghiIDB(page);
      const dopoReloadRecord = dopoReload.find((s) => s.id === creato.id);
      const rispostaDopoReload = dopoReloadRecord && (dopoReloadRecord.risposte || []).find((r) => r.domanda_id === 1);
      verifica(`[${checklistId}] risposta ancora presente dopo reload pagina`, rispostaDopoReload && rispostaDopoReload.risposta === 'NC');
      verifica(`[${checklistId}] nota ancora presente dopo reload pagina`, rispostaDopoReload && rispostaDopoReload.note === notaAttesa);

      // Offline: Storico deve restare visibile
      await context.setOffline(true);
      await page.locator('.screen:not([hidden]) [data-nav="home"]').first().click().catch(() => {});
      await page.waitForTimeout(150);
      await page.locator('.screen:not([hidden]) [data-nav="history"]').first().click().catch(() => {});
      await page.waitForTimeout(300);
      const testoStoricoOffline = await page.locator('body').innerText();
      verifica(`[${checklistId}] Storico visibile offline`, testoStoricoOffline.includes(puntoVendita));
      await context.setOffline(false);

      verifica(`[${checklistId}] nessun errore JS non gestito`, erroriPagina.length === 0);

      await context.close();
    }

    // --- Doppio click su INIZIA non crea due sopralluoghi ---
    {
      const { context, page } = await creaContestoPagina(browser, { failMode: 'abort' });
      const puntoVendita = `E2E-doppio-click-${Date.now()}`;
      await page.goto(BASE_URL, { waitUntil: 'load', timeout: 20000 });
      await apriNuovoSopralluogo(page, 'coin_sopralluogo', puntoVendita);
      // Due submit sincroni sullo stesso tick, prima che l'handler asincrono del primo possa
      // disabilitare il bottone: è la vera finestra di rischio di un doppio tap reale, più
      // affidabile da riprodurre così che con due click Playwright in corsa fra loro.
      await page.evaluate(() => {
        const form = document.getElementById('form-nuovo-sopralluogo');
        form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
        form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
      });
      await page.waitForTimeout(1000);
      const tutti = await leggiSopralluoghiIDB(page);
      const trovati = tutti.filter((s) => s.punto_vendita === puntoVendita);
      verifica('doppio click su INIZIA crea un solo sopralluogo', trovati.length === 1);
      await context.close();
    }

    // --- 404 esplicito su Firestore/Supabase durante la creazione: il locale resta comunque ---
    {
      const { context, page } = await creaContestoPagina(browser, { failMode: '404' });
      const puntoVendita = `E2E-404-${Date.now()}`;
      await page.goto(BASE_URL, { waitUntil: 'load', timeout: 20000 });
      await apriNuovoSopralluogo(page, 'coin_sopralluogo', puntoVendita);
      await page.locator('button:has-text("INIZIA")').click();
      await page.waitForFunction(() => location.hash === '#compilazione', { timeout: 10000 }).catch(() => {});
      const tutti = await leggiSopralluoghiIDB(page);
      verifica('un 404 su Firestore/Supabase non impedisce la creazione locale', tutti.some((s) => s.punto_vendita === puntoVendita));
      await context.close();
    }

    // --- Checklist JSON introvabile dopo una creazione locale riuscita: il record resta salvato,
    //     l'utente viene mandato in Storico con un messaggio chiaro (mai una promise silenziosa) ---
    {
      const { context, page } = await creaContestoPagina(browser, { failMode: 'abort' });
      const puntoVendita = `E2E-checklist-404-${Date.now()}`;
      await context.route('**/checklists/coin_sopralluogo.json', (route) => route.fulfill({ status: 404, contentType: 'text/plain', body: 'Not Found' }));
      const messaggiDialogo = [];
      page.on('dialog', async (dialog) => { messaggiDialogo.push(dialog.message()); await dialog.accept(); });

      await page.goto(BASE_URL, { waitUntil: 'load', timeout: 20000 });
      await apriNuovoSopralluogo(page, 'coin_sopralluogo', puntoVendita);
      await page.locator('button:has-text("INIZIA")').click();
      await page.waitForFunction(() => location.hash === '#history', { timeout: 10000 }).catch(() => {});

      const tutti = await leggiSopralluoghiIDB(page);
      verifica('checklist non caricabile dopo creazione: il sopralluogo resta comunque salvato', tutti.some((s) => s.punto_vendita === puntoVendita));
      verifica('checklist non caricabile dopo creazione: l\'utente viene portato in Storico', page.url().endsWith('#history'));
      verifica('checklist non caricabile dopo creazione: viene mostrato un messaggio chiaro (non una promise silenziosa)', messaggiDialogo.some((m) => m.includes('salvato correttamente')));
      await context.close();
    }

    // --- Sync completa non cancella un sopralluogo locale assente da remoto (remote missing != delete) ---
    {
      const { context, page } = await creaContestoPagina(browser, { failMode: 'abort' });
      const puntoVendita = `E2E-sync-noremoto-${Date.now()}`;
      await page.goto(BASE_URL, { waitUntil: 'load', timeout: 20000 });
      await apriNuovoSopralluogo(page, 'coin_sopralluogo', puntoVendita);
      await page.locator('button:has-text("INIZIA")').click();
      await page.waitForFunction(() => location.hash === '#compilazione', { timeout: 10000 }).catch(() => {});
      // Richiama sincronizzaTutto esplicitamente (rete verso Firestore comunque bloccata: la
      // sync fallirà, ma non deve MAI toccare i dati locali già presenti).
      await page.evaluate(() => (typeof sync !== 'undefined' && sync.sincronizzaTutto ? sync.sincronizzaTutto() : null)).catch(() => {});
      await page.waitForTimeout(500);
      const tutti = await leggiSopralluoghiIDB(page);
      verifica('sopralluogo locale non sincronizzato NON viene rimosso da una sync fallita/senza remoto', tutti.some((s) => s.punto_vendita === puntoVendita));
      await context.close();
    }
  } finally {
    await browser.close();
  }

  return risultati;
}

(async () => {
  await new Promise((resolve) => server.listen(8765, '127.0.0.1', resolve));
  const pw = playwright();
  const tuttiRisultati = [];
  const browsers = [
    ['chromium', pw.chromium, { headless: true, executablePath: executable('chromium') }],
    ['firefox', pw.firefox, { headless: true, executablePath: executable('firefox') }],
    ['webkit', pw.webkit, { headless: true, executablePath: executable('webkit') }]
  ];

  for (const [nome, browserType, opts] of browsers) {
    if (opts.executablePath === undefined && !process.env.PLAYWRIGHT_MODULE) {
      console.log(`[${nome}] eseguibile non trovato, salto.`);
      continue;
    }
    console.log(`\n=== ${nome} ===`);
    const risultati = await run(nome, browserType, opts);
    risultati.forEach((r) => {
      console.log(`${r.ok ? '✔' : '✘'} [${nome}] ${r.nome}${r.errore ? ' — ' + r.errore : ''}`);
      tuttiRisultati.push({ browser: nome, ...r });
    });
  }

  server.close();

  const falliti = tuttiRisultati.filter((r) => !r.ok);
  console.log(`\n${tuttiRisultati.length - falliti.length}/${tuttiRisultati.length} PASS`);
  if (falliti.length > 0) {
    console.error(`${falliti.length} test FALLITI.`);
    process.exit(1);
  }
})().catch((errore) => {
  console.error('ERRORE SCRIPT:', errore);
  server.close();
  process.exit(1);
});
