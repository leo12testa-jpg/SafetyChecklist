// Real UI/IndexedDB/PDF/ZIP with synthetic data and all cloud requests blocked.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {root,playwright,makeServer,guard}=require('./qa-support.cjs');
const out=path.join(root,'reports/qa-v1/dvr');fs.mkdirSync(out,{recursive:true});
const report={tests:[],errors:[],models:[]},server=makeServer();let browser,context,page;
async function check(name,fn){try{const details=await fn();report.tests.push({name,status:'PASS',details});console.log('PASS '+name);}catch(e){report.tests.push({name,status:'FAIL',error:e.stack});console.error('FAIL '+name+' '+e.message);}fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(report,null,2));}
(async()=>{
  const url=await server.start();browser=await playwright().chromium.launch({channel:'chrome',headless:true});context=await browser.newContext({acceptDownloads:true,serviceWorkers:'block'});
  report.blocked=await guard(context,server.origin);page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));page.on('dialog',d=>d.accept());page.setDefaultTimeout(20000);
  await page.goto(url);await page.waitForFunction(()=>appAutenticataAvviata);
  const models=JSON.parse(fs.readFileSync(path.join(root,'checklists/index.json'))).checklists.filter(c=>c.id.startsWith('dvr_'));
  for(const viewport of [{width:1440,height:1000},{width:768,height:1024},{width:390,height:844}])await check('DVR menu e layout '+viewport.width,async()=>{
    await page.setViewportSize(viewport);await page.evaluate(()=>router.navigate('home'));
    await page.locator('.dashboard-new[data-modalita="dvr"]').click();
    await page.waitForFunction(()=>document.querySelector('#select-checklist').options.length===6);
    const ids=await page.locator('#select-checklist option').evaluateAll(els=>els.map(e=>e.value).filter(Boolean));
    assert.deepEqual(ids,models.filter(c=>!['dvr_chimico','dvr_mmc'].includes(c.id)).map(c=>c.id));
    assert.equal(await page.locator('#blocco-importa-pdf').isVisible(),false);
    const fit=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));assert.ok(fit.scroll<=fit.width+2,JSON.stringify(fit));
    await page.screenshot({path:path.join(out,viewport.width+'-menu.png'),fullPage:true});return{ids,fit};
  });
  for(const model of models)await check(model.id+': ogni domanda, PDF multipagina e ZIP con foto/note',async()=>{
    const result=await page.evaluate(async model=>{
      const cl=await checklistEngine.carica(model.id),questions=cl.sezioni.flatMap(s=>s.domande);
      const record=await db.creaSopralluogo({checklist_id:model.id,checklist_version:cl.versione,punto_vendita:'QA DVR Fittizio',indirizzo_punto_vendita:'Sede QA',tecnico:'QA',data_sopralluogo:'2026-10-12'});
      const c=document.createElement('canvas');c.width=100;c.height=60;c.getContext('2d').fillRect(0,0,100,60);
      const blob=await new Promise(r=>c.toBlob(r,'image/png')),photo=await db.salvaFoto({sopralluogo_id:record.id,domanda_id:questions[0].id,blob});
      const value=q=>q.tipo==='numero'?'42':q.tipo==='si-no'?'Sì':q.tipo==='scelta-singola'?q.opzioni[0].label:q.tipo==='checkbox-multi'?[{label:q.opzioni[0].label,...(q.opzioni[0].sotto_campo?{sottoCampoValore:'QA dettaglio'}:{})}]:q.tipo==='gruppo-testo'?Object.fromEntries(q.campi.map(c=>[c.label,'QA '+c.label])):'QA RISPOSTA '+q.codice;
      record.risposte=questions.map((q,i)=>({domanda_id:q.id,risposta:value(q),note:'QA-NOTA-'+q.codice,foto:i===0?[photo]:[]}));await db.aggiornaSopralluogo(record.id,{risposte:record.risposte});
      checklistEngine.avvia(cl,await db.leggiSopralluogo(record.id));router.navigate('riepilogo');await riepilogoScreen.render();
      const pdfBlob=await pdf.generaReport(cl,record),pdfBytes=Array.from(new Uint8Array(await pdf.leggiArrayBuffer(pdfBlob)));
      const doc=await pdfjsLib.getDocument({data:new Uint8Array(pdfBytes)}).promise;let text='';
      for(let n=1;n<=doc.numPages;n++)text+=(await(await doc.getPage(n)).getTextContent()).items.map(x=>x.str).join(' ')+' ';
      for(const q of questions)if(!text.includes('QA-NOTA-'+q.codice))throw Error('PDF note missing '+q.codice);
      const pages=doc.numPages;await doc.destroy();
      let zipBlob;const save=pdf.salvaOCondividi;pdf.salvaOCondividi=async blob=>{zipBlob=blob;};
      try{await esportaRaccoltaDvr(record.id);}finally{pdf.salvaOCondividi=save;}
      const zip=await JSZip.loadAsync(zipBlob),data=JSON.parse(await zip.file('risposte.json').async('string'));
      if(data.risposte.length!==questions.length||data.foto_mancanti.length)throw Error('Incomplete ZIP');
      for(let i=0;i<questions.length;i++){const exported=data.risposte[i],expected=record.risposte[i];if(exported.domanda_id!==expected.domanda_id||exported.note!==expected.note||JSON.stringify(exported.risposta)!==JSON.stringify(expected.risposta))throw Error('ZIP ownership mismatch '+questions[i].codice);}
      const photoBytes=await zip.file('foto/'+data.risposte[0].foto[0]).async('uint8array'),original=new Uint8Array(await blob.arrayBuffer());
      if(photoBytes.length!==original.length||!photoBytes.every((v,i)=>v===original[i]))throw Error('ZIP photo bytes changed');
      window.dvrFixture={cl,id:record.id,questions};return{id:record.id,questions:questions.length,pages,pdfBytes,zipBytes:Array.from(new Uint8Array(await zipBlob.arrayBuffer()))};
    },model);
    assert.ok(result.pages>1);assert.equal(await page.locator('#btn-esporta-dvr').isVisible(),true);assert.match(await page.locator('#titolo-riepilogo').textContent(),/DVR/);
    fs.writeFileSync(path.join(out,model.id+'.pdf'),Buffer.from(result.pdfBytes));fs.writeFileSync(path.join(out,model.id+'.zip'),Buffer.from(result.zipBytes));report.models.push({id:model.id,questions:result.questions,pages:result.pages});
    return{questions:result.questions,pages:result.pages};
  });
  for(const type of ['testo','numero','si-no','scelta-singola','checkbox-multi','gruppo-testo'])await check('DVR UI '+type+': autosalvataggio, nota, refresh',async()=>{
    await page.evaluate(async type=>{
      // Dedicated synthetic checklist exercises all supported controls with notes,
      // including number/yes-no which current DVR templates do not use.
      const q={id:1,codice:'QA01',testo:'[QA01] Controllo fittizio',tipo:type,note:true,foto:true,opzioni:[{label:'QA scelta',sotto_campo:true}],campi:[{label:'QA campo',multiriga:true}]};
      const cl={id:'dvr_qa_controls',versione:'qa',titolo:'QA controlli fittizi',stile:'raccolta-dati',sezioni:[{titolo:'QA',domande:[q]}]};
      const record=await db.creaSopralluogo({checklist_id:cl.id,checklist_version:cl.versione,punto_vendita:'QA controllo '+type,tecnico:'QA'});checklistEngine.avvia(cl,record);checklistEngine.vaiA(0);router.navigate('compilazione');compilazioneScreen.renderDomandaCorrente();window.controlFixture={id:record.id,q,cl};
    },type);
    const area=page.locator('#raccolta-dati-controllo');
    if(type==='testo')await area.locator('textarea').fill('QA-DIGITATA-SENZA-BLUR');
    else if(type==='numero')await area.locator('input').fill('42');
    else if(type==='si-no'||type==='scelta-singola')await area.locator('input[type=radio]').first().check();
    else if(type==='checkbox-multi')await area.locator('input[type=checkbox]').first().check();
    else await area.locator('input,textarea').first().fill('QA-DIGITATA-SENZA-BLUR');
    await page.waitForFunction(async()=>!!(await db.leggiSopralluogo(controlFixture.id)).risposte.length);
    await page.locator('#btn-note').click();await page.locator('#nota-testo').fill('QA-NOTA-CONTROLLO');
    await page.waitForFunction(async()=>(await db.leggiSopralluogo(controlFixture.id)).risposte[0].note==='QA-NOTA-CONTROLLO');
    const snapshot=await page.evaluate(async()=>{await compilazioneScreen.attendiSalvataggi();const r=(await db.leggiSopralluogo(controlFixture.id)).risposte[0];if(r.risposta===null||r.risposta===undefined)throw Error('Note erased answer');return{id:controlFixture.id,question:controlFixture.q.id,response:r.risposta};});
    await page.reload();await page.waitForFunction(()=>appAutenticataAvviata);
    const restored=await page.evaluate(async id=>(await db.leggiSopralluogo(id)).risposte[0],snapshot.id);assert.deepEqual(restored.risposta,snapshot.response);assert.equal(restored.note,'QA-NOTA-CONTROLLO');return{question:snapshot.question};
  });
  await check('DVR nessun errore JavaScript o accesso a produzione',async()=>{assert.deepEqual(report.errors,[]);assert.deepEqual(report.blocked,[]);});
})().catch(e=>{report.fatal=e.stack;process.exitCode=1;console.error(e);}).finally(async()=>{
  if(page)await page.evaluate(async()=>{for(const r of await db.elencaTuttiSopralluoghi())await db.eliminaSopralluogoSenzaNotifica(r.id);}).catch(()=>{});
  await context?.close();await browser?.close();server.close();report.cleaned=true;fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(report,null,2));if(report.tests.some(t=>t.status==='FAIL'))process.exitCode=1;
});
