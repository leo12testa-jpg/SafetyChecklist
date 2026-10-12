// Upgrade from the actual origin/main frontend/SW, retaining a persistent synthetic profile.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {root,playwright,makeServer,guard,seed,documents,authOrigin}=require('./qa-support.cjs');
const out=path.join(root,'reports/qa-v1/upgrade');fs.mkdirSync(out,{recursive:true});
const baseline=process.env.QA_UPGRADE_FROM||'2d17b3e4f2b327c6382f76cda242f582957ad38c';
const report={tests:[],errors:[],source:baseline},server=makeServer({emulator:true});let context,page,user,profile,id,photo;
async function check(name,fn){try{const details=await fn();report.tests.push({name,status:'PASS',details});console.log('PASS '+name);}catch(e){report.tests.push({name,status:'FAIL',error:e.stack});console.error('FAIL '+name+' '+e.message);}fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(report,null,2));}
(async()=>{
  server.sourceRef=baseline;server.build='qa-before-v1';const url=await server.start();user=await seed('qa.upgrade.'+Date.now().toString(36));
  profile=fs.mkdtempSync(path.join(out,'profile-'));context=await playwright().chromium.launchPersistentContext(profile,{channel:'chrome',headless:true,serviceWorkers:'allow'});await guard(context,server.origin,{emulator:true});page=context.pages()[0];page.setDefaultTimeout(30000);page.on('pageerror',e=>report.errors.push(e.message));page.on('dialog',d=>d.accept());
  await page.goto(url);await page.locator('#login-username').fill(user.username);await page.locator('#login-password').fill(user.password);await page.locator('#login-submit').click();await page.waitForFunction(()=>appAutenticataAvviata&&appIdentity.current()!=null);
  await check('main reale installato prima della V1, worker precedente attivo',async()=>{
    await page.evaluate(()=>navigator.serviceWorker.ready);await page.reload();await page.waitForFunction(()=>navigator.serviceWorker.controller!=null&&appIdentity.current()!=null);assert.match(await page.locator('#versione-app').textContent(),/qa-before-v1/);return{script:await page.evaluate(()=>navigator.serviceWorker.controller.scriptURL)};
  });
  await check('dati e foto fittizi non sincronizzati conservati nel profilo precedente',async()=>{
    await context.setOffline(true);const created=await page.evaluate(async()=>{
      const r=await db.creaSopralluogo({checklist_id:'coin_sopralluogo',punto_vendita:'QA Upgrade fittizio',tecnico:'QA'});
      const c=document.createElement('canvas');c.width=60;c.height=40;c.getContext('2d').fillRect(0,0,60,40);const p=await db.salvaFoto({sopralluogo_id:r.id,domanda_id:1,blob:await new Promise(resolve=>c.toBlob(resolve,'image/jpeg'))});await db.salvaRisposta(r.id,{domanda_id:1,risposta:'PC',note:'QA-LEGACY-PERSIST',foto:[p]});return{id:r.id,photo:p};
    });id=created.id;photo=created.photo;assert.equal((await fetch(documents+'/sopralluoghi/'+id,{headers:{authorization:'Bearer owner'}})).status,404);
  });
  await check('aggiornamento automatico da main reale alla candidata senza ZIP o cancellazioni',async()=>{
    server.sourceRef=null;server.build='qa-after-v1';await context.setOffline(false);await page.evaluate(()=>router.navigate('home'));await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
    await page.waitForFunction(()=>document.querySelector('#versione-app').textContent.includes('qa-after-v1'),null,{timeout:45000});
    const result=await page.evaluate(async({id,photo})=>({record:await db.leggiSopralluogo(id),photo:(await db.leggiFoto(photo))?.blob?.size,cache:await caches.keys()}),{id,photo});assert.equal(result.record.risposte[0].note,'QA-LEGACY-PERSIST');assert.equal(result.record.risposte[0].risposta,'PC');assert.ok(result.photo>0);assert.ok(result.cache.includes('safety-checklist-shell-qa-after-v1'));return{photoBytes:result.photo,cache:result.cache};
  });
  await check('nessun errore JavaScript nell upgrade da main',async()=>{assert.deepEqual(report.errors,[]);});
})().catch(e=>{report.fatal=e.stack;process.exitCode=1;console.error(e);}).finally(async()=>{
  await context?.setOffline(false).catch(()=>{});await context?.close();
  for(const collection of ['sopralluoghi','attivita','utilizzo_app','utenti']){const r=await fetch(documents+'/'+collection+'?pageSize=1000',{headers:{authorization:'Bearer owner'}});for(const doc of (await r.json()).documents||[])await fetch(documents+'/'+collection+'/'+doc.name.split('/').pop(),{method:'DELETE',headers:{authorization:'Bearer owner'}});}
  if(user)await fetch(authOrigin+'/identitytoolkit.googleapis.com/v1/accounts:delete?key=qa-only',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({idToken:user.token})});
  if(profile){assert.ok(path.resolve(profile).startsWith(out+path.sep));fs.rmSync(profile,{recursive:true,force:true});}
  server.close();report.cleaned=true;fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(report,null,2));if(report.tests.some(t=>t.status==='FAIL'))process.exitCode=1;
});
