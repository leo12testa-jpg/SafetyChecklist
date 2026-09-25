// Simultaneous real browsers (Edge, Chrome, WebKit, Firefox) at the canonical URL.
// DEFAULT: candidate build + LOCAL Firestore emulator (127.0.0.1:8085, project demo-safety)
// + in-memory fake Supabase storage. Every request to the real googleapis/firebase/supabase
// hosts is aborted, so a default run can never write production data.
// REAL_CLOUD=1: candidate build against the real cloud (test-prefixed IDs only).
// LIVE=1: published assets against the real cloud (post-deploy check, test-prefixed IDs only).
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const cache = path.join(process.env.LOCALAPPDATA, 'npm-cache/_npx');
const modules = fs.readdirSync(cache).map(d => path.join(cache, d, 'node_modules/playwright')).filter(p => fs.existsSync(path.join(p, 'package.json')))
  .sort((a,b) => require(path.join(b,'package.json')).version.localeCompare(require(path.join(a,'package.json')).version, undefined, {numeric:true}));
const pw = require(modules[0]);
const url = 'https://leo12testa-jpg.github.io/SafetyChecklist/';
const prefix = 'test-realtime-' + Date.now() + '-';
const EMU = !process.env.LIVE && !process.env.REAL_CLOUD;
const EMU_HOST = '127.0.0.1:8085';
// WebKit refuses https page -> http://127.0.0.1 XHR: it reaches the emulator through an https
// alias proxied by Playwright (fine for WebKit's long-polling transport).
const EMU_ALIAS = 'firestore-emulator.test';
const report = { prefix, url, mode: process.env.LIVE ? 'published' : EMU ? 'candidate build + Firestore emulator + fake Supabase' : 'candidate build + real cloud', tests: [], browsers: [], errors: [] };
const out = path.join(root, 'reports', process.env.LIVE ? 'realtime-live.json' : EMU ? 'realtime-emulator.json' : 'realtime-browser.json');
const CORS = {'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'};
const fakeStorage = new Map();
function jpegFromUpload(req) {
  const body = req.postDataBuffer() || Buffer.alloc(0);
  const type = req.headers()['content-type'] || '';
  const boundary = /boundary=([^;]+)/.exec(type)?.[1];
  if (!boundary) return body;
  // supabase-js sends Blob uploads as multipart/form-data: keep only the file part.
  for (const part of body.toString('latin1').split('--' + boundary)) {
    const split = part.indexOf('\r\n\r\n');
    if (split < 0 || !/content-type:\s*image\//i.test(part.slice(0, split))) continue;
    return Buffer.from(part.slice(split + 4).replace(/\r\n$/, ''), 'latin1');
  }
  return body;
}
async function fakeSupabase(route) {
  const req = route.request();
  const u = new URL(req.url());
  const json = (status, obj) => route.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(obj) });
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
  const m = u.pathname.match(/\/storage\/v1\/object\/(?:authenticated\/|public\/)?([^/]+)\/(.+)$/);
  if (req.method() === 'DELETE') {
    const bucket = u.pathname.split('/').pop();
    for (const p of JSON.parse(req.postData() || '{}').prefixes || []) fakeStorage.delete(bucket + '/' + p);
    return json(200, []);
  }
  if (!m) return json(400, { statusCode: '400', error: 'unsupported', message: u.pathname });
  const key = m[1] + '/' + decodeURIComponent(m[2]);
  if (req.method() === 'POST' || req.method() === 'PUT') {
    if (fakeStorage.has(key) && req.method() === 'POST' && req.headers()['x-upsert'] !== 'true') return json(400, { statusCode: '409', error: 'Duplicate', message: 'The resource already exists' });
    fakeStorage.set(key, jpegFromUpload(req));
    return json(200, { Key: key });
  }
  if (!fakeStorage.has(key)) return json(400, { statusCode: '404', error: 'not_found', message: 'Object not found' });
  return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'image/jpeg' }, body: fakeStorage.get(key) });
}
const contexts = [];
function executable(name) {
  const base = path.join(process.env.LOCALAPPDATA,'ms-playwright');
  for (const dir of fs.readdirSync(base).filter(d => d.startsWith(name+'-')).sort((a,b)=>b.localeCompare(a,undefined,{numeric:true}))) {
    for (const rel of name==='firefox'?['firefox/firefox.exe']:['Playwright.exe']) {
      const file=path.join(base,dir,rel); if(fs.existsSync(file)) return file;
    }
  }
}
async function open(name) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'safety-realtime-'+name+'-'));
  let type = pw[name === 'chrome' || name === 'msedge' ? 'chromium' : name];
  if (name==='firefox' && executable(name)?.includes('1465')) type = require(path.join(cache,'5c6d8c4f680fcd0a/node_modules/playwright')).firefox;
  const context = await type.launchPersistentContext(profile, {
    ...(name === 'chrome' || name === 'msedge' ? {channel:name} : {executablePath:executable(name)}),
    // Test-only: let the canonical https origin reach the local emulator (Private/Local Network Access).
    ...(EMU && (name === 'chrome' || name === 'msedge') ? {args:['--disable-features=PrivateNetworkAccessSendPreflights,PrivateNetworkAccessRespectPreflightResults,BlockInsecurePrivateNetworkRequests,LocalNetworkAccessChecks']} : {}),
    headless:true, serviceWorkers:'block', acceptDownloads:true, viewport:{width:1150,height:850}
  });
  contexts.push(context);
  report.browsers.push({name, version:context.browser()?.version(), profile});
  await context.route('**/*', async route => {
    const requestUrl = route.request().url();
    if (EMU && !requestUrl.startsWith(url)) {
      const host = new URL(requestUrl).host;
      if (host === EMU_HOST) return route.continue();
      if (host === EMU_ALIAS) {
        const req = route.request();
        const cors = { 'access-control-allow-origin': 'https://leo12testa-jpg.github.io', 'access-control-allow-credentials': 'true',
          'access-control-allow-headers': req.headers()['access-control-request-headers'] || '*', 'access-control-allow-methods': 'GET,POST,OPTIONS' };
        if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
        const target = requestUrl.replace('https://' + EMU_ALIAS, 'http://' + EMU_HOST);
        try {
          const res = await route.fetch({ url: target, timeout: 120000 });
          const headers = Object.fromEntries(Object.entries(res.headers()).filter(([k]) => !k.startsWith('access-control-')));
          return route.fulfill({ response: res, headers: { ...headers, ...cors } });
        } catch (e) { return route.abort(); }
      }
      if (/\.supabase\.co$/.test(host)) return fakeSupabase(route);
      // Production guard: nothing else (googleapis, firebaseio, gstatic, ...) leaves the machine.
      report.blocked = (report.blocked || 0) + 1;
      return route.abort();
    }
    if (!requestUrl.startsWith(url)) return route.continue();
    const relative = decodeURIComponent(new URL(requestUrl).pathname.slice('/SafetyChecklist/'.length)) || 'index.html';
    if (relative === 'js/sync.js') {
      // Narrow only the test harness reads/listener, not the app's deployed collection.
      const emuHost = name === 'webkit' ? EMU_ALIAS : EMU_HOST, emuSsl = name === 'webkit';
      const shim = EMU ? `
        firebase.initializeApp({ ...firebaseConfig, projectId: 'demo-safety' });
        const testFdb = firebase.firestore();
        const emuSettings = testFdb.settings.bind(testFdb);
        emuSettings({ host: ${JSON.stringify(emuHost)}, ssl: ${emuSsl} });
        // Later settings() calls (WebKit long polling) must keep pointing at the emulator.
        testFdb.settings = s => emuSettings({ ...s, host: ${JSON.stringify(emuHost)}, ssl: ${emuSsl}, merge: true });
      ` : `
        firebase.initializeApp(firebaseConfig);
        const testFdb = firebase.firestore();
        const originalCollection = testFdb.collection.bind(testFdb);
        testFdb.collection = name => {
          const col = originalCollection(name);
          const query = col.where(firebase.firestore.FieldPath.documentId(), '>=', ${JSON.stringify(prefix)}).where(firebase.firestore.FieldPath.documentId(), '<', ${JSON.stringify(prefix+'\uf8ff')});
          return { doc: id => { if (!id.startsWith(${JSON.stringify(prefix)})) throw new Error('Non-test write blocked'); return col.doc(id); },
            get: options => query.get(options), onSnapshot: (...args) => query.onSnapshot(...args) };
        };
        const originalUuid = crypto.randomUUID.bind(crypto);
        crypto.randomUUID = () => ${JSON.stringify(prefix)} + originalUuid();
      `;
      const source = process.env.LIVE ? await (await route.fetch()).text() : fs.readFileSync(path.join(root,relative),'utf8');
      return route.fulfill({contentType:'text/javascript',body:shim+source});
    }
    if (process.env.LIVE) return route.continue();
    const file = path.resolve(root,relative);
    if(!file.startsWith(root+path.sep) || !fs.existsSync(file)) return route.abort();
    const contentType = {'.html':'text/html','.js':'text/javascript','.json':'application/json','.css':'text/css','.png':'image/png','.webp':'image/webp'}[path.extname(file)] || 'application/octet-stream';
    return route.fulfill({contentType,body:fs.readFileSync(file)});
  });
  const page = context.pages()[0] || await context.newPage();
  page.on('pageerror', e => { report.errors.push({browser:name,message:e.message,stack:e.stack,url:page.url()});console.log('PAGEERROR',name,JSON.stringify({message:e.message,stack:e.stack})); });
  page.on('console', m => { if(m.type()==='warning' && /Sync/.test(m.text())) console.log(name, m.text().slice(0,350)); });
  page.on('requestfailed', req => console.log(name, 'network failed', new URL(req.url()).hostname, req.failure()?.errorText));
  page.on('dialog', d => d.accept());
  await page.goto(url,{waitUntil:'load',timeout:60000});
  await page.waitForFunction(() => typeof sync !== 'undefined' && typeof db !== 'undefined');
  await page.evaluate(() => sync.sincronizzaCompleto());
  return {page,context,name};
}
async function waitRecord(device,id,expression) {
  const end=Date.now()+45000;
  while(Date.now()<end) {
    const ok=await device.page.evaluate(async ({id,expression})=>{
      const r=await db.leggiSopralluogo(id);
      return !!(r && new Function('r','return '+expression)(r));
    },{id,expression});
    if(ok) return;
    await new Promise(r=>setTimeout(r,200));
  }
  throw new Error(device.name+' timeout: '+expression);
}
async function check(name,fn) {
  const start=Date.now();
  try { await fn(); report.tests.push({name,status:'PASS',ms:Date.now()-start}); console.log('PASS '+name); }
  catch(e) { report.tests.push({name,status:'FAIL',error:e.stack}); throw e; }
  finally { fs.writeFileSync(out,JSON.stringify(report,null,2)); }
}
async function answer(d,id,n,note) {
  await d.page.evaluate(({id,n,note}) => db.salvaRisposta(id,{domanda_id:n,sezione:'Test',risposta:'NC',note,foto:[]}),{id,n,note});
}
async function photo(d,id,n) {
  return d.page.evaluate(async ({id,n}) => {
    const canvas=document.createElement('canvas');canvas.width=80;canvas.height=60;
    const ctx=canvas.getContext('2d');ctx.fillStyle='orange';ctx.fillRect(0,0,80,60);
    const blob=await new Promise(r=>canvas.toBlob(r,'image/jpeg'));
    const fotoId=await db.salvaFoto({sopralluogo_id:id,domanda_id:n,blob});
    await db.salvaRisposta(id,{domanda_id:n,risposta:'NC',note:'foto test',foto:[fotoId]});
    await fotoSync.caricaFoto({fotoId,sopralluogo_id:id,domanda_id:n,blob});
    return fotoId;
  },{id,n});
}
async function receivePhoto(d,id,fotoId) {
  await waitRecord(d,id,`!!r.foto_url?.[${JSON.stringify(fotoId)}]`);
  const result=await d.page.evaluate(async ({id,fotoId}) => {
    const record=await db.leggiSopralluogo(id);
    const f=await fotoSync.risolviFoto(fotoId,record);
    await fotoSync.risolviFoto(fotoId,record);
    const saved=await db.leggiFoto(fotoId);
    return {id:f?.id,size:saved?.blob?.size};
  },{id,fotoId});
  assert.equal(result.id,fotoId);assert.ok(result.size>0);
}
async function pdfCheck(d,id) {
  await d.page.evaluate(async id => {
    await preparaDatiPdfCrossDevice();
    const r=await db.leggiSopralluogo(id);
    const cl=await checklistEngine.carica(r.checklist_id);
    const blob=await pdf.generaReport(cl,r);
    const bytes=await pdf.leggiArrayBuffer(blob);
    if(new TextDecoder().decode(bytes.slice(0,5))!=='%PDF-')throw new Error('PDF non valido');
    const parsed=await pdfjsLib.getDocument({data:new Uint8Array(bytes)}).promise;
    let text='';
    for(let n=1;n<=parsed.numPages;n++)text+=(await (await parsed.getPage(n)).getTextContent()).items.map(x=>x.str).join(' ');
    if(!text.includes('Foto non disponibile al momento della generazione.'))throw new Error('Avviso foto assente');
    await parsed.destroy();
  },id);
}
(async () => {
  if (EMU) {
    const r = await fetch(`http://${EMU_HOST}/emulator/v1/projects/demo-safety/databases/(default)/documents`, { method: 'DELETE' });
    assert.ok(r.ok, 'Firestore emulator not reachable on ' + EMU_HOST);
  }
  const A=await open('msedge'), B=await open('chrome');
  let id;
  await check('Edge crea da UI -> Chrome riceve realtime',async()=>{
    await B.page.evaluate(()=>router.navigate('history'));
    await A.page.getByText('Nuovo sopralluogo',{exact:true}).first().click();
    await A.page.locator('#select-checklist').selectOption('interparking_sopralluogo');
    await A.page.locator('#input-punto-vendita').fill(prefix+'Interparking');
    await A.page.getByRole('button',{name:'INIZIA',exact:true}).click();
    await A.page.waitForFunction(()=>location.hash==='#compilazione');
    id=await A.page.evaluate(()=>checklistEngine.sopralluogoCorrente().id);
    await waitRecord(B,id,"r.checklist_id==='interparking_sopralluogo'");
    await B.page.getByText(prefix+'Interparking',{exact:false}).first().waitFor();
  });
  await check('Chrome risposta -> Edge realtime',async()=>{await answer(B,id,12,'Chrome');await waitRecord(A,id,"r.risposte.some(x=>x.domanda_id===12 && x.note==='Chrome')");});
  await check('Edge nota -> Chrome; Chrome nota diversa -> Edge',async()=>{
    await answer(A,id,12,'Edge nota');await waitRecord(B,id,"r.risposte.some(x=>x.domanda_id===12 && x.note==='Edge nota')");
    await answer(B,id,12,'Chrome nota diversa');await waitRecord(A,id,"r.risposte.some(x=>x.domanda_id===12 && x.note==='Chrome nota diversa')");
  });
  await check('Edge foto -> Chrome stesso fotoId/blob',async()=>receivePhoto(B,id,await photo(A,id,13)));
  await check('Chrome foto -> Edge stesso fotoId/blob',async()=>receivePhoto(A,id,await photo(B,id,14)));
  await check('Offline modifica e reload -> online convergenza',async()=>{
    await A.context.setOffline(true);
    await answer(A,id,12,'offline Edge');
    await new Promise(r=>setTimeout(r,1000));
    const prev=await B.page.evaluate(async id=>(await db.leggiSopralluogo(id)).risposte.find(x=>x.domanda_id===12).note,id);
    assert.equal(prev,'Chrome nota diversa');
    await A.page.reload({waitUntil:'load'});
    await waitRecord(A,id,"r.risposte.some(x=>x.note==='offline Edge')");
    await A.context.setOffline(false);
    await waitRecord(B,id,"r.risposte.some(x=>x.note==='offline Edge')");
  });
  await check('Legacy MISDO solo IndexedDB -> Firestore -> altro browser',async()=>{
    const legacy=prefix+'MISDO-local-only';
    await A.context.setOffline(true);
    await A.page.evaluate(async id=>db.applicaSopralluogoRemoto({id,punto_vendita:'MISDO San Donato TEST',checklist_id:'interparking_sopralluogo',data:'2025-01-01T00:00:00Z',aggiornato_il:'2025-01-01T00:00:00Z',risposte:[{domanda_id:1,risposta:'C',note:'legacy recuperato'}]}),legacy);
    await A.page.reload({waitUntil:'load'});
    await A.context.setOffline(false);
    await waitRecord(B,legacy,"r.risposte.some(x=>x.note==='legacy recuperato')");
    report.legacyId=legacy;
  });
  const C=await open('webkit');
  await check('WebKit apertura/storico e ricezione',async()=>{await waitRecord(C,id,"r.risposte.length>=3");await C.page.evaluate(()=>router.navigate('history'));});
  await check('Tre dispositivi concorrenti domande 1/2/3',async()=>{
    await Promise.all([answer(A,id,1,'A'),answer(B,id,2,'B'),answer(C,id,3,'C')]);
    for(const d of [A,B,C])await waitRecord(d,id,"[1,2,3].every(n=>r.risposte.some(x=>x.domanda_id===n && x.note===['A','B','C'][n-1]))");
  });
  await check('WebKit background/visible e reload mantiene dati e foto',async()=>{
    await C.page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
    await C.page.reload({waitUntil:'load'});
    await waitRecord(C,id,"r.risposte.some(x=>x.domanda_id===3 && x.note==='C')");
    const f=await A.page.evaluate(async id=>Object.keys((await db.leggiSopralluogo(id)).foto_url)[0],id);
    await receivePhoto(C,id,f);
  });
  const D=await open('firefox');
  await check('Firefox lettura e modifica -> altri browser',async()=>{await waitRecord(D,id,"r.risposte.length>=6");await answer(D,id,4,'Firefox');await waitRecord(A,id,"r.risposte.some(x=>x.note==='Firefox')");});
  await check('Supabase down: blob locale resta e retry recupera',async()=>{
    await B.context.route('**/*.supabase.co/**',r=>r.abort());
    const f=await photo(B,id,15);
    assert.ok(await B.page.evaluate(async f=>!!(await db.leggiFoto(f))?.blob?.size,f));
    assert.notEqual(await B.page.evaluate(()=>sync.statoAttuale()),'sincronizzato');
    await B.context.unroute('**/*.supabase.co/**');
    await B.page.evaluate(()=>sync.sincronizzaCompleto());
    await receivePhoto(A,id,f);
  });
  await check('Firestore down: locale e Storico continuano, retry automatico converge',async()=>{
    const firestorePattern = EMU ? `http://${EMU_HOST}/**` : '**/firestore.googleapis.com/**';
    await B.context.route(firestorePattern,r=>r.abort());
    await answer(B,id,5,'scritta con Firestore down');
    assert.ok(await B.page.evaluate(async id=>(await db.leggiSopralluogo(id)).risposte.some(x=>x.note==='scritta con Firestore down'),id));
    await B.page.evaluate(()=>router.navigate('history'));
    await B.page.getByText(prefix+'Interparking',{exact:false}).first().waitFor();
    await B.page.evaluate(()=>sync.sincronizzaCompleto());
    assert.notEqual(await B.page.evaluate(()=>sync.statoAttuale()),'sincronizzato');
    await B.context.unroute(firestorePattern);
    await B.page.evaluate(()=>window.dispatchEvent(new Event('online')));
    await waitRecord(A,id,"r.risposte.some(x=>x.note==='scritta con Firestore down')");
  });
  await check('PDF con foto assente sempre valido in tutti i motori',async()=>{
    await A.page.evaluate(async id=>db.salvaRisposta(id,{domanda_id:16,risposta:'NC',foto:['missing-test-photo']}),id);
    for(const d of [A,B,C,D]){await waitRecord(d,id,"r.risposte.some(x=>x.domanda_id===16)");await pdfCheck(d,id);}
  });
  await check('Single-flight completo e nessun errore JS',async()=>{
    assert.equal(await B.page.evaluate(async()=>{const a=sync.sincronizzaCompleto(),b=sync.sincronizzaCompleto();const same=a===b;await a;return same;}),true);
    // Only XHR failures on the test-only WebKit proxy alias are harness noise; any other page error fails.
    report.proxyErrors = report.errors.filter(e => e.browser === 'webkit' && e.message.includes(EMU_ALIAS + '/google.firestore.v1.Firestore/'));
    assert.deepEqual(report.errors.filter(e => !report.proxyErrors.includes(e)),[]);
  });
  report.id=id;report.status='PASS';
})().catch(e=>{report.status='FAIL';report.error=e.stack;console.error(e);process.exitCode=1;})
.finally(async()=>{for(const c of contexts)await c.close().catch(()=>{});fs.writeFileSync(out,JSON.stringify(report,null,2));});
