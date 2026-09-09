// Run with node tests/pdf-browser.cjs. Uses an existing Playwright installation;
// no runtime dependency or build step is added to the app.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const server = require('./pdf-local-server.cjs');
function playwright() {
  if (process.env.PLAYWRIGHT_MODULE) return require(process.env.PLAYWRIGHT_MODULE);
  try { return require('playwright'); } catch (_) {}
  const cache = path.join(process.env.LOCALAPPDATA || '', 'npm-cache', '_npx');
  const candidates = fs.readdirSync(cache).map(d => path.join(cache, d, 'node_modules', 'playwright'))
    .filter(p => fs.existsSync(path.join(p, 'package.json')))
    .sort((a, b) => require(path.join(b, 'package.json')).version.localeCompare(require(path.join(a, 'package.json')).version, undefined, { numeric: true }));
  if (!candidates.length) throw new Error('Playwright non disponibile: impostare PLAYWRIGHT_MODULE.');
  return require(candidates[0]);
}
function executable(name) {
  const base = path.join(process.env.LOCALAPPDATA || '', 'ms-playwright');
  if (!fs.existsSync(base)) return undefined;
  const dirs = fs.readdirSync(base).filter(d => d.startsWith(name + '-')).sort((a,b) => b.localeCompare(a, undefined, { numeric: true }));
  for (const dir of dirs) {
    const rel = name === 'chromium' ? ['chrome-win64/chrome.exe', 'chrome-win/chrome.exe'] : name === 'firefox' ? ['firefox/firefox.exe'] : ['Playwright.exe'];
    for (const r of rel) if (fs.existsSync(path.join(base, dir, r))) return path.join(base, dir, r);
  }
}
const out = path.resolve(__dirname, '../reports/pdf-verification');
fs.mkdirSync(out, { recursive: true });
const results = [];
async function run(name, browserType, origin) {
  let browser, context, page;
  const report = { browser: name, tests: [] };
  try {
    const options = { headless: true, executablePath: executable(name) };
    const contextOptions = { acceptDownloads: true, viewport: { width: 1100, height: 850 } };
    if (name === 'webkit') {
      // Windows WebKit's ephemeral context cannot persist Blob objects in IDB.
      const profile = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'safety-pdf-webkit-'));
      context = await browserType.launchPersistentContext(profile, { ...options, ...contextOptions });
      report.profile = 'isolated persistent test profile';
      report.version = context.browser()?.version() || 'WebKit';
    } else {
      browser = await browserType.launch(options);
      report.version = browser.version();
      context = await browser.newContext(contextOptions);
    }
    page = await context.newPage();
    page.setDefaultTimeout(20000);
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('dialog', d => d.accept());
    await context.route('**/*', route => route.request().url().startsWith(origin) || /^(blob:|data:)/.test(route.request().url()) ? route.continue() : route.abort());
    await page.goto(origin);
    await page.waitForFunction(() => typeof pdf !== 'undefined' && typeof importPreviewScreen !== 'undefined');
    await page.evaluate(() => {
      window.check = (value, message) => { if (!value) throw new Error(message); };
      window.roundtrip = async blob => {
        const bytes = await pdf.leggiArrayBuffer(blob);
        check(new TextDecoder().decode(bytes.slice(0, 5)) === '%PDF-', 'Invalid PDF header');
        const doc = await pdfjsLib.getDocument({ data: new Uint8Array(bytes), stopAtErrors: true }).promise;
        try {
          check(doc.numPages > 0, 'No pages');
          for (const n of new Set([1, doc.numPages])) {
            const p = await doc.getPage(n), vp = p.getViewport({ scale: 1 });
            const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height;
            await p.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
            check(c.getContext('2d').getImageData(0, 0, c.width, c.height).data.some((v, i) => i % 4 !== 3 && v < 230), 'Blank rendered page');
          }
          return doc.numPages;
        } finally { await doc.destroy(); }
      };
    });
    for (const client of ['coin', 'interparking', 'restage', 'melluso']) {
      const result = await page.evaluate(async client => {
        const checklist = await (await fetch(`checklists/${client}_sopralluogo.json`)).json();
        const record = await db.creaSopralluogo({ checklist_id: checklist.id, punto_vendita: `${client} verifica PDF`, data_sopralluogo: '2026-09-08', tecnico: 'Tecnico Test' });
        const photos = [];
        for (const [w, h, color] of [[180, 300, '#b63135'], [400, 180, '#30744c'], [240, 160, '#2a509c']]) {
          const c = document.createElement('canvas'); c.width = w; c.height = h;
          const ctx = c.getContext('2d'); ctx.fillStyle = color; ctx.fillRect(0, 0, w, h);
          ctx.fillStyle = 'white'; ctx.font = '22px sans-serif'; ctx.fillText(`${w} x ${h}`, 15, 40);
          const blob = await new Promise(resolve => c.toBlob(resolve, 'image/png'));
          photos.push(await db.salvaFoto({ sopralluogo_id: record.id, blob }));
        }
        const questions = checklist.sezioni.flatMap(s => s.domande);
        record.risposte = questions.map((q, i) => ({ domanda_id: q.id, risposta: ['C','PC','NC','NA'][i % 4], note: i === 3 ? 'Nota lunga verificata. '.repeat(170) + 'FINE-NOTA' : 'Nota breve.', foto: i === 0 ? photos.slice(0,2) : [] }));
        record.altri_aspetti_foto = photos.slice(2);
        record.altri_aspetti_foto_didascalie = { [photos[2]]: 'Didascalia originale mantenuta' };
        const blob = await pdf.generaReport(checklist, record);
        const pages = await roundtrip(blob);
        window.fixture = { checklist, record, blob };
        const extracted = await pdfImport.estraiRighe(blob);
        for (const answer of record.risposte) {
          const row = extracted.righe.find(r => Number(r.id_originale) === Number(answer.domanda_id));
          check(row, `Missing source row ${answer.domanda_id}`);
          check(row.stato_originale === answer.risposta, `Wrong state on ${answer.domanda_id}: ${row.stato_originale}`);
          const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
          check(clean(row.nota_originale).startsWith(clean(answer.note)), `Note lost or shifted on ${answer.domanda_id}`);
          check(answer.note.includes('FINE-NOTA') || !String(row.nota_originale).includes('FINE-NOTA'), `Neighbor note on ${answer.domanda_id}`);
        }
        check(extracted.immagini.length === 3, `Expected 3 photos, found ${extracted.immagini.length}`);
        check(extracted.immagini.every(p => p.metodo === 'originale'), 'Original XObjects not used');
        check(extracted.immagini.some(p => p.altezza > p.larghezza), 'Portrait missing');
        check(extracted.immagini.some(p => p.didascalia.includes('Didascalia originale mantenuta')), 'Caption missing');
        window.extracted = extracted;
        return { pages, photos: extracted.immagini.map(p => ({ width:p.larghezza, height:p.altezza, caption:p.didascalia, method:p.metodo })), bytes: Array.from(new Uint8Array(await pdf.leggiArrayBuffer(blob))) };
      }, client);
      fs.writeFileSync(path.join(out, `${name}-${client}.pdf`), Buffer.from(result.bytes));
      delete result.bytes;
      report.tests.push({ client, ...result });
    }
    // Exact orphan reproduction: only 24 mm remain, enough for the two head rows
    // but not for the first complete row (a multi-line note).
    const boundary = await page.evaluate(async () => {
      const doc = new jspdf.jsPDF({ unit: 'mm', format: 'a4' });
      const layout = pdf._test.creaLayout(doc);
      doc.text('Fine della sezione precedente', 15, 252);
      const section = { titolo: 'SEZIONE-REGRESSIONE', domande: [{ id: 999, testo: 'PRIMA-RIGA-COMPLETA' }] };
      pdf._test.disegnaTabellaSezione(doc, layout, section, { risposte: [{ domanda_id: 999, risposta: 'NC', note: 'Nota della prima riga. '.repeat(35) + 'FINE-PRIMA-RIGA' }] }, 258, new Map(), () => {});
      const blob = new Blob([doc.output('arraybuffer')], { type:'application/pdf' });
      const parsed = await pdfjsLib.getDocument({ data:new Uint8Array(await blob.arrayBuffer()) }).promise;
      const text = [];
      for(let n=1;n<=parsed.numPages;n++) text.push((await (await parsed.getPage(n)).getTextContent()).items.map(i=>i.str).join(' '));
      check(!text[0].includes('SEZIONE-REGRESSIONE') && !text[0].includes('Descrizione'), 'Orphan head on page 1');
      check(text[1].includes('SEZIONE-REGRESSIONE') && text[1].includes('PRIMA-RIGA-COMPLETA') && text[1].includes('FINE-PRIMA-RIGA'), 'First complete row not kept with head');
      const p = await parsed.getPage(2), vp = p.getViewport({ scale: 1.4 });
      const canvas = document.createElement('canvas'); canvas.width=vp.width;canvas.height=vp.height;
      await p.render({ canvasContext:canvas.getContext('2d'),viewport:vp }).promise;
      const png = canvas.toDataURL(); await parsed.destroy();
      return { png, bytes:Array.from(new Uint8Array(await blob.arrayBuffer())), text };
    });
    fs.writeFileSync(path.join(out, `${name}-tabella-corretta.png`), Buffer.from(boundary.png.split(',')[1],'base64'));
    fs.writeFileSync(path.join(out, `${name}-tabella-limite.pdf`), Buffer.from(boundary.bytes));
    report.tests.push({ boundary:'pass', pages:boundary.text.length });
    // Confirm real preview removal using the actual UI and IndexedDB implementation.
    await page.evaluate(async () => {
      const { checklist } = fixture;
      const matching = importMatching.abbinaRighe(extracted.righe, checklist, { puntoDivisioneGruppi:pdf.calcolaPuntoDivisioneGruppi(checklist) });
      window.beforeImport = (await db.elencaSopralluoghi()).length;
      anteprimaImportazionePendente = { ...extracted, ...matching, checklist, rilevamentoAutomatico:true, checklistTitolo:checklist.titolo, bozzaAnagrafica:{ checklist_id:checklist.id, punto_vendita:'Importazione test', tecnico:'Test' } };
      router.navigate('import-preview');
      check((await db.elencaSopralluoghi()).length === beforeImport, 'Preview persisted a record');
    });
    await page.locator('#import-immagini button').first().click();
    assert.equal(await page.locator('#import-immagini img').count(), 2);
    await page.locator('#import-immagini').screenshot({ path:path.join(out, `${name}-anteprima-rimozione.png`) });
    await page.locator('#btn-conferma-import').click();
    await page.waitForFunction(() => anteprimaImportazionePendente === null);
    report.tests.push(await page.evaluate(async () => {
      const records = await db.elencaSopralluoghi();
      check(records.length === beforeImport + 1, 'Import should create one inspection');
      const imported = records.find(r => r.punto_vendita === 'Importazione test');
      check(imported.altri_aspetti_foto.length === 2, 'Removed image was saved');
      check(checklistEngine.sopralluogoCorrente().risposte.length === imported.risposte.length, 'Imported answers missing from the active inspection');
      for (const id of imported.altri_aspetti_foto) check((await db.leggiFoto(id)).blob.size > 0, 'Photo blob missing');
      return { previewRemoval:'pass', confirmedPhotos:2 };
    }));
    // Force precise region rendering fallback and test supplied historical PDFs.
    report.tests.push(await page.evaluate(async () => {
      const cropped = await pdfImport.estraiRighe(fixture.blob, { forzaCrop:true });
      check(cropped.immagini.length === 3 && cropped.immagini.every(p=>p.metodo==='crop'), 'Crop fallback failed');
      const historical = [];
      for (const file of ['esempio_formato_storico_coin.pdf','restage_reale.pdf.pdf']) {
        const blob = await (await fetch(`test-sample/${file}`)).blob();
        const result = await pdfImport.estraiRighe(blob);
        check(result.immagini.length === (file.startsWith('esempio') ? 0 : 5), 'Historical photo count incorrect');
        if (file.startsWith('restage')) result.immagini.forEach((p,i) => {
          check(p.didascalia.startsWith(`Foto ${i+1}`), 'Wrong caption association');
          check(!p.didascalia.includes(`Foto ${i+2}`), 'Neighbor column leaked into caption');
        });
        historical.push({ file, rows:result.righe.length, photos:result.immagini.length, captions:result.immagini.map(p=>p.didascalia) });
      }
      return { crop:'pass', historical };
    }));
    report.tests.push(await page.evaluate(async () => {
      const doc=new jspdf.jsPDF();
      doc.addPage();
      doc.addImage(extracted.immagini[0].anteprima,'PNG',20,50,40,65);
      const parsed=await pdfjsLib.getDocument({data:new Uint8Array(doc.output('arraybuffer'))}).promise;
      try {
        const images=await pdfImport.estraiImmaginiPagina(await parsed.getPage(2),[],2);
        check(images.length===1 && images[0].didascalia==='', 'Captionless portrait not preserved');
      } finally {await parsed.destroy();}
      let rejected=false;
      try {await roundtrip(new Blob(['%PDF-1.4\nTHIS IS NOT A VALID PDF']));} catch (_) {rejected=true;}
      check(rejected,'Roundtrip accepted a corrupt PDF');
      return { withoutCaption:'pass', invalidPdfRejected:'pass' };
    }));

    // Real upload -> detection -> preview -> removal -> confirmation -> editable photos.
    console.log(`${name}: testing real file upload`);
    await page.evaluate(() => router.navigate('new-inspection'));
    await page.waitForFunction(() => document.querySelector('#select-checklist').options.length > 0);
    await page.locator('#input-importa-pdf').setInputFiles(path.resolve(__dirname,'../test-sample/restage_reale.pdf.pdf'));
    await page.waitForFunction(() => anteprimaImportazionePendente && anteprimaImportazionePendente.immagini.length===5);
    await page.locator('#screen-new-inspection button[type=submit]').click();
    await page.waitForSelector('#screen-import-preview:not([hidden])');
    assert.equal(await page.locator('#import-immagini img').count(),5);
    await page.locator('#import-immagini').screenshot({path:path.join(out,`${name}-restage-foto-prima.png`)});
    await page.locator('#import-immagini button').first().click();
    await page.locator('#import-immagini').screenshot({path:path.join(out,`${name}-restage-foto-rimossa.png`)});
    const confirmDetection=page.locator('#import-conferma-rilevamento');
    if(await confirmDetection.count()) await confirmDetection.check();
    const expectedPhotos = await page.evaluate(() => anteprimaImportazionePendente.immagini.map(f => ({ domanda: f.domanda_id_collegata, didascalia: f.didascalia })));
    await page.locator('#btn-conferma-import').click();
    await page.waitForFunction(()=>anteprimaImportazionePendente===null);
    report.tests.push(await page.evaluate(async(expectedPhotos)=>{
      const record=checklistEngine.sopralluogoCorrente();
      const ids = idFotoSopralluogo(record);
      check(ids.length===4,'Real Restage: wrong total photo count after removal');
      for (const expected of expectedPhotos) {
        const response = record.risposte.find(r => Number(r.domanda_id) === Number(expected.domanda));
        check(expected.domanda == null || response?.foto.length > 0, 'Photo lost its question');
      }
      for (const response of record.risposte) for (const id of response.foto || []) {
        check(Number((await db.leggiFoto(id)).domanda_id) === Number(response.domanda_id), 'Photo record linked to wrong question');
      }
      const blob=await pdf.generaReport(checklistEngine.getChecklist(),record);
      const pages=await roundtrip(blob);
      window.reimportedBlob=blob;
      return {realRestageImport:'pass',confirmedPhotos:4,pages};
    }, expectedPhotos));
    const realBytes=await page.evaluate(() => new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(reimportedBlob);
    }));
    fs.writeFileSync(path.join(out,`${name}-restage-reimportato.pdf`),Buffer.from(realBytes, 'base64'));
    await page.evaluate(() => pdf.apri(fixture.blob, 'preview.pdf', null));
    assert.ok(await page.locator('.pdf-preview-overlay canvas').count() > 1);
    await page.locator('.pdf-preview-overlay button').first().click();
    const downloadPromise = page.waitForEvent('download');
    await page.evaluate(() => pdf.scarica(fixture.blob, 'download.pdf'));
    const download = await downloadPromise;
    await download.saveAs(path.join(out, `${name}-download.pdf`));
    assert.equal(fs.readFileSync(path.join(out, `${name}-download.pdf`)).subarray(0,5).toString(), '%PDF-');
    // Missing URL/File/share/Blob.arrayBuffer must still permit a real download.
    const fallbackDownloadPromise=page.waitForEvent('download');
    await page.evaluate(async()=>{
      const original={create:URL.createObjectURL,File:window.File,open:window.open,array:Blob.prototype.arrayBuffer};
      const share=Object.getOwnPropertyDescriptor(navigator,'share');
      const canShare=Object.getOwnPropertyDescriptor(navigator,'canShare');
      try {
        URL.createObjectURL=undefined;window.File=undefined;window.open=undefined;Blob.prototype.arrayBuffer=undefined;
        Object.defineProperty(navigator,'share',{value:undefined,configurable:true});
        Object.defineProperty(navigator,'canShare',{value:()=>true,configurable:true});
        check(pdf.prenotaFinestra()===null,'Missing open should return null');
        check((await pdf.leggiArrayBuffer(fixture.blob)).byteLength>5,'FileReader fallback failed');
        await pdf.salvaOCondividi(fixture.blob,'fallback.pdf');
      } finally {
        URL.createObjectURL=original.create;window.File=original.File;window.open=original.open;Blob.prototype.arrayBuffer=original.array;
        if(share) Object.defineProperty(navigator,'share',share);else delete navigator.share;
        if(canShare) Object.defineProperty(navigator,'canShare',canShare);else delete navigator.canShare;
      }
    });
    const fallbackDownload=await fallbackDownloadPromise;
    await fallbackDownload.saveAs(path.join(out,`${name}-fallback-download.pdf`));
    assert.equal(fs.readFileSync(path.join(out,`${name}-fallback-download.pdf`)).subarray(0,5).toString(),'%PDF-');
    report.tests.push({forcedMissingApis:'pass'});
    report.tests.push({ preview:'pass', download:'pass', errors });
    assert.deepEqual(errors, [], 'Browser JavaScript errors');
    report.status = 'PASS';
  } catch (e) {
    report.status = 'FAIL'; report.error = e.stack; process.exitCode = 1;
    if(page) {
      report.visibleText=(await page.locator('body').innerText().catch(()=> 'unavailable')).slice(-4000);
      await page.screenshot({path:path.join(out,`${name}-failure.png`)}).catch(()=>{});
    }
  }
  finally { if (context) await context.close(); if (browser) await browser.close(); }
  results.push(report);
  fs.writeFileSync(path.join(out, 'browser-results.json'), JSON.stringify(results,null,2));
  console.log(`${name}: ${report.status} (${report.tests.length} checks)${report.error ? '\n'+report.error : ''}`);
}
(async()=> {
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin = `http://127.0.0.1:${server.address().port}/`;
  try {
    const pw=playwright();
    for(const name of (process.env.PDF_BROWSERS || 'chromium,firefox,webkit').split(',')) {
      // Firefox 131 in the local cache requires its matching protocol client.
      let type = pw[name];
      const legacy = path.join(process.env.LOCALAPPDATA || '', 'npm-cache/_npx/5c6d8c4f680fcd0a/node_modules/playwright');
      if (name === 'firefox' && executable(name)?.includes('1465') && fs.existsSync(legacy)) type = require(legacy).firefox;
      await run(name,type,origin);
    }
  }
  finally { server.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;server.close();});
