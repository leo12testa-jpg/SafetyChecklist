const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {root,documents,authOrigin,playwright,seed,makeServer,guard}=require('./qa-support.cjs');
const out=path.join(root,'reports/qa-v1/pwa');fs.mkdirSync(out,{recursive:true});
const report={tests:[],errors:[]};const server=makeServer({emulator:true});let context,page,user,id,photoId,profile;
async function check(name,fn){try{const details=await fn();report.tests.push({name,status:'PASS',details});console.log('PASS '+name);}catch(e){report.tests.push({name,status:'FAIL',error:e.stack});console.error('FAIL '+name+' '+e.message);}fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(report,null,2));}
(async()=>{
  const url=await server.start();server.build='qa-old';user=await seed('qa.pwa.'+Date.now().toString(36));
  profile=fs.mkdtempSync(path.join(out,'profile-'));
  context=await playwright().chromium.launchPersistentContext(profile,{channel:'chrome',headless:true,serviceWorkers:'allow',viewport:{width:1100,height:900}});
  await guard(context,server.origin,{emulator:true});page=context.pages()[0];page.setDefaultTimeout(20000);page.on('pageerror',e=>report.errors.push(e.message));page.on('dialog',d=>d.accept());
  await page.goto(url);await page.locator('#login-username').fill(user.username);await page.locator('#login-password').fill(user.password);await page.locator('#login-submit').click();await page.waitForFunction(()=>appIdentity.current()!=null&&appAutenticataAvviata);
  await check('PWA installazione SW e scope corretto nel sottopercorso',async()=>{
    await page.evaluate(()=>navigator.serviceWorker.ready);await page.reload();await page.waitForFunction(()=>navigator.serviceWorker.controller!=null);
    const scope=await page.evaluate(async()=>(await navigator.serviceWorker.ready).scope);assert.equal(scope,url);assert.match(await page.locator('#versione-app').textContent(),/qa-old/);
  });
  await check('PWA cache completa delle cinque checklist prima dell offline',async()=>{
    const cached=await page.evaluate(async()=>{
      const cache=await caches.open('safety-checklist-shell-qa-old'),index=await(await fetch('checklists/index.json')).json();
      const missing=[];for(const c of index.checklists)if(!await cache.match(new URL('checklists/'+c.id+'.json?v='+c.versione,location.href)))missing.push(c.id);return missing;
    });assert.deepEqual(cached,[]);
  });
  await check('crash reale renderer: recupero nota e foto ancora non sincronizzate',async()=>{
    await context.setOffline(true);
    const created=await page.evaluate(async()=>{
      const r=await db.creaSopralluogo({checklist_id:'coin_sopralluogo',punto_vendita:'QA PWA',tecnico:'QA'});
      const canvas=document.createElement('canvas');canvas.width=60;canvas.height=40;canvas.getContext('2d').fillRect(0,0,60,40);
      const photo=await db.salvaFoto({sopralluogo_id:r.id,domanda_id:1,blob:await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg'))});
      await db.salvaRisposta(r.id,{domanda_id:1,risposta:'NC',note:'QA-PERSIST-CRASH',foto:[photo]});return {id:r.id,photo};
    });id=created.id;photoId=created.photo;
    assert.equal((await fetch(`${documents}/sopralluoghi/${id}`,{headers:{authorization:'Bearer owner'}})).status,404);
    const crashed=page.waitForEvent('crash');const session=await context.newCDPSession(page);session.send('Page.crash').catch(()=>{});await crashed;
    await context.close();context=await playwright().chromium.launchPersistentContext(profile,{channel:'chrome',headless:true,serviceWorkers:'allow',viewport:{width:1100,height:900}});
    await guard(context,server.origin,{emulator:true});page=context.pages()[0];page.on('pageerror',e=>report.errors.push(e.message));page.on('dialog',d=>d.accept());await page.goto(url);await page.waitForFunction(()=>appIdentity.current()!=null);
    assert.equal(await page.evaluate(async id=>(await db.leggiSopralluogo(id)).risposte[0].note,id),'QA-PERSIST-CRASH');
    assert.ok(await page.evaluate(async id=>(await db.leggiFoto(id))?.blob?.size>0,photoId));
  });
  await check('aggiornamento differito durante compilazione con nota digitata',async()=>{
    await page.evaluate(async id=>{const r=await db.leggiSopralluogo(id),cl=await checklistEngine.carica(r.checklist_id);checklistEngine.avvia(cl,r);checklistEngine.vaiA(0);router.navigate('compilazione');compilazioneScreen.renderDomandaCorrente();},id);
    await page.locator('#nota-testo').fill('QA-NOTA-AUTOSALVATA');let reloads=0;page.on('load',()=>reloads++);
    server.build='qa-new';await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.locator('#banner-aggiornamento').waitFor({state:'visible'});
    assert.equal(await page.locator('#nota-testo').inputValue(),'QA-NOTA-AUTOSALVATA');assert.equal(reloads,0);assert.match(await page.locator('#versione-app').textContent(),/qa-old/);
    await page.locator('#banner-aggiornamento-bottone').click();assert.equal(await page.locator('#nota-testo').inputValue(),'QA-NOTA-AUTOSALVATA');assert.equal(reloads,0);
    await page.locator('#nota-testo').blur();
  });
  await check('aggiornamento in schermata sicura senza perdita di IndexedDB',async()=>{
    await page.evaluate(()=>router.navigate('home'));await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
    await page.waitForFunction(()=>document.querySelector('#versione-app').textContent.includes('qa-new'),null,{timeout:25000});
    assert.equal(await page.evaluate(async id=>(await db.leggiSopralluogo(id)).risposte[0].note,id),'QA-NOTA-AUTOSALVATA');
    assert.equal(await page.locator('#banner-aggiornamento').isVisible(),false);
  });
  await check('riapertura offline sessione verificata, cinque checklist e PDF',async()=>{
    // Stop the local HTTP server's responses: cached SW must supply the entire app.
    server.serverDown(true);await context.setOffline(true);await page.reload();await page.waitForFunction(()=>appIdentity.current()!=null);
    const result=await page.evaluate(async id=>{
      const index=await(await fetch('checklists/index.json')).json(),loaded=[];
      for(const c of index.checklists)loaded.push((await checklistEngine.carica(c.id)).id);
      const r=await db.leggiSopralluogo(id),cl=await checklistEngine.carica(r.checklist_id),blob=await pdf.generaReport(cl,r);
      return {loaded,bytes:(await pdf.leggiArrayBuffer(blob)).byteLength,note:r.risposte[0].note};
    },id);assert.equal(result.loaded.length,5);assert.ok(result.bytes>1000);assert.equal(result.note,'QA-NOTA-AUTOSALVATA');return result;
  });
  await check('PWA nessun errore JavaScript',async()=>{assert.deepEqual(report.errors,[]);});
})().catch(e=>{report.fatal=e.stack;console.error(e);process.exitCode=1;}).finally(async()=>{
  server.serverDown(false);await context?.setOffline(false).catch(()=>{});await context?.close();
  for(const collection of ['sopralluoghi','attivita','utilizzo_app']){
    const r=await fetch(`${documents}/${collection}?pageSize=1000`,{headers:{authorization:'Bearer owner'}});for(const d of (await r.json()).documents||[])await fetch(documents+'/'+collection+'/'+d.name.split('/').pop(),{method:'DELETE',headers:{authorization:'Bearer owner'}});
  }
  if(user){await fetch(`${documents}/utenti/${user.uid}`,{method:'DELETE',headers:{authorization:'Bearer owner'}});await fetch(`${authOrigin}/identitytoolkit.googleapis.com/v1/accounts:delete?key=qa-only`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({idToken:user.token})});}
  if(profile){assert.ok(path.resolve(profile).startsWith(out+path.sep));fs.rmSync(profile,{recursive:true,force:true});}
  server.storage.clear();server.close();report.cleaned=true;fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(report,null,2));if(report.tests.some(t=>t.status==='FAIL'))process.exitCode=1;
});
