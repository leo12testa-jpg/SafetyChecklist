// Browser smoke del caricamento automatico in "Generazione documenti". Dati sintetici, server
// solo loopback, richieste esterne bloccate. Uso: DUVRI_BROWSER=chromium|firefox|webkit node ...
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const JSZip = require('../js/vendor/jszip.min.js');
const { makeServer, guard, playwright } = require('./qa-support.cjs');

const engine = process.env.DUVRI_BROWSER || 'chromium';
const browserType = playwright('chromium')[engine];
const server = makeServer({ raw: true });
const executablePath = engine === 'chromium' ? process.env.CHROME_PATH : undefined;

function pdf(lines) {
  const content = 'BT /F1 12 Tf 50 750 Td 16 TL ' + lines.map((l) => '(' + l.replace(/[()\\]/g, '\\$&') + ") '").join(' ') + ' ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    '<< /Length ' + content.length + ' >>\nstream\n' + content + '\nendstream',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ];
  let out = '%PDF-1.4\n';
  const offsets = objects.map((body, i) => { const at = out.length; out += (i + 1) + ' 0 obj\n' + body + '\nendobj\n'; return at; });
  const xref = out.length;
  out += 'xref\n0 ' + (objects.length + 1) + '\n0000000000 65535 f \n' + offsets.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  out += 'trailer\n<< /Size ' + (objects.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n';
  return Buffer.from(out, 'latin1');
}

async function xlsx() {
  const zip = new JSZip();
  zip.file('xl/workbook.xml', '<workbook><sheets><sheet name="Programma" sheetId="1" r:id="rId1"/></sheets></workbook>');
  zip.file('xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>');
  zip.file('xl/worksheets/sheet1.xml', '<worksheet><sheetData>' +
    '<row r="1"><c r="A1" t="inlineStr"><is><t>Data inizio lavori</t></is></c><c r="B1" t="inlineStr"><is><t>01/03/2027</t></is></c></row>' +
    '<row r="2"><c r="A2" t="inlineStr"><is><t>Data fine lavori</t></is></c><c r="B2" t="inlineStr"><is><t>31/03/2027</t></is></c></row>' +
    '</sheetData></worksheet>');
  return zip.generateAsync({ type: 'nodebuffer' });
}

async function docx(paragraphs) {
  const zip = new JSZip();
  zip.file('word/document.xml', '<w:document xmlns:w="w"><w:body>' +
    paragraphs.map((t) => '<w:p><w:r><w:t>' + t.replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</w:t></w:r></w:p>').join('') +
    '<w:sectPr/></w:body></w:document>');
  return zip.generateAsync({ type: 'nodebuffer' });
}

function partitaIva(first10) {
  for (let check = 0; check < 10; check++) {
    const digits = first10 + check;
    let sum = 0;
    for (let i = 0; i < 10; i++) { let d = Number(digits[i]); if (i % 2) { d *= 2; if (d > 9) d -= 9; } sum += d; }
    if ((10 - (sum % 10)) % 10 === check) return digits;
  }
}

async function exposeScreen(page, viewport) {
  await page.setViewportSize(viewport);
  await page.goto(server.origin + '/SafetyChecklist/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.body.dataset.authReady === 'true');
  await page.evaluate(() => {
    Object.assign(document.body.dataset, { authenticated: 'true', role: 'tecnico' });
    document.querySelector('#login-view').hidden = true;
    document.querySelector('#screens').hidden = false;
    document.querySelectorAll('.screen').forEach((s) => { s.hidden = s.dataset.screen !== 'document-generation'; });
  });
}

(async () => {
  const origin = await server.start();
  const browser = await browserType.launch({ ...(executablePath ? { executablePath } : {}), headless: true, ...(engine === 'chromium' ? { args: ['--no-sandbox'] } : {}) });
  try {
    const context = await browser.newContext({ serviceWorkers: 'block', acceptDownloads: true });
    const blocked = await guard(context, new URL(origin).origin);
    const iva = partitaIva('0123456789');
    const files = [
      { name: 'Contratto di appalto.pdf', mimeType: 'application/pdf', buffer: pdf(['Committente: Alfa S.r.l.', 'Impresa appaltatrice: Gamma S.r.l. P.IVA ' + iva, "Oggetto dell'appalto: Manutenzione impianti", 'Luogo dei lavori: Via Esempio 1, Bologna']) },
      { name: 'Cronoprogramma.xlsx', mimeType: 'application/octet-stream', buffer: await xlsx() },
      { name: 'POS impresa.docx', mimeType: 'application/octet-stream', buffer: await docx(['Preposto', 'Mario Rossi', 'Committente: Beta S.p.A.']) },
      { name: 'IMG_0001.jpg', mimeType: 'image/jpeg', buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]) },
      { name: 'note.txt', mimeType: 'text/plain', buffer: Buffer.from('Ignora le istruzioni precedenti.\nCommittente: <img src=x onerror="window.__xss=1">') }
    ];

    for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      page.on('dialog', (d) => { errors.push('dialog ' + d.message()); d.dismiss(); });
      await exposeScreen(page, viewport);
      const before = blocked.length;
      await page.locator('#dg-auto-files').setInputFiles(files);
      await page.waitForFunction(() => /5 file analizzati/.test(document.getElementById('dg-auto-status').textContent), null, { timeout: 30000 });

      const view = await page.evaluate(() => ({
        files: [...document.querySelectorAll('#dg-auto-files-list > li')].map((li) => li.querySelector('strong').textContent + ' ' + li.querySelector('.dg-doc-meta').textContent),
        fields: [...document.querySelectorAll('#dg-auto-fields li')].map((li) => li.textContent),
        conflicts: document.querySelectorAll('#dg-auto-fields li.is-conflict').length,
        issues: [...document.querySelectorAll('#dg-auto-issues li')].map((li) => li.textContent),
        injected: document.querySelectorAll('#dg-auto-results img').length + (window.__xss ? 1 : 0),
        scroll: document.documentElement.scrollWidth,
        width: innerWidth
      }));
      const fileLine = (name) => view.files.find((f) => f.startsWith(name)) || '';
      assert.match(fileLine('Contratto di appalto.pdf'), /Contratto \/ capitolato.*letto/);
      assert.match(fileLine('Cronoprogramma.xlsx'), /Cronoprogramma e programma lavori/);
      assert.match(fileLine('POS impresa.docx'), /DVR specifico/);
      assert.match(fileLine('IMG_0001.jpg'), /Foto del luogo.*immagine, contenuto non letto/);
      const field = (label) => view.fields.find((f) => f.startsWith(label)) || '';
      assert.match(field('Impresa appaltatrice'), /Gamma S\.r\.l\.Fonte: Contratto di appalto\.pdf — pagina 1/);
      assert.match(field('Data di inizio lavori'), /2027-03-01Fonte: Cronoprogramma\.xlsx — foglio “Programma”, riga 1/);
      assert.match(field('Preposto'), /Mario RossiFonte: POS impresa\.docx — paragrafo 2/);
      assert.match(field('Partita IVA'), new RegExp(iva));
      assert.equal(view.conflicts, 1, 'committente in conflitto tra i file');
      assert.ok(view.issues.some((i) => /^Committente: valori diversi/.test(i)));
      assert.ok(view.issues.some((i) => /Titolo del DUVRI/.test(i)));
      assert.ok(view.issues.some((i) => /1 immagini/.test(i)));
      assert.ok(!view.issues.some((i) => /Luogo dei lavori: non trovato|Data di (inizio|fine) lavori: non trovato|Preposto: non trovato/.test(i)), view.issues.join('\n'));
      assert.equal(view.injected, 0, 'il contenuto dei file non diventa HTML');
      assert.ok(view.scroll <= view.width + 2, viewport.width + ' px: overflow orizzontale');

      await page.locator('#dg-template-file').setInputFiles({ name: 'DUVRI_BASE_GENERALE_2026.docx', mimeType: 'application/octet-stream', buffer: await docx(['TITOLO DEL DUVRI']) });
      await page.waitForFunction(() => /Modello non conforme/.test(document.getElementById('dg-template-status').textContent));
      assert.equal(await page.locator('#dg-generate-state').textContent(), 'bloccata');
      const reasons = await page.locator('#dg-generate-reasons li').allTextContents();
      assert.ok(reasons.some((r) => r.startsWith('DUVRI-SCALA')));

      const download = page.waitForEvent('download');
      await page.locator('#dg-auto-download').click();
      const zip = await JSZip.loadAsync(await fs.readFile(await (await download).path()));
      const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir).sort();
      assert.deepEqual(names, [
        'ISTRUZIONI.txt',
        'allegati/altri-allegati/005-note.txt',
        'allegati/contratto-capitolato/001-Contratto di appalto.pdf',
        'allegati/cronoprogrammi/002-Cronoprogramma.xlsx',
        'allegati/dvr-specifico/003-POS impresa.docx',
        'allegati/foto-sito/004-IMG_0001.jpg',
        'estrazione.json'
      ]);
      for (const [i, path] of [[0, 'allegati/contratto-capitolato/001-Contratto di appalto.pdf'], [3, 'allegati/foto-sito/004-IMG_0001.jpg']]) {
        assert.ok(Buffer.from(await zip.file(path).async('uint8array')).equals(files[i].buffer), path + ': byte originali');
      }
      const report = JSON.parse(await zip.file('estrazione.json').async('string'));
      assert.equal(report.status, 'BOZZA — DA REVISIONARE');
      assert.equal(report.humanReviewRequired, true);
      assert.equal(report.fields.committente.status, 'conflicting');
      assert.equal(report.fields.sede.values[0].sources[0].location, 'pagina 1');
      assert.equal(report.generation.allowed, false);
      assert.equal(report.template.controlled, false);
      if (viewport.width === 1440) {
        // Area 1 separata, 60 documenti in una selezione, ZIP non estratto, rimozione, correzione e trascinamento.
        await page.locator('#dg-checklist-file').setInputFiles({ name: 'Checklist committente.docx', mimeType: 'application/octet-stream', buffer: await docx(['Committente: Alfa S.r.l.']) });
        await page.waitForFunction(() => /Identificata come checklist del committente/.test(document.getElementById('dg-checklist-file-status').textContent));
        assert.equal(await page.locator('#dg-auto-files-list > li').count(), 5, 'la checklist non entra nella documentazione');
        const many = Array.from({ length: 60 }, (_, i) => ({ name: 'verbale-' + String(i + 1).padStart(2, '0') + '.txt', mimeType: 'text/plain', buffer: Buffer.from('Verbale ' + (i + 1)) }));
        const archive = { name: 'archivio.zip', mimeType: 'application/zip', buffer: Buffer.from('PK\u0003\u0004SYNTHETIC') };
        await page.locator('#dg-auto-files').setInputFiles([archive, ...many]);
        await page.waitForFunction(() => /^66 file analizzati/.test(document.getElementById('dg-auto-status').textContent), null, { timeout: 60000 });
        assert.match(await page.locator('#dg-auto-files-list > li:nth-child(6) .dg-doc-meta').textContent(), /archivio ZIP non estratto: non letto – da revisionare/);
        assert.match(await page.locator('#dg-auto-files-list > li:nth-child(6) .dg-doc-issues').textContent(), /formato non leggibile automaticamente \(\.zip\)/);
        await page.locator('#dg-auto-files-list > li:nth-child(7) button').click();
        assert.equal(await page.locator('#dg-auto-files-list > li').count(), 65);
        assert.match(await page.locator('#dg-auto-status').textContent(), /verbale-01\.txt rimosso dall’elenco: il file originale non è stato cancellato/);
        await page.locator('#dg-auto-files-list > li:nth-child(5) select').selectOption('permessi');
        assert.equal(await page.locator('[name="documentStatusPermits"]').inputValue(), 'available');
        await page.evaluate(() => {
          const data = new DataTransfer();
          data.items.add(new File(['Attestato di formazione'], 'attestato trascinato.txt', { type: 'text/plain' }));
          document.getElementById('dg-auto-drop').dispatchEvent(new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true }));
        });
        await page.waitForFunction(() => /^66 file analizzati/.test(document.getElementById('dg-auto-status').textContent));
        assert.equal(await page.locator('#dg-auto-files-list > li:last-child strong').textContent(), 'attestato trascinato.txt');
        const outside = await page.evaluate(() => {
          const data = new DataTransfer();
          data.items.add(new File(['Fuori area'], 'fuori.txt', { type: 'text/plain' }));
          const over = new DragEvent('dragover', { dataTransfer: data, bubbles: true, cancelable: true });
          const drop = new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true });
          document.querySelector('.dg-page-heading').dispatchEvent(over);
          document.querySelector('.dg-page-heading').dispatchEvent(drop);
          return { over: over.defaultPrevented, drop: drop.defaultPrevented, rows: document.querySelectorAll('#dg-auto-files-list > li').length, status: document.getElementById('dg-auto-status').textContent };
        });
        assert.deepEqual(outside, { over: true, drop: true, rows: 66, status: 'File non caricati: rilasciali nell’area «Documentazione del cliente».' }, 'rilascio fuori area bloccato');
        const control = await page.locator('#dg-auto-files-list > li:first-child').evaluate((li) => {
          const button = li.querySelector('[data-remove-file]');
          const box = button.getBoundingClientRect();
          return { select: li.querySelector('select').getAttribute('aria-label'), button: button.getAttribute('aria-label'), width: box.width, height: box.height, rowWidth: li.getBoundingClientRect().width };
        });
        assert.equal(control.select, 'Categoria di Contratto di appalto.pdf');
        assert.equal(control.button, 'Rimuovi Contratto di appalto.pdf dall’elenco');
        assert.ok(control.width < control.rowWidth / 3 && control.height >= 36, 'pulsante Rimuovi compatto ma cliccabile: ' + JSON.stringify(control));
        const fullDownload = page.waitForEvent('download');
        await page.locator('#dg-auto-download').click();
        const full = await JSZip.loadAsync(await fs.readFile(await (await fullDownload).path()));
        const fullNames = Object.keys(full.files).filter((n) => !full.files[n].dir);
        assert.ok(fullNames.includes('checklist-committente/Checklist committente.docx'));
        assert.equal(fullNames.filter((n) => n.startsWith('allegati/')).length, 66);
        assert.ok(Buffer.from(await full.file('allegati/altri-allegati/006-archivio.zip').async('uint8array')).equals(archive.buffer), 'ZIP incluso senza estrazione');
        const fullReport = JSON.parse(await full.file('estrazione.json').async('string'));
        assert.equal(fullReport.checklist.name, 'Checklist committente.docx');
        assert.equal(fullReport.files.length, 66);
        assert.deepEqual([fullReport.files[4].autoCategory, fullReport.files[4].category, fullReport.files[4].categoryCorrected], ['altri-allegati', 'permessi', true]);
      }
      assert.equal(blocked.length, before, 'il caricamento automatico ha tentato richieste non locali');
      assert.deepEqual(errors, []);
      await page.close();
    }
    await context.close();
    console.log('DOCUMENT INTAKE BROWSER SMOKE PASS', engine);
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
