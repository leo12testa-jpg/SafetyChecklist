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

    // Technician desktop dashboard.
    await forceDashboard(page, 'tecnico');
    fit = await bodyFits(page);
    assert.ok(fit.app >= 1300, 'desktop app still constrained: ' + JSON.stringify(fit));
    assert.ok(fit.screens >= 1300, 'desktop screens still constrained: ' + JSON.stringify(fit));
    assert.ok(fit.scroll <= fit.width + 2, 'desktop tech horizontal overflow');
    assert.equal(await page.locator('.dashboard-mini-card:visible').count(), 4);
    assert.equal(await page.locator('.dashboard-recent-panel').isVisible(), true);
    assert.equal(await page.locator('.dashboard-action-card:visible').count(), 2);
    for (const box of await page.locator('.dashboard-mini-card:visible').evaluateAll(els => els.map(e => e.getBoundingClientRect().width))) {
      assert.ok(box > 220, 'mini card too narrow: ' + box);
    }
    for (const box of await page.locator('.dashboard-action-card:visible').evaluateAll(els => els.map(e => e.getBoundingClientRect().width))) {
      assert.ok(box > 300, 'action card too narrow: ' + box);
    }
    assert.equal(await page.locator('[data-nav="admin-users"].side-nav-item').isVisible(), false);
    assert.equal(await page.locator('[data-nav="settings"].side-nav-item').isVisible(), false);
    assert.equal(await page.locator('[data-nav="my-work"].side-nav-item').isVisible(), false);
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
    await assertNoCardOverlap(page, '.dashboard-action-card');
    await page.screenshot({ path:path.join(out,'dashboard-admin-desktop.png'), fullPage:true });

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
    assert.equal(await mobile.locator('.dashboard-action-card:visible').count(), 2);
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

    console.log('FINAL UI SMOKE PASS');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exit(1); });
