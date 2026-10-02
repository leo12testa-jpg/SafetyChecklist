const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');

const url = process.env.LIVE_URL || 'https://leo12testa-jpg.github.io/SafetyChecklist/';
const executablePath = process.env.CHROME_PATH;
if (!executablePath) throw new Error('CHROME_PATH mancante');

const out = path.join(process.cwd(), 'reports', 'final-ui');
fs.mkdirSync(out, { recursive: true });

function overlaps(a, b) {
  if (!a || !b) return false;
  const x = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const y = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return x * y > 4;
}

async function assertNoCardOverlap(page, selector) {
  const boxes = await page.locator(selector).evaluateAll(els => els.filter(el => {
    const s = getComputedStyle(el);
    return s.display !== 'none' && s.visibility !== 'hidden' && !el.hidden;
  }).map(el => {
    const r = el.getBoundingClientRect();
    return { x:r.x, y:r.y, width:r.width, height:r.height };
  }));
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      assert.equal(overlaps(boxes[i], boxes[j]), false, selector + ' overlap ' + i + '/' + j);
    }
  }
}

async function forceDashboard(page, role) {
  await page.evaluate((role) => {
    document.body.dataset.authReady = 'true';
    document.body.dataset.authenticated = 'true';
    document.body.dataset.role = role;
    document.querySelector('#login-view').hidden = true;
    document.querySelector('#screens').hidden = false;
    const header = document.querySelector('.app-header');
    if (header) header.style.display = '';
    const session = document.querySelector('#utente-sessione');
    if (session) session.hidden = false;
    const sync = document.querySelector('#stato-connessione');
    if (sync) sync.hidden = false;
    document.querySelectorAll('[data-admin-only]').forEach(el => { el.hidden = role !== 'admin'; });
    document.querySelectorAll('.screen').forEach(el => { el.hidden = el.dataset.screen !== 'home'; });
    const name = document.querySelector('#dashboard-utente-nome');
    if (name) name.textContent = role === 'admin' ? 'Leonardo' : 'Tecnico';
  }, role);
  await page.waitForTimeout(150);
}

async function bodyFits(page) {
  return page.evaluate(() => ({
    width: innerWidth,
    scroll: document.documentElement.scrollWidth,
    app: document.querySelector('#app')?.getBoundingClientRect().width || 0,
    screens: document.querySelector('#screens')?.getBoundingClientRect().width || 0
  }));
}

