// Real service worker / installed-app storage lifecycle on /SafetyChecklist/.
// Cloud configuration is deliberately absent in this isolated test server.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),os=require('node:os'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),cache=path.join(process.env.LOCALAPPDATA,'npm-cache/_npx');
const modules=fs.readdirSync(cache).map(d=>path.join(cache,d,'node_modules/playwright')).filter(p=>fs.existsSync(path.join(p,'package.json')))
  .sort((a,b)=>require(path.join(b,'package.json')).version.localeCompare(require(path.join(a,'package.json')).version,undefined,{numeric:true}));
const pw=require(modules[0]);let build='test-old',serverDown=false;
const server=http.createServer((req,res)=>{
  if(serverDown)return req.socket.destroy(); // network failure: only the service worker cache can answer
  const route=new URL(req.url,'http://localhost').pathname;
  if(!route.startsWith('/SafetyChecklist/')){res.writeHead(404);return res.end();}
  const rel=route.slice('/SafetyChecklist/'.length)||'index.html';
  const file=path.resolve(root,rel);
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.writeHead(404);return res.end();}
  let body=fs.readFileSync(file);
  if(rel==='index.html')body=body.toString().replace(/<script src="js\/(?:vendor\/firebase[^" ]*|firebase-config|vendor\/supabase|supabase-config)\.js"><\/script>/g,'');
  if(rel==='js/aggiornamento.js')body=body.toString().replace(/const BUILD_ID = '[^']+'/,'const BUILD_ID = '+JSON.stringify(build));
  if(rel==='service-worker.js')body=body.toString().replace(/safety-checklist-shell-[^']+/,'safety-checklist-shell-'+build);
  if(rel==='version.json')body=JSON.stringify({buildId:build});
  res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.json':'application/json','.css':'text/css','.png':'image/png','.webp':'image/webp'})[path.extname(file)]||'application/octet-stream');
  res.setHeader('Cache-Control','no-store');res.end(body);
});
const reports=[];
(async()=>{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const url=`http://127.0.0.1:${server.address().port}/SafetyChecklist/`;
  for(const name of ['msedge','webkit']){
    build='test-old';serverDown=false;let context;
    try{
      let opts={channel:'msedge',headless:true};
      if(name==='webkit'){
        const base=path.join(process.env.LOCALAPPDATA,'ms-playwright');
        const dir=fs.readdirSync(base).filter(d=>d.startsWith('webkit-')).sort((a,b)=>b.localeCompare(a,undefined,{numeric:true}))[0];
        opts={executablePath:path.join(base,dir,'Playwright.exe'),headless:true};
      }
      context=await pw[name==='msedge'?'chromium':name].launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(),'safety-pwa-')),{...opts});
      const page=context.pages()[0];
      await page.goto(url);
      await page.evaluate(()=>navigator.serviceWorker.ready);
      await page.reload();
      await page.waitForFunction(()=>navigator.serviceWorker.controller!==null);
      await page.evaluate(()=>db.applicaSopralluogoRemoto({id:'legacy-pwa',punto_vendita:'MISDO',risposte:[{domanda_id:1,note:'resta dopo aggiornamento'}]}));
      assert.equal(await page.locator('#banner-aggiornamento').isVisible(),false);
      assert.match(await page.locator('#versione-app').textContent(),/test-old/);
      build='test-new';
      await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
      await page.locator('#banner-aggiornamento').waitFor({state:'visible'});
      assert.match(await page.locator('#versione-app').textContent(),/test-old/,'badge must show running build');
      // Real user path: press "Aggiorna" (it must wait for the new worker, then reload once).
      await Promise.all([page.waitForEvent('load'),page.locator('#banner-aggiornamento-bottone').click()]);
      await page.waitForFunction(()=>document.getElementById('versione-app').textContent.includes('test-new'));
      assert.equal(await page.locator('#banner-aggiornamento').isVisible(),false);
      // No reload loop and the banner stays hidden until a genuinely newer release.
      let loads=0;page.on('load',()=>loads++);
      for(let i=0;i<3;i++){await page.evaluate(()=>{window.dispatchEvent(new Event('focus'));document.dispatchEvent(new Event('visibilitychange'));});await page.waitForTimeout(1000);}
      assert.equal(loads,0,'no automatic reload after upgrade');
      assert.equal(await page.locator('#banner-aggiornamento').isVisible(),false,'banner must not reappear for the running build');
      assert.equal(await page.evaluate(async()=>(await db.leggiSopralluogo('legacy-pwa')).risposte[0].note),'resta dopo aggiornamento');
      const scope=await page.evaluate(async()=>(await navigator.serviceWorker.ready).scope);
      assert.equal(scope,url);
      // WebKit's Playwright driver cannot reload under context.setOffline (internal error, see
      // reports/realtime-pwa.json history); there the network is cut at the server instead.
      if(name==='webkit'){serverDown=true;await page.reload();}
      else{await context.setOffline(true);await page.reload();}
      assert.equal(await page.evaluate(async()=>(await db.leggiSopralluogo('legacy-pwa')).punto_vendita),'MISDO');
      reports.push({browser:name,status:'PASS',checks:['canonical subpath','real SW scope','running build badge','banner only on mismatch','banner hidden after upgrade','no reload loop','banner stays hidden on focus','legacy IndexedDB retained','offline relaunch']});
      console.log(name+' PWA PASS');
    }catch(e){reports.push({browser:name,status:'FAIL',error:e.stack});process.exitCode=1;console.error(e);}
    finally{await context?.close();}
  }
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>{server.close();fs.writeFileSync(path.join(root,'reports/realtime-pwa.json'),JSON.stringify(reports,null,2));});
