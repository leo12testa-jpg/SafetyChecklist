// Real installed Edge, never substituted with Playwright Chromium.
// node tests/pdf-edge.cjs; PDF_EDGE_BASELINE is recorded separately before fixes.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const server = require('./pdf-local-server.cjs');
const cache = path.join(process.env.LOCALAPPDATA, 'npm-cache/_npx');
const candidates = fs.readdirSync(cache).map(d => path.join(cache,d,'node_modules/playwright'))
  .filter(p => fs.existsSync(path.join(p,'package.json')))
  .sort((a,b) => require(path.join(b,'package.json')).version.localeCompare(require(path.join(a,'package.json')).version,undefined,{numeric:true}));
let pw = require(process.env.PLAYWRIGHT_MODULE || candidates[0]);
const engine = process.env.PDF_ENGINE || 'msedge';
const browserCache = path.join(process.env.LOCALAPPDATA,'ms-playwright');
function executable(name) {
  const dirs=fs.readdirSync(browserCache).filter(d=>d.startsWith(name+'-')).sort((a,b)=>b.localeCompare(a,undefined,{numeric:true}));
  for(const dir of dirs) for(const rel of name==='chromium'?['chrome-win64/chrome.exe','chrome-win/chrome.exe']:name==='firefox'?['firefox/firefox.exe']:['Playwright.exe']) {
    const file=path.join(browserCache,dir,rel);if(fs.existsSync(file)) return file;
  }
}
if(engine==='firefox' && executable(engine)?.includes('1465')) pw=require(path.join(cache,'5c6d8c4f680fcd0a/node_modules/playwright'));
const out = path.resolve(__dirname,`../reports/${engine}-pdf`);
fs.mkdirSync(out,{recursive:true});
const report = { tests:[], consoleErrors:[], pageErrors:[], downloads:[], popups:[], blobUrls:[] };
(async () => {
  await new Promise(r => server.listen(0,'127.0.0.1',r));
  const origin = `http://127.0.0.1:${server.address().port}/`;
  let browser;
  const watchdog=setTimeout(()=>{report.status='FAIL';report.error='Browser verification exceeded 10 minutes';fs.writeFileSync(path.join(out,'timeout.json'),JSON.stringify(report,null,2));process.exit(1);},600000);
  try {
    const options=engine==='msedge'?{channel:'msedge',headless:false}:{executablePath:executable(engine),headless:true};
    const contextOptions={acceptDownloads:true,viewport:{width:1100,height:850}};
    let context;
    if(engine==='webkit') {
      const profile=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'safety-pdf-compat-'));
      context=await pw.webkit.launchPersistentContext(profile,{...options,...contextOptions});
      browser={close:()=>context.close()};
      report.version=context.browser()?.version() || 'WebKit';
    } else {
      browser=await pw[engine==='msedge'?'chromium':engine].launch(options);
      report.version=browser.version();
      context=await browser.newContext(contextOptions);
    }
    report.browser=engine;
    console.log(engine+' launched '+report.version);
    const page = await context.newPage();
    console.log(engine+' page created');
    page.setDefaultTimeout(20000);
    await context.route('**/*',route=>route.request().url().startsWith(origin)||/^(blob:|data:)/.test(route.request().url())?route.continue():route.abort());
    page.on('console',m => { if(m.type()==='error') report.consoleErrors.push(m.text()); });
    page.on('pageerror',e => report.pageErrors.push(e.message));
    page.on('popup',p => report.popups.push(p.url()));
    page.on('download',d => report.downloads.push({name:d.suggestedFilename(),url:d.url()}));
    await page.goto(origin);
    console.log(engine+' app loaded');
    report.capabilities = await page.evaluate(() => ({
      userAgent:navigator.userAgent,pdfViewerEnabled:navigator.pdfViewerEnabled,
      share:typeof navigator.share,canShare:typeof navigator.canShare,
      createObjectURL:typeof URL.createObjectURL,anchorDownload:'download' in HTMLAnchorElement.prototype,
      showSaveFilePicker:typeof window.showSaveFilePicker
    }));
    if(engine==='msedge') assert.match(report.capabilities.userAgent,/Edg\//);
    await page.evaluate(() => {
      window.actionError=null;
      window.createdPdfUrls=[];
      const original=URL.createObjectURL;
      URL.createObjectURL=function(blob){const url=original.call(this,blob);createdPdfUrls.push(url);return url;};
      window.normalCreate=URL.createObjectURL;
      window.shareCalls=0;
      const controls=document.createElement('div');
      controls.id='pdf-test-controls';
      for(const [id,text,fn] of [
        ['test-open','Apri PDF',()=>pdf.apri(fixture.blob,fixture.filename,pdf.prenotaFinestra())],
        ['test-download','Scarica',()=>pdf.salvaOCondividi(fixture.blob,fixture.filename)]
      ]) {const b=document.createElement('button');b.id=id;b.textContent=text;b.onclick=()=>{window.actionError=null;fn().catch(e=>window.actionError=e.message);};controls.append(b);}
      document.body.prepend(controls);
    });
    async function visible() {
      await page.waitForFunction(() => document.querySelector('.pdf-preview-overlay')?.dataset.renderedPages || window.actionError);
      assert.equal(await page.evaluate(()=>window.actionError),null);
      const info=await page.evaluate(()=>{
        const panel=document.querySelector('.pdf-preview-overlay');
        const canvases=[...panel.querySelectorAll('canvas')];
        return {pages:Number(panel.dataset.renderedPages),count:canvases.length,
          painted:canvases.every(c=>c.getContext('2d').getImageData(0,0,c.width,c.height).data.some((v,i)=>i%4!==3 && v<220)),
          href:panel.querySelector('a').href};
      });
      assert.ok(info.pages>0 && info.pages===info.count && info.painted);
      return info;
    }
    async function downloaded(promise,label) {
      const download=await promise;
      const file=path.join(out,label+'.pdf');
      await download.saveAs(file);
      assert.equal(await download.failure(),null);
      const bytes=fs.readFileSync(file);
      assert.equal(bytes.subarray(0,5).toString(),'%PDF-');
      const pages=await page.evaluate(async bytes=>{
        const doc=await pdfjsLib.getDocument({data:new Uint8Array(bytes),stopAtErrors:true}).promise;
        try {
          for(let n=1;n<=doc.numPages;n++) {
            const p=await doc.getPage(n),vp=p.getViewport({scale:0.5}),c=document.createElement('canvas');
            c.width=vp.width;c.height=vp.height;
            await p.render({canvasContext:c.getContext('2d'),viewport:vp}).promise;
          }
          return doc.numPages;
        } finally {await doc.destroy();}
      },[...bytes]);
      assert.ok(pages>0);
      return {bytes:bytes.length,pages};
    }
    async function exercise(label) {
      console.log(engine+' checking '+label);
      await page.locator('#test-open').click();
      const view=await visible();
      await page.screenshot({path:path.join(out,label+'.png')});
      const manual=page.waitForEvent('download');
      await page.locator('.pdf-preview-overlay a').click();
      const saved=await downloaded(manual,label+'-manual');
      await page.getByRole('button',{name:'Chiudi anteprima PDF'}).click();
      const auto=page.waitForEvent('download');
      await page.locator('#test-download').click();
      const automatic=await downloaded(auto,label+'-auto');
      await visible();
      assert.match(await page.locator('.pdf-preview-overlay [role=status]').innerText(),/Download richiesto/);
      await page.getByRole('button',{name:'Chiudi anteprima PDF'}).click();
      report.tests.push({label,open:'PASS',manualDownload:saved,automaticDownload:automatic,view});
      console.log(engine+' PASS '+label);
    }
    if(process.env.PDF_UI_ONLY) {
      await page.evaluate(async()=>{
        const checklist=await(await fetch('checklists/coin_sopralluogo.json')).json();
        window.uiRecord=await db.creaSopralluogo({checklist_id:checklist.id,punto_vendita:'Edge UI originale',data:'2026-09-23',tecnico:'Test'});
        window.beforeRecord=JSON.stringify(await db.leggiSopralluogo(uiRecord.id));
        router.navigate('history');
      });
      const row=page.locator('.storico-voce').filter({hasText:'Edge UI originale'});
      for(const mode of ['regenerated','saved']) {
        await row.getByRole('button',{name:'Apri',exact:true}).click();
        await visible();
        await page.screenshot({path:path.join(out,'ui-'+mode+'.png')});
        await page.getByRole('button',{name:'Chiudi anteprima PDF'}).click();
        const promise=page.waitForEvent('download');
        await row.getByRole('button',{name:'Scarica',exact:true}).click();
        await downloaded(promise,'ui-'+mode);
        await visible();
        await page.getByRole('button',{name:'Chiudi anteprima PDF'}).click();
        assert.ok(await page.evaluate(async()=>!!(await db.leggiPdfReport(uiRecord.id))?.blob));
        assert.ok(await page.evaluate(async()=>beforeRecord===JSON.stringify(await db.leggiSopralluogo(uiRecord.id))));
        report.tests.push({label:'actual-history-buttons-'+mode,status:'PASS'});
      }
      assert.deepEqual(report.pageErrors,[]);
      report.status='PASS';
      return;
    }
    for(const client of ['coin','interparking','restage','melluso']) for(const photo of [false,true]) {
      await page.evaluate(async ({client,photo})=>{
        const checklist=await(await fetch(`checklists/${client}_sopralluogo.json`)).json();
        const record=await db.creaSopralluogo({checklist_id:checklist.id,punto_vendita:`${client} Edge`,data:'2026-09-23',tecnico:'Test'});
        const photos=[];
        if(photo){const c=document.createElement('canvas');c.width=200;c.height=150;const ctx=c.getContext('2d');ctx.fillStyle='red';ctx.fillRect(0,0,200,150);photos.push(await db.salvaFoto({sopralluogo_id:record.id,blob:await new Promise(r=>c.toBlob(r,'image/png'))}));}
        record.risposte=checklist.sezioni.flatMap(s=>s.domande).map((q,i)=>({domanda_id:q.id,risposta:'C',note:'Verifica Edge',foto:i===0?photos:[]}));
        const blob=await pdf.generaReport(checklist,record);
        window.fixture={blob,filename:`${client}.pdf`,checklist,record};
      },{client,photo});
      const label=client+(photo?'-foto':'-no-foto');
      await exercise(label+'-generated');
      await page.evaluate(async()=>{await db.salvaPdfReport({sopralluogo_id:fixture.record.id,blob:fixture.blob,filename:fixture.filename});fixture.blob=(await db.leggiPdfReport(fixture.record.id)).blob;});
      await exercise(label+'-indexeddb');
      await page.evaluate(async()=>{fixture.blob=await pdf.generaReport(fixture.checklist,fixture.record);});
      await exercise(label+'-regenerated');
    }
    await page.evaluate(()=>{window.open=()=>null;Object.defineProperty(navigator,'pdfViewerEnabled',{value:false,configurable:true});Object.defineProperty(navigator,'share',{value:undefined,configurable:true});});
    await exercise('popup-blocked-share-absent-native-disabled');
    await page.evaluate(()=>{Object.defineProperty(navigator,'canShare',{value:()=>true,configurable:true});Object.defineProperty(navigator,'share',{value:async()=>{shareCalls++;throw new DOMException('Denied','NotAllowedError');},configurable:true});});
    await exercise('share-would-fail-desktop-bypasses');
    assert.equal(await page.evaluate(()=>shareCalls),0);
    await page.evaluate(()=>{URL.createObjectURL=undefined;});
    await exercise('without-createObjectURL');
    await page.evaluate(()=>{URL.createObjectURL=normalCreate;});
    // Simulate silent synthetic-click blocking: the trusted user link still works.
    await page.evaluate(()=>{window.anchorClick=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){};});
    await page.locator('#test-download').click();
    await visible();
    const fallback=page.waitForEvent('download');
    await page.locator('.pdf-preview-overlay a').click();
    await downloaded(fallback,'synthetic-click-blocked-manual');
    report.tests.push({label:'synthetic-click-blocked',manualDownload:'PASS'});
    report.blobUrls=await page.evaluate(()=>createdPdfUrls);
    assert.deepEqual(report.pageErrors,[]);
    assert.deepEqual(report.consoleErrors,[]);
    assert.deepEqual(report.popups,[]);
    report.status='PASS';
  } catch(e) {report.status='FAIL';report.error=e.stack;process.exitCode=1;}
  finally {clearTimeout(watchdog);fs.writeFileSync(path.join(out,process.env.PDF_UI_ONLY?'ui-results.json':'results.json'),JSON.stringify(report,null,2));console.log(report.status,report.error||'',report.tests.length+' scenarios');if(browser) await browser.close();server.close();}
})();
