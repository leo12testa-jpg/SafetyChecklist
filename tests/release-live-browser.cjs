// Explicitly authorized production smoke test. Uses the published app without JS shims.
// Fresh Edge/Chrome profiles; only this run's named record may be written or removed.
// Run: RELEASE_LIVE=1 node tests/release-live-browser.cjs
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
if (process.env.RELEASE_LIVE !== '1') throw Error('Requires explicit RELEASE_LIVE=1');
const root = path.resolve(__dirname, '..');
const cache = path.join(process.env.LOCALAPPDATA, 'npm-cache/_npx');
const modules = fs.readdirSync(cache).map(d => path.join(cache,d,'node_modules/playwright'))
  .filter(p => fs.existsSync(path.join(p,'package.json')))
  .sort((a,b) => require(path.join(b,'package.json')).version.localeCompare(require(path.join(a,'package.json')).version,undefined,{numeric:true}));
const { chromium } = require(modules[0]);
const url = 'https://leo12testa-jpg.github.io/SafetyChecklist/';
const label = 'TEST-SYNC-20260925';
const expected = JSON.parse(fs.readFileSync(path.join(root,'version.json'))).buildId;
const out = path.join(root,'reports/release-live-20260925');
fs.mkdirSync(out,{recursive:true});
const report = {url,expected,label,tests:[],browsers:[],errors:[],blockedWrites:[],writtenIds:[]};
const devices = [];
let id, photoId;
function save() { fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(report,null,2)); }
async function check(name, fn) {
  try { await fn(); report.tests.push({name,status:'PASS'}); console.log('PASS',name); }
  catch(e) { report.tests.push({name,status:'FAIL',error:e.stack}); throw e; }
  finally { save(); }
}
async function open(channel) {
  const context = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(),'safety-live-'+channel+'-')),
    {channel,headless:true,acceptDownloads:true,viewport:{width:1200,height:900}});
  const page = context.pages()[0];
  const d = {context,page,channel}; devices.push(d);
  await context.route('**/documents:commit', async route => {
    const body = route.request().postDataJSON();
    for (const w of body.writes || []) {
      const target = (w.update?.name || w.delete || w.transform?.document || '').split('/').pop();
      if (!id && w.update?.fields?.punto_vendita?.stringValue === label) id = target;
      if (!id || target !== id) {
        report.blockedWrites.push({channel,target}); save(); return route.abort();
      }
      report.writtenIds.push(target);
    }
    return route.continue();
  });
  page.on('pageerror',e => {report.errors.push({channel,message:e.message});save();});
  page.on('dialog',async dialog => {report.errors.push({channel,dialog:dialog.message()});await dialog.dismiss();});
  await page.goto(url,{waitUntil:'load'});
  await page.waitForFunction(() => typeof db !== 'undefined' && typeof sync !== 'undefined');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(build => document.querySelector('#versione-app').textContent.includes(build),expected);
  const ua = await page.evaluate(() => navigator.userAgent);
  assert.ok(channel === 'msedge' ? ua.includes('Edg/') : ua.includes('Chrome/') && !ua.includes('Edg/'));
  report.browsers.push({channel,version:context.browser()?.version(),ua});
  return d;
}
async function record(d) { return d.page.evaluate(id => db.leggiSopralluogo(id),id); }
async function waitRecord(d, predicate) {
  const end = Date.now()+60000;
  while(Date.now()<end) { const r = await record(d); if(r && predicate(r)) return r; await new Promise(r=>setTimeout(r,250)); }
  throw Error('Timed out waiting for record on '+d.channel);
}
async function note(d,text) {
  if(!await d.page.locator('#nota-testo').isVisible()) await d.page.locator('#btn-note').click();
  await d.page.locator('#nota-testo').fill(text);
  await d.page.locator('#compilazione-domanda').click();
}
async function history(d) { await d.page.evaluate(() => router.navigate('history')); }
function row(d) { return d.page.locator('.storico-voce').filter({hasText:label}); }
async function banner(d) {
  await d.page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await d.page.waitForTimeout(700);
  assert.equal(await d.page.locator('#banner-aggiornamento').isVisible(),false);
  assert.equal(await d.page.locator('#banner-aggiornamento-bottone').isVisible(),false);
}
(async () => {
  const A = await open('msedge'), B = await open('chrome');
  await check('Edge + Chrome: published build and hidden update banner',async()=>{
    for(const d of devices) {
      assert.equal(await d.page.evaluate(async()=> (await(await fetch('version.json?t='+Date.now(),{cache:'no-store'})).json()).buildId),expected);
      await banner(d);
    }
  });
  await check('Edge creates record, answer and note -> Chrome realtime UI',async()=>{
    await history(B);
    await A.page.getByText('Nuovo sopralluogo',{exact:true}).click();
    await A.page.locator('#select-checklist').selectOption('interparking_sopralluogo');
    await A.page.locator('#input-punto-vendita').fill(label);
    await A.page.getByRole('button',{name:'INIZIA',exact:true}).click();
    await A.page.waitForFunction(()=>location.hash==='#compilazione');
    const created = await A.page.evaluate(()=>checklistEngine.sopralluogoCorrente().id);
    if(id) assert.equal(id,created); else id=created;
    report.id=id;save();
    await A.page.locator('input[name=risposta][value=C]').check();
    await note(A,'Nota Edge release 20260925');
    await waitRecord(B,r=>r.risposte.some(x=>x.domanda_id===1 && x.risposta==='C' && x.note==='Nota Edge release 20260925'));
    await row(B).waitFor();
    await row(B).getByRole('button',{name:'Modifica '+label,exact:true}).click();
    await B.page.locator('#btn-indietro').click(); // resume starts at the first unanswered question (2)
    await B.page.waitForFunction(()=>document.querySelector('input[name=risposta][value=C]').checked && document.querySelector('#nota-testo').value==='Nota Edge release 20260925');
    await B.page.screenshot({path:path.join(out,'chrome-received.png')});
  });
  await check('Chrome changes another answer -> Edge realtime UI',async()=>{
    await A.page.locator('#btn-avanti').click();
    await B.page.locator('#btn-avanti').click();
    await B.page.locator('input[name=risposta][value=PC]').check();
    await note(B,'Nota Chrome release 20260925');
    await waitRecord(A,r=>r.risposte.some(x=>x.domanda_id===2 && x.risposta==='PC' && x.note==='Nota Chrome release 20260925'));
    await A.page.waitForFunction(()=>document.querySelector('input[name=risposta][value=PC]').checked && document.querySelector('#nota-testo').value==='Nota Chrome release 20260925');
    await A.page.screenshot({path:path.join(out,'edge-received.png')});
  });
  await check('Photo through Edge file picker -> Chrome same fotoId and blob',async()=>{
    const image = await A.page.evaluate(()=>{const c=document.createElement('canvas');c.width=120;c.height=80;const x=c.getContext('2d');x.fillStyle='orange';x.fillRect(0,0,120,80);x.fillStyle='black';x.fillText('TEST SYNC',10,40);return c.toDataURL('image/jpeg').split(',')[1];});
    const chooser = A.page.waitForEvent('filechooser');
    await A.page.locator('#btn-foto').click();
    await (await chooser).setFiles({name:'test-sync.jpg',mimeType:'image/jpeg',buffer:Buffer.from(image,'base64')});
    const a = await waitRecord(A,r=>r.risposte.find(x=>x.domanda_id===2)?.foto?.length===1);
    photoId=a.risposte.find(x=>x.domanda_id===2).foto[0];report.photoId=photoId;save();
    await waitRecord(B,r=>r.risposte.find(x=>x.domanda_id===2)?.foto?.[0]===photoId && !!r.foto_url?.[photoId]);
    await B.page.waitForFunction(async f=>(await db.leggiFoto(f))?.blob?.size>0,photoId);
    const hashes=[];
    for(const d of devices) hashes.push(await d.page.evaluate(async f=>{const b=await(await db.leggiFoto(f)).blob.arrayBuffer();return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b))).join(',');},photoId));
    assert.equal(hashes[0],hashes[1]);
    await B.page.locator('#foto-domanda-lista img').first().waitFor();
    await B.page.screenshot({path:path.join(out,'chrome-photo.png')});
  });
  await check('Live PDF opens, renders and downloads in both browsers',async()=>{
    for(const d of devices) {
      await history(d);
      await row(d).getByRole('button',{name:'Apri',exact:true}).click();
      await d.page.waitForFunction(()=>Number(document.querySelector('.pdf-preview-overlay')?.dataset.renderedPages)>0);
      assert.ok(await d.page.locator('.pdf-preview-overlay canvas').count()>0);
      await d.page.screenshot({path:path.join(out,d.channel+'-pdf.png')});
      await d.page.getByRole('button',{name:'Chiudi anteprima PDF'}).click();
      const download = d.page.waitForEvent('download');
      await row(d).getByRole('button',{name:'Scarica',exact:true}).click();
      const dl=await download, file=path.join(out,d.channel+'.pdf');await dl.saveAs(file);
      assert.equal(await dl.failure(),null);assert.equal(fs.readFileSync(file).subarray(0,5).toString(),'%PDF-');
      const text = await d.page.evaluate(async id=>{
        const b=(await db.leggiPdfReport(id)).blob;
        const doc=await pdfjsLib.getDocument({data:new Uint8Array(await b.arrayBuffer())}).promise;
        let s='';for(let n=1;n<=doc.numPages;n++)s+=(await(await doc.getPage(n)).getTextContent()).items.map(x=>x.str).join(' ');
        await doc.destroy();return s;
      },id);
      assert.ok(text.includes(label));assert.ok(text.includes('Nota Edge release 20260925'));assert.ok(text.includes('Nota Chrome release 20260925'));
      assert.ok(!text.includes('Foto non disponibile al momento della generazione.'));
      await d.page.getByRole('button',{name:'Chiudi anteprima PDF'}).click();
    }
  });
  await check('Edge offline local save + reload -> online -> Chrome receives',async()=>{
    await row(A).getByRole('button',{name:'Modifica '+label,exact:true}).click();
    await A.page.locator('#btn-indietro').click(); // first unanswered is question 3
    await A.page.locator('#btn-indietro').click();
    await A.context.setOffline(true);
    await A.page.locator('input[name=risposta][value=NA]').check();
    await note(A,'Nota offline persistita 20260925');
    await waitRecord(A,r=>r.risposte.some(x=>x.domanda_id===1 && x.risposta==='NA' && x.note==='Nota offline persistita 20260925'));
    assert.equal((await record(B)).risposte.find(x=>x.domanda_id===1).risposta,'C');
    await A.page.reload({waitUntil:'load'});
    await waitRecord(A,r=>r.risposte.some(x=>x.domanda_id===1 && x.risposta==='NA' && x.note==='Nota offline persistita 20260925'));
    await A.context.setOffline(false);
    await waitRecord(B,r=>r.risposte.some(x=>x.domanda_id===1 && x.risposta==='NA' && x.note==='Nota offline persistita 20260925'));
  });
  await check('No lost answers/photos, no other record writes, no update loop',async()=>{
    for(const d of devices) {
      const r=await record(d);assert.equal(r.risposte.length,2);
      assert.equal(r.risposte.find(x=>x.domanda_id===2).note,'Nota Chrome release 20260925');
      assert.equal(r.risposte.find(x=>x.domanda_id===2).foto[0],photoId);
      let loads=0;d.page.on('load',()=>loads++);
      for(let n=0;n<3;n++) await banner(d);
      assert.equal(loads,0);
    }
    assert.deepEqual(report.errors,[]);assert.deepEqual(report.blockedWrites,[]);
    assert.ok(report.writtenIds.length>0);assert.ok(report.writtenIds.every(x=>x===id));
  });
  report.status='PASS';
})().catch(e=>{report.status='FAIL';report.error=e.stack;console.error(e);process.exitCode=1;})
.finally(async()=>{
  if(id && devices.length) {
    try {
      const A=devices[0];await A.context.setOffline(false);
      await A.page.evaluate(async ({id,label})=>{
        const r=await db.leggiSopralluogo(id);if(!r || r.punto_vendita!==label)throw Error('Cleanup target mismatch');
        await db.eliminaSopralluogo(id);await sync.sincronizzaCompleto();
        await fotoSync.eliminaFotoDiSopralluoghi([r]);
        const storage=supabase.createClient(SUPABASE_URL,SUPABASE_ANON_KEY).storage.from(SUPABASE_BUCKET);
        for(const entry of Object.values(r.foto_url || {})) {
          if(!entry.path.startsWith(id+'/')) throw Error('Unexpected photo cleanup path');
          const result=await storage.download(entry.path);
          if(!result.error || !/not found|does not exist/i.test(result.error.message)) throw Error('Photo deletion not confirmed');
        }
      },{id,label});
      for(const d of devices) await waitRecord(d,r=>r.eliminato_definitivamente===true);
      report.cleanup='PASS: only test record deleted (synced tombstone) and its storage photo removed';
    } catch(e) {report.cleanup='FAIL: '+e.stack;report.status='FAIL';process.exitCode=1;}
  }
  for(const d of devices) await d.context.close();
  save();console.log(report.status,report.cleanup);
});
