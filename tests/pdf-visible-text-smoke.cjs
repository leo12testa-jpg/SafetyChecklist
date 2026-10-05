const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const server = require('./pdf-local-server.cjs');

const executablePath = process.env.CHROME_PATH;
if (!executablePath) throw new Error('CHROME_PATH mancante');

(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch({ executablePath, headless:true, args:['--no-sandbox'] });
  try {
    const context = await browser.newContext({ serviceWorkers:'block' });
    await context.route('**/*', route => {
      const url = route.request().url();
      if (url.startsWith(origin) || /^(blob:|data:)/.test(url)) return route.continue();
      return route.abort();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    await page.goto(origin, { waitUntil:'domcontentloaded' });
    await page.waitForFunction(() =>
      typeof pdfImport !== 'undefined' &&
      typeof pdfjsLib !== 'undefined' &&
      typeof jspdf !== 'undefined'
    );

    const capabilities = await page.evaluate(() => {
      const d = new jspdf.jsPDF({ unit:'pt', format:'a4' });
      return {
        beginFormObject: typeof d.beginFormObject,
        endFormObject: typeof d.endFormObject,
        doFormObject: typeof d.doFormObject,
        Matrix: typeof d.Matrix,
        unitMatrix: Boolean(d.unitMatrix)
      };
    });
    console.log('jsPDF form capabilities', JSON.stringify(capabilities));

    const result = await page.evaluate(async () => {
      const doc = new jspdf.jsPDF({ unit:'pt', format:'a4' });
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(11);

      // Primo livello: deve restare nel getTextContent grezzo ma sparire dal modello VISIVO.
      doc.setTextColor(0,0,0);
      doc.text('TESTO-VECCHIO-COPERTO', 90, 120);

      // La cella successiva ridisegna un fondo opaco sopra al testo precedente.
      doc.setFillColor(255,255,255);
      doc.rect(70, 96, 280, 40, 'F');
      doc.setTextColor(0,0,0);
      doc.text('TESTO-NUOVO-VISIBILE', 90, 120);

      // Seconda colonna, per verificare che la ricomposizione non fonda zone lontane.
      doc.text('X', 430, 120);

      const bytes = new Uint8Array(doc.output('arraybuffer'));
      const parsed = await pdfjsLib.getDocument({ data:bytes }).promise;
      try {
        const p = await parsed.getPage(1);
        const raw = (await p.getTextContent()).items.map(i => i.str).join(' | ');
        const visual = await pdfImport._test.estraiTestoVisibileRenderizzato(p);
        return {
          raw,
          visual: visual.items.map(i => i.testo).join(' | '),
          visibleItems: visual.items,
          borders: visual.bordi.length
        };
      } finally {
        await parsed.destroy();
      }
    });

    assert.match(result.raw, /TESTO-VECCHIO-COPERTO/);
    assert.match(result.raw, /TESTO-NUOVO-VISIBILE/);
    assert.doesNotMatch(result.visual, /TESTO-VECCHIO-COPERTO/);
    assert.match(result.visual, /TESTO-NUOVO-VISIBILE/);
    assert.match(result.visual, /X/);
    assert.ok(result.visibleItems.length >= 2, JSON.stringify(result));

    const formResult = await page.evaluate(async () => {
      const doc = new jspdf.jsPDF({ unit:'pt', format:'a4' });
      doc.beginFormObject(0, 0, 595, 842, doc.unitMatrix);
      doc.setFontSize(11);
      doc.text('TESTO-DENTRO-FORM', 90, 120);
      doc.endFormObject('pagina-base');
      doc.doFormObject('pagina-base', doc.unitMatrix);
      const parsed = await pdfjsLib.getDocument({ data:new Uint8Array(doc.output('arraybuffer')) }).promise;
      try {
        const p = await parsed.getPage(1);
        const detected = await pdfImport._test.paginaHaFormClippatoGrande(p);
        const visual = await pdfImport._test.estraiTestoVisibileRenderizzato(p);
        return { detected, visual:visual.items.map(i => i.testo).join(' | ') };
      } finally {
        await parsed.destroy();
      }
    });
    assert.equal(formResult.detected, true, JSON.stringify(formResult));
    assert.match(formResult.visual, /TESTO-DENTRO-FORM/);

    console.log(JSON.stringify({ status:'PASS', ...result, formResult }, null, 2));
  } finally {
    await browser.close();
    server.close();
  }
})().catch((error) => {
  console.error(error);
  try { server.close(); } catch (_) {}
  process.exit(1);
});
