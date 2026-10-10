const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {root,project,authOrigin,documents,playwright,seed,put,makeServer,guard}=require('./qa-support.cjs');
const browserName=process.env.QA_BROWSER||'chromium';
const out=path.join(root,'reports/qa-v1/'+(process.env.QA_BROWSER?'browser-'+browserName:'browser'));fs.mkdirSync(out,{recursive:true});
const report={tests:[],pageErrors:[],consoleErrors:[],blocked:[],timings:[],profiles:[]};
const devices=[],users=[];let id,url;const server=makeServer({emulator:true});
async function check(name,fn){try{const details=await fn();report.tests.push({name,status:'PASS',details});console.log('PASS '+name);}
  catch(e){report.tests.push({name,status:'FAIL',error:e.stack});console.error('FAIL '+name+' '+e.message);if(devices[0])await devices[0].page.screenshot({path:path.join(out,'last-failure.png'),fullPage:true}).catch(()=>{});}
  fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(report,null,2));}
async function open(user,viewport={width:1440,height:1000},{sw=false}={}) {
  const profile=fs.mkdtempSync(path.join(out,'profile-'));report.profiles.push(profile);
  const context=await playwright()[browserName].launchPersistentContext(profile,{...(browserName==='chromium'?{channel:'chrome'}:{}),headless:true,serviceWorkers:sw?'allow':'block',viewport,acceptDownloads:true});
  const blocked=await guard(context,server.origin,{emulator:true});report.blocked.push(blocked);
  const page=context.pages()[0];const d={context,page,user,profile,viewport};devices.push(d);page.setDefaultTimeout(20000);
  page.on('pageerror',e=>report.pageErrors.push({user:user.username,message:e.message}));
  page.on('console',m=>{if(m.type()==='error'||(m.type()==='warning'&&m.text().includes('FotoSync')))report.consoleErrors.push({user:user.username,message:m.text()});});
  page.on('dialog',dialog=>dialog.accept());await page.goto(url);return d;
}
async function login(d,password=d.user.password) {
  await d.page.locator('#login-username').fill(d.user.username);await d.page.locator('#login-password').fill(password);await d.page.locator('#login-submit').click();
}
async function ready(d) {await d.page.waitForFunction(()=>appIdentity.current()!=null&&appAutenticataAvviata&&document.body.dataset.authenticated==='true');}
async function waitRecord(d,expression,recordId=id) {
  const until=Date.now()+20000;
  while(Date.now()<until){
    const ok=await d.page.evaluate(async({id,expression})=>{const r=await db.leggiSopralluogo(id);return !!(r&&new Function('r','return '+expression)(r));},{id:recordId,expression});
    if(ok)return;await new Promise(r=>setTimeout(r,100));
  }
  throw new Error('record condition not reached: '+expression);
}
async function answer(d,n,note) {await d.page.evaluate(({id,n,note})=>db.salvaRisposta(id,{domanda_id:n,sezione:'QA',risposta:'NC',note,foto:[]}),{id,n,note});}
async function history(d) {await d.page.evaluate(()=>router.navigate('history'));await d.page.waitForSelector('#screen-history:not([hidden])');}
async function oneHistory(d) {await history(d);await d.page.locator('#storico-reset-filtri').click();await d.page.locator('#storico-ricerca').fill('QA-E2E-Unico');await d.page.waitForFunction(()=>document.querySelectorAll('#storico-lista li').length===1);}
async function photo(d,n) {
  return d.page.evaluate(async({id,n})=>{
    const c=document.createElement('canvas');c.width=90;c.height=60;const x=c.getContext('2d');x.fillStyle='orange';x.fillRect(0,0,90,60);
    const blob=await new Promise(r=>c.toBlob(r,'image/jpeg'));const f=await db.salvaFoto({sopralluogo_id:id,domanda_id:n,blob});
    await db.salvaRisposta(id,{domanda_id:n,risposta:'NC',note:'Foto QA',foto:[f]});await fotoSync.caricaFoto({fotoId:f,sopralluogo_id:id,domanda_id:n,blob});return f;
  },{id,n});
}
async function receivePhoto(d,f) {
  await waitRecord(d,`!!r.foto_url?.[${JSON.stringify(f)}]`);
  const until=Date.now()+20000;
  while(Date.now()<until){const ok=await d.page.evaluate(async({id,f})=>{const r=await db.leggiSopralluogo(id);if(!r?.foto_url?.[f])return false;await fotoSync.risolviFoto(f,r);return (await db.leggiFoto(f))?.blob?.size>0;},{id,f});if(ok)break;await new Promise(r=>setTimeout(r,100));}
  const result=await d.page.evaluate(async({id,f})=>{const r=await db.leggiSopralluogo(id);await fotoSync.risolviFoto(f,r);const photo=await db.leggiFoto(f);return {bytes:photo?.blob?.size,remote:r.foto_url[f],online:navigator.onLine};},{id,f});assert.ok(result.bytes>0,JSON.stringify({...result,storedKeys:[...server.storage.keys()]}));return result.bytes;
}
(async()=>{
  url=await server.start();const suffix=Date.now().toString(36);
  const admin=await seed('qa.admin.'+suffix,'admin'),techA=await seed('qa.alpha.'+suffix),techB=await seed('qa.beta.'+suffix);users.push(admin,techA,techB);
  const A=await open(techA,{width:1440,height:1000},{sw:true});
  await check('login errato e password cancellata',async()=>{
    await login(A,'Password-fittizia-errata');await A.page.waitForFunction(()=>document.querySelector('#login-messaggio').textContent.includes('Credenziali non valide'));
    assert.equal(await A.page.locator('#login-password').inputValue(),'');assert.equal(await A.page.locator('#screens').isVisible(),false);
  });
  await check('login tecnico reale Auth emulator',async()=>{await login(A);await ready(A);assert.equal(await A.page.evaluate(()=>appIdentity.current().ruolo),'tecnico');});
  await check('persistenza sessione al reload',async()=>{await A.page.reload();await ready(A);assert.equal(await A.page.evaluate(()=>appIdentity.current().uid),techA.uid);});
  await check('tecnico: rotte admin protette e API nega privilegi',async()=>{
    for(const screen of ['admin-users','settings','my-work']){await A.page.evaluate(screen=>router.navigate(screen),screen);await A.page.waitForFunction(()=>location.hash==='#home');}
    const response=await A.page.evaluate(async()=>{try{await appIdentity.callAdmin('list');return 200;}catch(e){return e.status;}});assert.equal(response,403);
    assert.equal(await A.page.locator('[data-nav="admin-users"].side-nav-item').isVisible(),false);
  });
  const B=await open(techB);await login(B);await ready(B);
  const C=await open(admin);await login(C);await ready(C);
  await check('admin vede utenti e tecnico non modifica profilo',async()=>{
    await C.page.evaluate(()=>router.navigate('admin-users'));await C.page.waitForFunction(()=>document.querySelectorAll('#admin-utenti-body tr').length>=3);
    assert.equal(await C.page.locator('[data-nav="admin-users"].side-nav-item').isVisible(),true);
    const r=await fetch(`${documents}/utenti/${techA.uid}`,{method:'PATCH',headers:{authorization:`Bearer ${techA.token}`,'content-type':'application/json'},body:JSON.stringify({fields:{ruolo:{stringValue:'admin'}}})});assert.equal(r.status,403);
  });
  await check('telemetria: tecnico scrive solo il proprio stato e admin legge accessi',async()=>{
    await A.page.evaluate(()=>appIdentity.trackUsage({event:'access',syncState:'sincronizzato',pendingData:0,pendingPhotos:0,pendingErrors:0,clientBuild:'QA'}));
    const usage=await C.page.evaluate(()=>appIdentity.callAdmin('usage'));
    assert.ok(usage.usage.some(u=>u.uid===techA.uid&&u.last_access));
    const denied=await A.page.evaluate(async()=>{try{await appIdentity.callAdmin('usage');return false;}catch(e){return e.status===403;}});assert.equal(denied,true);
    const forged=await fetch(`${documents}/utilizzo_app/${admin.uid}`,{method:'PATCH',headers:{authorization:`Bearer ${techA.token}`,'content-type':'application/json'},body:JSON.stringify({fields:{uid:{stringValue:admin.uid}}})});assert.equal(forged.status,403);
  });
  await check('backend crea account fittizio e rifiuta username duplicato/password corta',async()=>{
    const username='qa.created.'+suffix;
    const created=await C.page.evaluate(body=>appIdentity.callAdmin('create',body),{username,nome:'QA',cognome:'Fittizio',ruolo:'tecnico',password:'QA-only!Fittizio2026'});
    const sign=await fetch(`${authOrigin}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=qa-only`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:username+'@safetychecklist.local',password:'QA-only!Fittizio2026',returnSecureToken:true})});
    const signed=await sign.json();assert.equal(sign.status,200);users.push({...created.user,token:signed.idToken});
    const statuses=await C.page.evaluate(async body=>{const codes=[];for(const data of [body,{...body,username:'qa.short',password:'short'}]){try{await appIdentity.callAdmin('create',data);codes.push(200);}catch(e){codes.push(e.status);}}return codes;},{username,nome:'QA',cognome:'Fittizio',ruolo:'tecnico',password:'QA-only!Fittizio2026'});assert.deepEqual(statuses,[409,400]);
  });
  await check('Firestore anonimo, profilo inattivo e audit falsificato negati',async()=>{
    assert.equal((await fetch(`${documents}/sopralluoghi?pageSize=1`)).status,403);
    await put('utenti',techB.uid,{uid:techB.uid,username:techB.username,nome:techB.nome,cognome:techB.cognome,ruolo:'tecnico',attivo:false});
    assert.equal((await fetch(`${documents}/sopralluoghi?pageSize=1`,{headers:{authorization:`Bearer ${techB.token}`}})).status,403);
    await put('utenti',techB.uid,{uid:techB.uid,username:techB.username,nome:techB.nome,cognome:techB.cognome,ruolo:'tecnico',attivo:true});
    const forged=await fetch(`${documents}/attivita/qa-forged-${suffix}`,{method:'PATCH',headers:{authorization:`Bearer ${techA.token}`,'content-type':'application/json'},body:JSON.stringify({fields:{uid:{stringValue:admin.uid},tipo:{stringValue:'modifica_nota'}}})});assert.equal(forged.status,403);
  });
  await check('creazione cliente sede tecnico checklist da UI',async()=>{
    await A.page.getByText('Nuovo sopralluogo',{exact:true}).first().click();await A.page.locator('#select-checklist').selectOption('coin_sopralluogo');
    await A.page.locator('#input-punto-vendita').fill('QA-E2E-Unico');await A.page.locator('#input-tecnico').selectOption('__altro__');await A.page.locator('#input-tecnico-altro').fill('QA Tecnico Alpha');
    const started=Date.now();await A.page.getByRole('button',{name:'INIZIA',exact:true}).click();await A.page.waitForFunction(()=>location.hash==='#compilazione');
    id=await A.page.evaluate(()=>checklistEngine.sopralluogoCorrente().id);assert.ok(id);await waitRecord(B,"r.punto_vendita==='QA-E2E-Unico'");
    report.timings.push({operation:'creazione locale e ricezione',ms:Date.now()-started});return {id};
  });
  await check('C PC NC NA, note autosalvate, ricerca e navigazione rapida',async()=>{
    for(const [i,value] of ['C','PC','NC','NA'].entries()){
      await A.page.locator(`input[name=risposta][value=${value}]`).check();await A.page.locator('#btn-note').click();await A.page.locator('#nota-testo').fill('QA-NOTA-UI-'+i);await A.page.locator('#nota-testo').blur();
      await A.page.locator('#btn-avanti').click();
      await A.page.waitForFunction(i=>checklistEngine.domandaCorrente().indice===i+1,i);
    }
    await A.page.locator('#compilazione-ricerca-input').fill('estintori');await A.page.waitForSelector('#compilazione-ricerca-risultati:not([hidden])');
    assert.ok(await A.page.locator('#compilazione-ricerca-risultati button').count()>0);await A.page.locator('#compilazione-ricerca-risultati button').first().click();
    const record=await A.page.evaluate(id=>db.leggiSopralluogo(id),id);assert.deepEqual(record.risposte.slice(0,4).map(r=>r.risposta),['C','PC','NC','NA']);assert.deepEqual(record.risposte.slice(0,4).map(r=>r.note),[0,1,2,3].map(i=>'QA-NOTA-UI-'+i));
  });
  await check('tre tecnici: modifiche simultanee su domande diverse',async()=>{
    for(const d of [A,B,C])await waitRecord(d,"r.punto_vendita==='QA-E2E-Unico'");
    await Promise.all([answer(A,20,'QA-A-20'),answer(B,21,'QA-B-21'),answer(C,22,'QA-C-22')]);
    for(const d of [A,B,C])await waitRecord(d,"[20,21,22].every(n=>r.risposte.some(a=>a.domanda_id===n&&a.note==='QA-'+['A','B','C'][n-20]+'-'+n))");
  });
  await check('stessa domanda concorrente: verifica conservazione entrambe le note',async()=>{
    await Promise.all([answer(A,23,'CONFLITTO-ALPHA'),answer(B,23,'CONFLITTO-BETA')]);await A.page.evaluate(()=>sync.sincronizzaCompleto());await B.page.evaluate(()=>sync.sincronizzaCompleto());
    const records=await Promise.all([A,B].map(d=>d.page.evaluate(id=>db.leggiSopralluogo(id),id)));
    const serialized=JSON.stringify(records);report.sameQuestion={winner:records[0].risposte.find(r=>r.domanda_id===23),bothRetained:serialized.includes('CONFLITTO-ALPHA')&&serialized.includes('CONFLITTO-BETA')};
    assert.ok(report.sameQuestion.bothRetained,'Una nota concorrente è sovrascritta senza storico/risoluzione del conflitto');
  });
  await check('versione concorrente precedente consultabile e ripristinabile da UI',async()=>{
    await A.page.evaluate(async id=>{const r=await db.leggiSopralluogo(id),cl=await checklistEngine.carica(r.checklist_id);checklistEngine.avvia(cl,r);const i=cl.sezioni.flatMap(s=>s.domande).findIndex(q=>q.id===23);checklistEngine.vaiA(i);router.navigate('compilazione');compilazioneScreen.renderDomandaCorrente();},id);
    const previous=await A.page.evaluate(()=>checklistEngine.domandaCorrente().risposta.versioni_precedenti.find(v=>v.note?.startsWith('CONFLITTO-')).note);
    await A.page.locator('#risposta-versioni-precedenti summary').click();
    await A.page.locator('#risposta-versioni-precedenti div').filter({hasText:previous}).getByRole('button',{name:'Ripristina questa versione'}).click();
    await waitRecord(B,`r.risposte.some(a=>a.domanda_id===23&&a.note===${JSON.stringify(previous)})`);
  });
  await check('foto da file chooser UI: compressione e collegamento alla domanda attiva',async()=>{
    const png=await A.page.evaluate(()=>{const c=document.createElement('canvas');c.width=1600;c.height=1000;const x=c.getContext('2d');x.fillStyle='#2c6';x.fillRect(0,0,1600,1000);x.fillStyle='white';x.font='80px sans-serif';x.fillText('FOTO QA FITTIZIA',100,200);return c.toDataURL('image/png');});
    const file=path.join(out,'qa-photo.png');fs.writeFileSync(file,Buffer.from(png.split(',')[1],'base64'));
    const before=await A.page.evaluate(()=>checklistEngine.domandaCorrente().risposta.foto.length);
    const choosing=A.page.waitForEvent('filechooser');await A.page.locator('#btn-foto').click();await(await choosing).setFiles(file);
    await waitRecord(A,`r.risposte.some(r=>r.domanda_id===23&&r.foto.length===${before+1})`);
    const result=await A.page.evaluate(async()=>{const f=checklistEngine.domandaCorrente().risposta.foto.at(-1),record=await db.leggiFoto(f),bitmap=await createImageBitmap(record.blob);const size={width:bitmap.width,height:bitmap.height};bitmap.close();return {type:record.blob.type,question:record.domanda_id,bytes:record.blob.size,...size};});
    assert.equal(result.type,'image/jpeg');assert.equal(result.question,23);assert.ok(result.bytes>0);assert.equal(result.width,1280);return result;
  });
  await check('upload foto lento e cambio domanda: foto resta sulla domanda originale',async()=>{
    await A.context.route(server.origin+'/functions/v1/photo-access**',async route=>{if(route.request().method()==='POST')await new Promise(r=>setTimeout(r,800));return route.continue();});
    const before=await A.page.evaluate(()=>checklistEngine.domandaCorrente().risposta.foto.length);
    const choosing=A.page.waitForEvent('filechooser');await A.page.locator('#btn-foto').click();await(await choosing).setFiles(path.join(out,'qa-photo.png'));
    await A.page.locator('#btn-avanti').click();await A.page.waitForFunction(()=>checklistEngine.domandaCorrente().domanda.id!==23);
    await waitRecord(A,`r.risposte.some(r=>r.domanda_id===23&&r.foto.length===${before+1})`);
    const result=await A.page.evaluate(async id=>{const r=await db.leggiSopralluogo(id),f=r.risposte.find(r=>r.domanda_id===23).foto.at(-1),owner=(await db.leggiFoto(f)).domanda_id;return {owner,other:r.risposte.some(r=>r.domanda_id!==23&&r.foto.includes(f))};},id);
    assert.equal(result.owner,23);assert.equal(result.other,false);await A.context.unroute(server.origin+'/functions/v1/photo-access**');return result;
  });
  await check('foto sincronizzata e recuperata su secondo dispositivo',async()=>{const f=await photo(A,24);return {photo:f,bytes:await receivePhoto(B,f)};});
  await check('cloud foto 503: blob locale mantenuto e retry recupera',async()=>{
    server.storageDown(true);const f=await photo(B,25);assert.ok(await B.page.evaluate(async f=>(await db.leggiFoto(f)).blob.size>0,f));
    assert.notEqual(await B.page.evaluate(()=>sync.statoAttuale()),'sincronizzato');server.storageDown(false);await B.page.evaluate(()=>sync.sincronizzaCompleto());return {bytes:await receivePhoto(A,f)};
  });
  await check('offline, foto e nota, reload con SW, ritorno online senza perdita',async()=>{
    await A.page.evaluate(()=>navigator.serviceWorker.ready);await A.page.reload();await ready(A);await A.page.waitForFunction(()=>navigator.serviceWorker.controller!==null);
    await A.context.setOffline(true);await answer(A,26,'QA-OFFLINE-RECOVERY');const f=await photo(A,27);
    await A.page.reload();await ready(A);await waitRecord(A,"r.risposte.some(r=>r.note==='QA-OFFLINE-RECOVERY')");
    assert.ok(await A.page.evaluate(async f=>(await db.leggiFoto(f)).blob.size>0,f));await A.context.setOffline(false);await A.page.evaluate(()=>window.dispatchEvent(new Event('online')));
    await waitRecord(B,"r.risposte.some(r=>r.note==='QA-OFFLINE-RECOVERY')");return {bytes:await receivePhoto(B,f)};
  });
  await check('Firestore interrotto: dati pending persistono e ripartono',async()=>{
    await B.context.route('http://127.0.0.1:18085/**',r=>r.abort());await answer(B,28,'QA-FIRESTORE-DOWN');assert.ok(await B.page.evaluate(async id=>(await db.leggiSopralluogo(id)).risposte.some(r=>r.note==='QA-FIRESTORE-DOWN'),id));
    await B.context.unroute('http://127.0.0.1:18085/**');await B.page.evaluate(()=>window.dispatchEvent(new Event('online')));await waitRecord(A,"r.risposte.some(r=>r.note==='QA-FIRESTORE-DOWN')");
  });
  await check('storico filtri cliente tecnico data checklist ricerca ordinamento',async()=>{
    await A.page.evaluate(async()=>{
      await db.creaSopralluogo({checklist_id:'melluso_sopralluogo',punto_vendita:'QA-Secondo',tecnico:'QA Tecnico Beta',data_sopralluogo:'2025-01-02'});
      await db.applicaSopralluogoRemoto({id:'qa-legacy-'+Date.now(),checklist_id:'coin_checklist_v1',punto_vendita:'QA Legacy Coin',data:'2024-01-01T00:00:00Z',risposte:[{domanda_id:'1',risposta:'C',note:'legacy'}]});
    });
    await history(A);await A.page.locator('#storico-ricerca').fill('QA-');await A.page.waitForFunction(()=>document.querySelectorAll('#storico-lista li').length>=3);
    await A.page.locator('#storico-filtro-cliente').selectOption('Coin');await A.page.waitForFunction(()=>document.querySelectorAll('#storico-lista li').length===2);
    await A.page.locator('#storico-filtro-checklist').selectOption('coin_sopralluogo');await A.page.waitForFunction(()=>document.querySelectorAll('#storico-lista li').length===1);
    await A.page.locator('#storico-filtro-tecnico').selectOption('QA Tecnico Alpha');assert.equal(await A.page.locator('#storico-lista li').count(),1);
    await A.page.locator('#storico-data-da').fill('2030-01-01');await A.page.locator('#storico-data-da').dispatchEvent('change');await A.page.waitForFunction(()=>document.querySelectorAll('#storico-lista li').length===0);
    await A.page.locator('#storico-reset-filtri').click();await A.page.locator('#storico-ordinamento').selectOption('data-asc');
    await A.page.waitForFunction(()=>document.querySelector('#storico-lista li')?.textContent.includes('QA Legacy'));
    const labels=await A.page.locator('#storico-lista li').allTextContents();assert.ok(labels[0].includes('QA Legacy'));return {orderedRows:labels.length};
  });
  await check('storico chiusura riapertura modifica e ripresa incompleta',async()=>{
    await oneHistory(A);await A.page.getByRole('button',{name:'Segna come chiusa',exact:true}).click();await waitRecord(A,"r.stato_chiusura==='chiuso'");
    await A.page.getByRole('button',{name:'Riapri',exact:true}).click();await waitRecord(A,"r.stato_chiusura==='aperto'");
    await A.page.getByRole('button',{name:'Modifica QA-E2E-Unico',exact:true}).click();await A.page.waitForFunction(()=>location.hash==='#compilazione');assert.equal(await A.page.evaluate(()=>checklistEngine.sopralluogoCorrente().id),id);
  });
  await check('eliminazione e ripristino UI solo sopralluogo fittizio',async()=>{
    await oneHistory(A);await A.page.getByRole('button',{name:'Sposta QA-E2E-Unico nel cestino',exact:true}).click();await waitRecord(A,"!!r.eliminato_il");
    await A.page.locator('#storico-vai-cestino').click();await A.page.waitForSelector('#cestino-lista li');
    await A.page.locator('#cestino-lista li').filter({hasText:'QA-E2E-Unico'}).getByRole('button',{name:'Ripristina'}).click();await waitRecord(A,"!r.eliminato_il");await waitRecord(B,"!r.eliminato_il");
  });
  for(const viewport of [{width:1440,height:1000},{width:768,height:1024},{width:390,height:844}])await check(`responsive ${viewport.width}: home nuovo compilazione storico e PDF`,async()=>{
    await A.page.setViewportSize(viewport);
    for(const screen of ['home','new-inspection','history','compilazione']){
      await A.page.evaluate(s=>router.navigate(s),screen);await A.page.waitForTimeout(150);
      const fit=await A.page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));assert.ok(fit.scroll<=fit.width+2,screen+' overflow '+JSON.stringify(fit));
      await A.page.screenshot({path:path.join(out,`${viewport.width}-${screen}.png`),fullPage:true});
    }
    const q=await A.page.evaluate(()=>checklistEngine.domandaCorrente().domanda.id);
    await A.page.locator('input[name=risposta][value=C]').check();await waitRecord(A,`r.risposte.some(r=>r.domanda_id===${q}&&r.risposta==='C')`);
    const time=Date.now();await A.page.evaluate(async id=>{const r=await db.leggiSopralluogo(id),cl=await checklistEngine.carica(r.checklist_id);await pdf.apri(await pdf.generaReport(cl,r),'QA.pdf',null);},id);
    assert.ok(await A.page.locator('.pdf-preview-overlay canvas').count()>0);await A.page.screenshot({path:path.join(out,`${viewport.width}-preview.png`)});await A.page.getByRole('button',{name:'Chiudi anteprima PDF'}).click();return {pdfMs:Date.now()-time};
  });
  await check('rete lenta: apertura checklist e ricerca utilizzabili',async()=>{
    await B.context.route(server.origin+'/SafetyChecklist/checklists/**',async r=>{await new Promise(resolve=>setTimeout(resolve,700));return r.continue();});
    const start=Date.now();await B.page.evaluate(async id=>{const r=await db.leggiSopralluogo(id);checklistEngine.avvia(await checklistEngine.carica(r.checklist_id),r);router.navigate('compilazione');compilazioneScreen.renderDomandaCorrente();},id);
    await B.page.locator('#compilazione-ricerca-input').fill('estintori');await B.page.waitForSelector('#compilazione-ricerca-risultati:not([hidden])');await B.context.unroute(server.origin+'/SafetyChecklist/checklists/**');return {ms:Date.now()-start};
  });
  await check('logout e nuovo login con altro account sul dispositivo',async()=>{
    await B.page.locator('#btn-esci').click();await B.page.waitForFunction(()=>document.body.dataset.authenticated==='false');assert.equal(await B.page.locator('#screens').isVisible(),false);
    B.user=admin;await login(B);await ready(B);assert.equal(await B.page.evaluate(()=>appIdentity.current().uid),admin.uid);
  });
  await check('cambio password: errore credenziale attuale, aggiornamento e nuovo accesso',async()=>{
    const old=admin.password,next='QA-only!NuovaPassword2026';
    await B.page.locator('#btn-cambia-password').click();await B.page.locator('#password-attuale').fill('QA-only!Errata');await B.page.locator('#password-nuova').fill(next);await B.page.locator('#password-conferma').fill(next);
    await B.page.locator('#form-cambia-password button[type=submit]').click();await B.page.waitForFunction(()=>document.querySelector('#password-messaggio').textContent.includes('non corretta'));
    await B.page.locator('#password-attuale').fill(old);await B.page.locator('#form-cambia-password button[type=submit]').click();await B.page.waitForFunction(()=>document.querySelector('#password-messaggio').textContent==='Password aggiornata.');
    admin.password=next;admin.token=await B.page.evaluate(()=>firebase.auth().currentUser.getIdToken(true));await B.page.waitForSelector('#dialog-cambia-password',{state:'hidden'});
    await B.page.locator('#btn-esci').click();await B.page.waitForFunction(()=>document.body.dataset.authenticated==='false');await login(B);await ready(B);assert.equal(await B.page.evaluate(()=>appIdentity.current().uid),admin.uid);
  });
  await check('cambio ruolo online aggiorna privilegi e protegge la schermata già aperta',async()=>{
    await B.page.evaluate(uid=>appIdentity.callAdmin('setRole',{uid,role:'admin'}),techA.uid);await A.page.reload();await ready(A);
    assert.equal(await A.page.evaluate(()=>appIdentity.isAdmin()),true);await A.page.evaluate(()=>router.navigate('settings'));
    await B.page.evaluate(uid=>appIdentity.callAdmin('setRole',{uid,role:'tecnico'}),techA.uid);await A.page.evaluate(()=>window.dispatchEvent(new Event('focus')));
    await A.page.waitForFunction(()=>appIdentity.current()?.ruolo==='tecnico'&&location.hash==='#home');assert.equal(await A.page.locator('[data-nav="admin-users"].side-nav-item').isVisible(),false);
  });
  await check('disattivazione utente provoca logout online',async()=>{
    await put('utenti',techA.uid,{uid:techA.uid,username:techA.username,nome:techA.nome,cognome:techA.cognome,ruolo:'tecnico',attivo:false});
    await A.page.evaluate(()=>window.dispatchEvent(new Event('focus')));await A.page.waitForFunction(()=>document.body.dataset.authenticated==='false');assert.equal(await A.page.locator('#screens').isVisible(),false);
  });
  await check('nessun errore JavaScript applicativo',async()=>{assert.deepEqual(report.pageErrors,[]);return {consoleErrors:report.consoleErrors.length,blocked:report.blocked.flat().length};});
})().catch(e=>{report.fatal=e.stack;process.exitCode=1;console.error(e);}).finally(async()=>{
  server.storageDown(false);server.endpointDown(false);server.serverDown(false);
  for(const d of devices){await d.context.setOffline(false).catch(()=>{});await d.context.close().catch(()=>{});}
  // Delete only artifacts/documents created in this dedicated demo project by this run.
  for(const collection of ['sopralluoghi','attivita','utilizzo_app','utenti']){
    const r=await fetch(`${documents}/${collection}?pageSize=1000`,{headers:{authorization:'Bearer owner'}}).catch(()=>null);
    const docs=r?.ok?(await r.json()).documents||[]:[];
    for(const doc of docs)await fetch(documents+'/'+collection+'/'+doc.name.split('/').pop(),{method:'DELETE',headers:{authorization:'Bearer owner'}});
  }
  for(const user of users)await fetch(`${authOrigin}/identitytoolkit.googleapis.com/v1/accounts:delete?key=qa-only`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({idToken:user.token})}).catch(()=>{});
  for(const profile of report.profiles){assert.ok(path.resolve(profile).startsWith(out+path.sep));fs.rmSync(profile,{recursive:true,force:true});}
  server.storage.clear();server.close();report.cleaned=true;fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(report,null,2));
  if(report.tests.some(t=>t.status==='FAIL'))process.exitCode=1;
});
