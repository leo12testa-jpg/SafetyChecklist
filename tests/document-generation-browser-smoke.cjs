// Browser smoke for the local-only DUVRI intake. Uses synthetic data and a
// loopback-only server; requests outside that server are blocked.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const JSZip = require('../js/vendor/jszip.min.js');
const { makeServer, guard, playwright } = require('./qa-support.cjs');

const { chromium } = playwright();
const server = makeServer({ raw: true });
const chromePath = process.env.CHROME_PATH;
assert.ok(chromePath, 'CHROME_PATH is required for the local browser smoke');

async function exposeIntake(page, viewport) {
  await page.setViewportSize(viewport);
  await page.goto(server.origin + '/SafetyChecklist/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#screen-document-generation', { state: 'attached' });
  await page.evaluate(() => {
    document.body.dataset.authReady = 'true';
    document.body.dataset.authenticated = 'true';
    document.body.dataset.role = 'admin';
    document.querySelector('#login-view').hidden = true;
    document.querySelector('#screens').hidden = false;
    document.querySelectorAll('.screen').forEach((screen) => {
      screen.hidden = screen.dataset.screen !== 'document-generation';
    });
  });
  await page.waitForTimeout(100);
}

(async () => {
  const origin = await server.start();
  const browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ['--no-sandbox'] });
  try {
    const context = await browser.newContext({ serviceWorkers: 'block', acceptDownloads: true });
    const blockedRequests = await guard(context, new URL(origin).origin);
    const desktop = await context.newPage();
    await exposeIntake(desktop, { width: 1440, height: 1000 });
    const blockedAtStart = blockedRequests.length;

    const desktopLayout = await desktop.evaluate(() => ({
      width: innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      uploadColumns: getComputedStyle(document.querySelector('.dg-upload-grid')).gridTemplateColumns.split(' ').length,
      statusColumns: getComputedStyle(document.querySelector('.dg-status-grid')).gridTemplateColumns.split(' ').length,
      uploadCount: document.querySelectorAll('[data-dg-attachment-category]').length,
      statusCount: document.querySelectorAll('[data-dg-status-category]').length,
      cloudEnabled: typeof DOCUMENT_GENERATION_CLOUD_ENABLED === 'undefined'
        ? undefined
        : DOCUMENT_GENERATION_CLOUD_ENABLED
    }));
    assert.ok(desktopLayout.scrollWidth <= desktopLayout.width + 2, 'desktop horizontal overflow');
    assert.equal(desktopLayout.uploadColumns, 2);
    assert.equal(desktopLayout.statusColumns, 2);
    assert.equal(desktopLayout.uploadCount, 11);
    assert.equal(desktopLayout.statusCount, 10);
    assert.equal(desktopLayout.cloudEnabled, false);

    await desktop.locator('[name="title"]').fill('Prova browser sintetica');
    await desktop.locator('[name="documentDate"]').fill('2026-10-29');
    await desktop.locator('[name="clientName"]').fill('Committente sintetico');
    await desktop.locator('[name="site"]').fill('Via di prova 1');
    await desktop.locator('[name="siteType"]').selectOption('internal_area');
    await desktop.locator('#dg-files-dvr').setInputFiles([
      {
        name: 'documento-generico.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from('DUVRI-SYNTHETIC-BROWSER-BYTES')
      },
      {
        name: 'secondo-documento.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from('DUVRI-SECOND-SYNTHETIC-BYTES')
      }
    ]);
    await desktop.locator('[name="documentStatusDvr"]').selectOption('available');
    await desktop.locator('#dg-form button[type="submit"]').click();
    await desktop.waitForSelector('#dg-result:not([hidden])');
    assert.match(await desktop.locator('#dg-cloud-status').textContent(), /nessun agente è stato avviato/);
    assert.equal(blockedRequests.length, blockedAtStart, 'local intake submitted a non-local request');

    const downloadReady = desktop.waitForEvent('download');
    await desktop.locator('#dg-download-package').click();
    const download = await downloadReady;
    const archivePath = await download.path();
    assert.ok(archivePath, 'the browser did not produce a ZIP file');
    const archive = await JSZip.loadAsync(await fs.readFile(archivePath));
    const names = Object.keys(archive.files).filter((name) => !archive.files[name].dir).sort();
    assert.deepEqual(names, [
      'ISTRUZIONI.txt',
      'allegati/dvr-specifico/001-documento-generico.pdf',
      'allegati/dvr-specifico/002-secondo-documento.pdf',
      'scheda-duvri.json'
    ]);
    const json = JSON.parse(await archive.file('scheda-duvri.json').async('string'));
    assert.equal(json.documentAvailability['dvr-specifico'], 'available');
    assert.equal(json.sourceChecklist, null);
    assert.equal(json.documents.length, 2);
    assert.equal(
      await archive.file('allegati/dvr-specifico/001-documento-generico.pdf').async('string'),
      'DUVRI-SYNTHETIC-BROWSER-BYTES'
    );
    assert.equal(
      await archive.file('allegati/dvr-specifico/002-secondo-documento.pdf').async('string'),
      'DUVRI-SECOND-SYNTHETIC-BYTES'
    );

    const mobile = await context.newPage();
    await exposeIntake(mobile, { width: 390, height: 844 });
    const mobileLayout = await mobile.evaluate(() => ({
      width: innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      uploadColumns: getComputedStyle(document.querySelector('.dg-upload-grid')).gridTemplateColumns.split(' ').length,
      statusColumns: getComputedStyle(document.querySelector('.dg-status-grid')).gridTemplateColumns.split(' ').length
    }));
    assert.ok(mobileLayout.scrollWidth <= mobileLayout.width + 2, 'mobile horizontal overflow');
    assert.equal(mobileLayout.uploadColumns, 1);
    assert.equal(mobileLayout.statusColumns, 1);
    assert.equal(blockedRequests.length, blockedAtStart);

    await context.close();
    console.log('DUVRI browser smoke PASS', JSON.stringify({ desktopLayout, mobileLayout, zipFiles: names }));
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
