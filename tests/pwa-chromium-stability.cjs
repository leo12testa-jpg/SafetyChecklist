const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');

const root = path.resolve(__dirname, '..');
const chrome = process.env.CHROME_PATH;
if (!chrome) throw new Error('CHROME_PATH mancante');

function contentType(file) {
  return ({
    '.html':'text/html; charset=utf-8',
    '.js':'text/javascript; charset=utf-8',
    '.json':'application/json; charset=utf-8',
    '.css':'text/css; charset=utf-8',
    '.png':'image/png',
    '.webp':'image/webp',
    '.svg':'image/svg+xml'
  })[path.extname(file).toLowerCase()] || 'application/octet-stream';
}

const server = http.createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (!pathname.startsWith('/SafetyChecklist/')) {
    res.writeHead(404); return res.end();
  }
  const rel = pathname.slice('/SafetyChecklist/'.length) || 'index.html';
  const file = path.resolve(root, rel);
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); return res.end();
  }
  res.setHeader('Content-Type', contentType(file));
  res.setHeader('Cache-Control', 'no-store');
  res.end(fs.readFileSync(file));
});

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/SafetyChecklist/`;
  const browser = await chromium.launch({ executablePath: chrome, headless:true, args:['--no-sandbox'] });
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.goto(base, { waitUntil:'load', timeout:45000 });

    const registration = await page.evaluate(async () => {
      const ready = await Promise.race([
        navigator.serviceWorker.ready,
        new Promise((_, reject) => setTimeout(() => reject(new Error('Service Worker non attivo')), 12000))
      ]);
      return { scope: ready.scope, state: ready.active && ready.active.state };
    });
    assert.equal(registration.scope, base);
    assert.equal(registration.state, 'activated');

    await page.reload({ waitUntil:'load' });
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout:12000 });

    const cached = await page.evaluate(async () => {
      const keys = await caches.keys();
      const logo = await caches.match('assets/logo_carrefour.png');
      return { keys, logo: Boolean(logo), logoSize: logo ? (await logo.blob()).size : 0 };
    });
    assert.ok(cached.keys.some(k => k.startsWith('safety-checklist-shell-')), 'Cache shell assente');
    assert.equal(cached.logo, true, 'Logo Carrefour non precacheato');
    assert.ok(cached.logoSize > 1000, 'Logo Carrefour cache vuoto');

    await context.setOffline(true);
    const offlineLogo = await page.evaluate(async () => {
      const r = await fetch('assets/logo_carrefour.png');
      return { ok:r.ok, size:(await r.blob()).size };
    });
    assert.equal(offlineLogo.ok, true);
    assert.ok(offlineLogo.size > 1000);

    await page.reload({ waitUntil:'domcontentloaded', timeout:20000 });
    assert.equal(await page.title(), 'Safety Checklist');
    assert.ok(await page.locator('#login-view').count() === 1);

    console.log('PWA Chromium stability PASS', { registration, cached, offlineLogo });
  } finally {
    await context.close();
    await browser.close();
    server.close();
  }
})().catch(err => {
  console.error(err);
  server.close();
  process.exitCode = 1;
});