(async () => {
  const browser = await chromium.launch({ executablePath, headless:true, args:['--no-sandbox'] });
  try {
    const context = await browser.newContext({ serviceWorkers:'block' });
    const page = await context.newPage();

    // Real login page, desktop.
    await page.setViewportSize({ width:1440, height:1000 });
    await page.goto(url, { waitUntil:'domcontentloaded', timeout:45000 });
    await page.waitForSelector('#login-view:not([hidden])', { timeout:15000 });
    assert.equal(await page.locator('.login-brand-panel').isVisible(), true);
    assert.equal(await page.locator('.login-card').isVisible(), true);
    assert.equal(await page.locator('#screens').isVisible(), false, 'dashboard visible behind desktop login');
    let fit = await bodyFits(page);
    assert.ok(fit.scroll <= fit.width + 2, 'login desktop horizontal overflow');
    await page.screenshot({ path:path.join(out,'login-desktop.png'), fullPage:true });

    // PDF preview: verify the canvas backing store is substantially denser than its CSS size.
    const pdfQuality = await page.evaluate(async () => {
      const doc = new jspdf.jsPDF();
      doc.setFontSize(9);
      doc.text('Verifica nitidezza anteprima Safety Checklist', 18, 22);
      for (let y = 34; y < 270; y += 8) doc.text('Testo PDF ad alta definizione 0123456789', 18, y);
      await pdf.apri(doc.output('blob'), 'nitidezza-test.pdf', null);
      const canvas = document.querySelector('.pdf-preview-overlay canvas');
      const box = canvas.getBoundingClientRect();
      return {
        width: canvas.width,
        height: canvas.height,
        cssWidth: box.width,
        cssHeight: box.height,
        ratio: canvas.width / box.width,
        renderScale: Number(canvas.dataset.renderScale || 0)
      };
    });
    assert.ok(pdfQuality.cssWidth > 650, 'PDF preview desktop too small: ' + JSON.stringify(pdfQuality));
    assert.ok(pdfQuality.ratio >= 1.45, 'PDF preview backing store too low resolution: ' + JSON.stringify(pdfQuality));
    assert.ok(pdfQuality.renderScale >= 1.8, 'PDF render scale too low: ' + JSON.stringify(pdfQuality));
    await page.screenshot({ path:path.join(out,'pdf-preview-hidpi.png'), fullPage:false });
    await page.getByRole('button',{name:'Chiudi anteprima PDF'}).click();

    // Technician desktop dashboard.
    await forceDashboard(page, 'tecnico');
    fit = await bodyFits(page);
    assert.ok(fit.app >= 1300, 'desktop app still constrained: ' + JSON.stringify(fit));
    assert.ok(fit.screens >= 1300, 'desktop screens still constrained: ' + JSON.stringify(fit));
    assert.ok(fit.scroll <= fit.width + 2, 'desktop tech horizontal overflow');
    assert.equal(await page.locator('.dashboard-mini-card:visible').count(), 4);
    assert.equal(await page.locator('.dashboard-recent-panel').isVisible(), true);
    assert.equal(await page.locator('#dashboard-resume-panel').count(), 1);
    assert.equal(await page.locator('.dashboard-action-card:visible').count(), 2);
    assert.equal(await page.locator('#dashboard-install-card').isVisible(), false);
    await page.evaluate(() => {
      const event = new Event('beforeinstallprompt', { cancelable:true });
      event.prompt = async () => {};
      event.userChoice = Promise.resolve({ outcome:'dismissed', platform:'web' });
      window.dispatchEvent(event);
    });
    assert.equal(await page.locator('#dashboard-install-card').isVisible(), true);
    assert.match(await page.locator('#dashboard-install-title').textContent(), /Installa/i);
    await page.locator('#dashboard-install-card').evaluate(el => { el.hidden = true; });
    for (const box of await page.locator('.dashboard-mini-card:visible').evaluateAll(els => els.map(e => e.getBoundingClientRect().width))) {
      assert.ok(box > 220, 'mini card too narrow: ' + box);
    }
    for (const box of await page.locator('.dashboard-action-card:visible').evaluateAll(els => els.map(e => e.getBoundingClientRect().width))) {
      assert.ok(box > 300, 'action card too narrow: ' + box);
    }
    assert.equal(await page.locator('[data-nav="admin-users"].side-nav-item').isVisible(), false);
    assert.equal(await page.locator('[data-nav="settings"].side-nav-item').isVisible(), false);
    assert.equal(await page.locator('[data-nav="my-work"].side-nav-item').isVisible(), false);
    assert.equal(await page.locator('#storico-filtro-checklist').count(), 1);
    await assertNoCardOverlap(page, '.dashboard-mini-card');
    await assertNoCardOverlap(page, '.dashboard-action-card');
    await page.screenshot({ path:path.join(out,'dashboard-tech-desktop.png'), fullPage:true });

    // History filters stay usable on desktop.
    await page.evaluate(() => {
      document.querySelectorAll('.screen').forEach(el => { el.hidden = el.dataset.screen !== 'history'; });
    });
    assert.equal(await page.locator('#storico-filtro-tecnico').isVisible(), true);
    assert.equal(await page.locator('#storico-data-da').isVisible(), true);
    assert.equal(await page.locator('#storico-data-a').isVisible(), true);
    assert.equal(await page.locator('#storico-reset-filtri').isVisible(), true);
    fit = await bodyFits(page);
    assert.ok(fit.scroll <= fit.width + 2, 'history desktop horizontal overflow');
    await page.screenshot({ path:path.join(out,'history-desktop.png'), fullPage:true });
    await forceDashboard(page, 'tecnico');

    // Admin desktop dashboard.
    await forceDashboard(page, 'admin');
    assert.equal(await page.locator('[data-nav="admin-users"].side-nav-item').isVisible(), true);
    assert.equal(await page.locator('[data-nav="settings"].side-nav-item').isVisible(), true);
    assert.equal(await page.locator('[data-nav="my-work"].side-nav-item').isVisible(), true);
    assert.equal(await page.locator('.dashboard-action-card:visible').count(), 5);
    assert.equal(await page.locator('#admin-user-search').count(), 1);
    assert.equal(await page.locator('#storico-ordinamento').count(), 1);
    await assertNoCardOverlap(page, '.dashboard-action-card');
    await page.screenshot({ path:path.join(out,'dashboard-admin-desktop.png'), fullPage:true });

    // Admin user management layout.
    await page.evaluate(() => {
      document.querySelectorAll('.screen').forEach(el => { el.hidden = el.dataset.screen !== 'admin-users'; });
    });
    assert.equal(await page.locator('#admin-user-search').isVisible(), true);
    assert.equal(await page.locator('.admin-users-stats').isVisible(), true);
    fit = await bodyFits(page);
    assert.ok(fit.scroll <= fit.width + 2, 'admin users horizontal overflow');
    await page.screenshot({ path:path.join(out,'admin-users-desktop.png'), fullPage:true });
    await forceDashboard(page, 'admin');

    // Real login page, mobile.
    const mobile = await context.newPage();
    await mobile.setViewportSize({ width:390, height:844 });
    await mobile.goto(url, { waitUntil:'domcontentloaded', timeout:45000 });
    await mobile.waitForSelector('#login-view:not([hidden])', { timeout:15000 });
    assert.equal(await mobile.locator('.login-brand-panel').isVisible(), false);
    assert.equal(await mobile.locator('.login-card').isVisible(), true);
    assert.equal(await mobile.locator('#screens').isVisible(), false, 'dashboard visible behind mobile login');
    fit = await bodyFits(mobile);
    assert.ok(fit.scroll <= fit.width + 2, 'login mobile horizontal overflow');
    await mobile.screenshot({ path:path.join(out,'login-mobile.png'), fullPage:true });

    // Technician mobile dashboard.
    await forceDashboard(mobile, 'tecnico');
    fit = await bodyFits(mobile);
    assert.ok(fit.scroll <= fit.width + 2, 'dashboard mobile horizontal overflow: ' + JSON.stringify(fit));
    assert.equal(await mobile.locator('.dashboard-mini-card:visible').count(), 4);
    assert.equal(await mobile.locator('.dashboard-recent-panel').isVisible(), true);
    assert.equal(await mobile.locator('#dashboard-resume-panel').count(), 1);
    assert.equal(await mobile.locator('.dashboard-action-card:visible').count(), 2);
    assert.equal(await mobile.locator('#dashboard-install-card').count(), 1);
    const gridCols = await mobile.locator('.dashboard-mini-grid').evaluate(el => getComputedStyle(el).gridTemplateColumns.trim().split(/\s+/).length);
    assert.equal(gridCols, 1, 'mobile mini cards not one column');
    const sidebar = await mobile.locator('.app-sidebar').evaluate(el => ({ position:getComputedStyle(el).position, bottom:getComputedStyle(el).bottom }));
    assert.equal(sidebar.position, 'fixed');
    await assertNoCardOverlap(mobile, '.dashboard-mini-card');
    await assertNoCardOverlap(mobile, '.dashboard-action-card');
    await mobile.screenshot({ path:path.join(out,'dashboard-tech-mobile.png'), fullPage:true });

    // History filters remain stacked and usable on mobile.
    await mobile.evaluate(() => {
      document.querySelectorAll('.screen').forEach(el => { el.hidden = el.dataset.screen !== 'history'; });
    });
    assert.equal(await mobile.locator('#storico-filtro-tecnico').isVisible(), true);
    assert.equal(await mobile.locator('#storico-reset-filtri').isVisible(), true);
    fit = await bodyFits(mobile);
    assert.ok(fit.scroll <= fit.width + 2, 'history mobile horizontal overflow');
    await mobile.screenshot({ path:path.join(out,'history-mobile.png'), fullPage:true });


    // Progress bar semantics: red/incomplete means exactly "no actual answer".
    const markerPage = await context.newPage();
    await markerPage.setViewportSize({ width:1280, height:900 });
    await markerPage.goto(url, { waitUntil:'domcontentloaded', timeout:45000 });
    await markerPage.waitForSelector('#login-view:not([hidden])', { timeout:15000 });
    await markerPage.evaluate(() => {
      document.body.dataset.authReady = 'true';
      document.body.dataset.authenticated = 'true';
      document.querySelector('#login-view').hidden = true;
      document.querySelector('#screens').hidden = false;
      document.querySelectorAll('.screen').forEach(el => { el.hidden = el.dataset.screen !== 'compilazione'; });

      const fake = {
        id:'marker-smoke',
        risposte:[
          // domanda_id stringa apposta: deve combaciare con l'id numerico della checklist.
          { domanda_id:'1', risposta:'C', note:null, foto:[] },
          { domanda_id:2, risposta:'', note:null, foto:[] },
          { domanda_id:3, risposta:[], note:null, foto:[] },
          { domanda_id:4, risposta:{ Campo:'' }, note:null, foto:[] },
          { domanda_id:5, risposta:0, note:null, foto:[] }
        ]
      };
      const checklist = {
        id:'marker-smoke',
        stile:'raccolta-dati',
        sezioni:[{ titolo:'Test', domande:[
          { id:1, testo:'Uno', tipo:'si-no' },
          { id:2, testo:'Due', tipo:'testo' },
          { id:3, testo:'Tre', tipo:'checkbox-multi', opzioni:[{label:'A'}] },
          { id:4, testo:'Quattro', tipo:'gruppo-testo', campi:[{label:'Campo'}] },
          { id:5, testo:'Cinque', tipo:'numero' }
        ]}]
      };
      db.salvaRisposta = async (_id, risposta) => {
        const i = fake.risposte.findIndex(r => r.domanda_id === risposta.domanda_id);
        if (i >= 0) fake.risposte[i] = { ...fake.risposte[i], ...risposta };
        else fake.risposte.push(risposta);
        return fake;
      };
      checklistEngine.avvia(checklist, fake);
      compilazioneScreen.init();
      compilazioneScreen.renderDomandaCorrente();
    });
    assert.equal(await markerPage.locator('#progress-label').textContent(), 'Domanda 2 di 5');
    assert.deepEqual(
      await markerPage.locator('.progress-marker').evaluateAll(els => els.map(el => el.dataset.stato)),
      ['completa','da-completare','da-completare','da-completare','completa']
    );
    const rispostaTesto = markerPage.locator('#raccolta-dati-controllo textarea');
    await rispostaTesto.fill('Risposta presente');
    await rispostaTesto.dispatchEvent('change');
    await markerPage.waitForFunction(() => document.querySelectorAll('.progress-marker')[1]?.dataset.stato === 'completa');
    await rispostaTesto.fill('');
    await rispostaTesto.dispatchEvent('change');
    await markerPage.waitForFunction(() => document.querySelectorAll('.progress-marker')[1]?.dataset.stato === 'da-completare');
    assert.equal(await markerPage.locator('.compilazione-live-badge').isVisible(), true);
    const questionCardWidth = await markerPage.locator('.compilazione-question-card').evaluate(el => el.getBoundingClientRect().width);
    const noteWidth = await markerPage.locator('#nota-editor').evaluate(el => {
      el.hidden = false;
      return el.getBoundingClientRect().width;
    });
    assert.ok(noteWidth > questionCardWidth * 0.85, 'note editor too narrow');
    fit = await bodyFits(markerPage);
    assert.ok(fit.scroll <= fit.width + 2, 'compilazione desktop horizontal overflow');
    await markerPage.screenshot({ path:path.join(out,'compilazione-desktop.png'), fullPage:true });

    const compilationMobile = await context.newPage();
    await compilationMobile.setViewportSize({ width:390, height:844 });
    await compilationMobile.goto(url, { waitUntil:'domcontentloaded', timeout:45000 });
    await compilationMobile.waitForSelector('#login-view:not([hidden])', { timeout:15000 });
    await compilationMobile.evaluate(() => {
      document.body.dataset.authReady = 'true';
      document.body.dataset.authenticated = 'true';
      document.querySelector('#login-view').hidden = true;
      document.querySelector('#screens').hidden = false;
      document.querySelectorAll('.screen').forEach(el => { el.hidden = el.dataset.screen !== 'compilazione'; });
      document.querySelector('#macro-gruppi-tabs').hidden = false;
      document.querySelector('#compilazione-sezione').textContent = 'GESTIONE DELL’EMERGENZA';
      document.querySelector('#compilazione-domanda').textContent = 'È stata eseguita la prova annuale di evacuazione? Indicare nelle note la data dell’ultimo verbale.';
      document.querySelector('#progress-label').textContent = 'Domanda 27 di 60';
      document.querySelector('#nota-editor').hidden = false;
    });
    assert.equal(await compilationMobile.locator('.compilazione-live-badge').isVisible(), true);
    assert.equal(await compilationMobile.locator('.opzione-risposta:visible').count(), 4);
    const mobileCols = await compilationMobile.locator('#risposte-opzioni').evaluate(el => getComputedStyle(el).gridTemplateColumns.trim().split(/\s+/).length);
    assert.equal(mobileCols, 2, 'mobile answers not 2 columns');
    fit = await bodyFits(compilationMobile);
    assert.ok(fit.scroll <= fit.width + 2, 'compilazione mobile horizontal overflow');
    await compilationMobile.screenshot({ path:path.join(out,'compilazione-mobile.png'), fullPage:true });

    console.log('FINAL UI SMOKE PASS');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exit(1); });
