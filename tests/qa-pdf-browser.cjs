const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {root,playwright,makeServer,guard}=require('./qa-support.cjs');
const out=path.join(root,'reports/qa-v1/pdf');fs.mkdirSync(out,{recursive:true});
const report={tests:[],errors:[],blocked:[],artifacts:[]};
let page,context,browser;const server=makeServer();
async function check(name,fn){try{const details=await fn();report.tests.push({name,status:'PASS',details});console.log('PASS '+name);}catch(e){report.tests.push({name,status:'FAIL',error:e.stack});console.error('FAIL '+name+' '+e.message);}fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(report,null,2));}
async function savePdf(client,result) {
  const file=path.join(out,client+'.pdf');fs.writeFileSync(file,Buffer.from(result.bytes));report.artifacts.push(path.basename(file));
  const renders=await page.evaluate(async bytes=>{
    const doc=await pdfjsLib.getDocument({data:new Uint8Array(bytes)}).promise;const images=[];
    for(let n=1;n<=doc.numPages;n++){
      const p=await doc.getPage(n),v=p.getViewport({scale:0.8}),c=document.createElement('canvas');c.width=v.width;c.height=v.height;
      await p.render({canvasContext:c.getContext('2d'),viewport:v}).promise;images.push(c.toDataURL('image/png'));
    }await doc.destroy();return images;
  },result.bytes);
  renders.forEach((data,i)=>fs.writeFileSync(path.join(out,`${client}-page-${i+1}.png`),Buffer.from(data.split(',')[1],'base64')));
}
(async()=>{
  const url=await server.start();browser=await playwright().chromium.launch({headless:true,channel:'chrome'});context=await browser.newContext({acceptDownloads:true,serviceWorkers:'block'});
  report.blocked=await guard(context,server.origin);page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));page.on('dialog',d=>d.accept());page.setDefaultTimeout(30000);
  await page.goto(url);await page.waitForFunction(()=>typeof importPreviewScreen!=='undefined'&&appAutenticataAvviata);
  for(const client of ['coin','interparking','restage','melluso','carrefour']) {
    await check(`${client}: PDF completo e roundtrip di ogni risposta/nota/foto`,async()=>{
      const result=await page.evaluate(async client=>{
        const cl=await checklistEngine.carica(client+'_sopralluogo');
        const record=await db.creaSopralluogo({checklist_id:cl.id,checklist_versione:cl.versione,punto_vendita:'QA Fittizio '+client,data_sopralluogo:'2026-10-09',tecnico:'QA Fittizio',note_aggiuntive:'NOTE-GENERALI-QA'});
        const canvas=document.createElement('canvas');canvas.width=180;canvas.height=120;const cx=canvas.getContext('2d');cx.fillStyle='#c22';cx.fillRect(0,0,180,120);cx.fillStyle='white';cx.fillText('FOTO QA FITTIZIA',10,50);
        const photo=await db.salvaFoto({sopralluogo_id:record.id,domanda_id:cl.sezioni[0].domande[0].id,blob:await new Promise(r=>canvas.toBlob(r,'image/jpeg'))});
        const questions=cl.sezioni.flatMap(s=>s.domande);
        record.risposte=questions.map((q,i)=>({domanda_id:q.id,risposta:i===5?null:['C','PC','NC','NA'][i%4],note:i===3?'NOTA-LUNGA-3 '+('Testo lungo prova multipagina. '.repeat(250))+' FINE-NOTA-3':i===6?null:'QA-NOTA-'+i,foto:i===0?[photo]:[]}));
        const blob=await pdf.generaReport(cl,record),bytes=Array.from(new Uint8Array(await pdf.leggiArrayBuffer(blob)));
        const extracted=await pdfImport.estraiRighe(blob);
        window.qaDebug={client,bytes,extracted,record};
        const clean=s=>String(s||'').replace(/\s+/g,' ').trim();
        if(extracted.righe.length!==questions.length)throw new Error(`rows ${extracted.righe.length} expected ${questions.length}`);
        for(let i=0;i<questions.length;i++){
          const source=extracted.righe[i],expected=record.risposte[i];
          if(source.stato_originale!==expected.risposta)throw new Error(`state source position ${i+1} id ${expected.domanda_id}: ${source.stato_originale} != ${expected.risposta}`);
          if(!clean(source.nota_originale).startsWith(clean(expected.note)))throw new Error(`note shifted at ${i+1}: actual=${clean(source.nota_originale).slice(0,160)} length=${clean(source.nota_originale).length} expected=${clean(expected.note).length}`);
          for(const token of (i===3?['NOTA-LUNGA-3','FINE-NOTA-3']:['QA-NOTA-'+i]))if(expected.note&& !clean(source.nota_originale).includes(token))throw new Error(`note truncated ${i+1}: ${token}`);
          if(i!==3&&clean(source.nota_originale).includes('FINE-NOTA-3'))throw new Error('long note leaked');
        }
        const parsed=await pdfjsLib.getDocument({data:new Uint8Array(bytes)}).promise;
        let text='';for(let n=1;n<=parsed.numPages;n++)text+=(await(await parsed.getPage(n)).getTextContent()).items.map(i=>i.str).join(' ');
        const pages=parsed.numPages;await parsed.destroy();
        if(!text.includes('FINE-NOTA-3')||!text.includes('QA Fittizio'))throw new Error('missing report data');
        if(extracted.immagini.length!==1)throw new Error('header imported or photo missing: '+extracted.immagini.length);
        const match=importMatching.abbinaRighe(extracted.righe,cl,{puntoDivisioneGruppi:pdf.calcolaPuntoDivisioneGruppi(cl)});
        const linked=importMatching.collegaImmaginiAlleDomande(extracted.immagini,match.righe,cl);
        if(linked[0].domanda_id_collegata!==questions[0].id)throw new Error('wrong photo question');
        window.qaFixture={cl,record,blob,extracted,match,linked};
        return {bytes,pages,questions:questions.length,sourceRows:extracted.righe.length,uncertain:match.righe.filter(r=>!importMatching.rigaImportabile(r)).length,photoQuestion:linked[0].domanda_id_collegata};
      },client);
      await savePdf(client,result);delete result.bytes;return result;
    });
  }
  await check('vecchia versione PDF: domande rinumerate, spostate, eliminate e simili',async()=>{
    return page.evaluate(async()=>{
      const old={id:'qa_versions',titolo:'QA Versioni',versione:'old',sezioni:[{titolo:'VERIFICHE',domande:[
        {id:1,testo:'Nomina del responsabile della sicurezza RSPP in archivio?',tipo:'C-PC-NC-NA'},
        {id:2,testo:'Verifica porte tagliafuoco e dispositivi di chiusura?',tipo:'C-PC-NC-NA'},
        {id:3,testo:'Gli estintori sono mantenuti accessibili e visibili?',tipo:'C-PC-NC-NA'},
        {id:4,testo:'Sono mantenuti accessibili e visibili?',tipo:'C-PC-NC-NA'},
        {id:5,testo:'Illuminazione emergenza funzionante?',tipo:'C-PC-NC-NA'}]}]};
      const target={...old,versione:'new',sezioni:[{titolo:'SPOSTATA',domande:[old.sezioni[0].domande[4],{...old.sezioni[0].domande[1],id:101},{...old.sezioni[0].domande[0],id:102},
        {id:3,testo:'Gli idranti sono mantenuti accessibili e visibili?'},{id:4,testo:'Le uscite sono mantenute accessibili e visibili?'}]}]};
      const record=await db.creaSopralluogo({checklist_id:old.id,punto_vendita:'QA Versione Vecchia'});
      record.risposte=old.sezioni[0].domande.map((q,i)=>({domanda_id:q.id,risposta:i===4?null:['C','PC','NC','NA'][i%4],note:'SOURCE-'+q.id,foto:[]}));
      const blob=await pdf.generaReport(old,record),ex=await pdfImport.estraiRighe(blob),matched=importMatching.abbinaRighe(ex.righe,target);
      const expected=[102,101,null,null,5];
      matched.righe.forEach((r,i)=>{
        if(r.note!=='SOURCE-'+(i+1))throw new Error('source note changed');
        if(expected[i]===null){if(importMatching.rigaImportabile(r))throw new Error('uncertain imported automatically');}
        else if(r.domanda_id!==expected[i])throw new Error('renumbered/moved question wrong');
      });
      window.qaVersionFixture={old,target,record,blob,ex,matched};
      return matched.righe.map(r=>({source:r.originale.numero_originale,destination:r.domanda_id,state:r.stato_riga,note:r.note}));
    });
  });
  await check('anteprima importa esclusivamente dopo conferma e salva foto su domanda corretta',async()=>{
    await page.evaluate(async()=>{
      const {cl,extracted,match,linked}=qaFixture;
      window.qaBefore=(await db.elencaSopralluoghi()).length;
      anteprimaImportazionePendente={...extracted,...match,immagini:linked,checklist:cl,rilevamentoAutomatico:true,checklistTitolo:cl.titolo,bozzaAnagrafica:{checklist_id:cl.id,punto_vendita:'QA Import Confermato',tecnico:'QA Fittizio'}};
      router.navigate('import-preview');
      if((await db.elencaSopralluoghi()).length!==qaBefore)throw new Error('preview already saved');
    });
    // The oracle knows each source row in this synthetic PDF; explicitly review
    // uncertain associations through the same select/change UI used by operators.
    const uncertain=await page.evaluate(()=>anteprimaImportazionePendente.righe.filter(r=>!importMatching.rigaImportabile(r)&&r.domanda_id!=null).map(r=>({index:r.indice,id:r.domanda_id})));
    for(const row of uncertain){
      await page.locator(`.import-riga[data-indice="${row.index}"] .import-riga-conferma`).click();
    }
    await page.locator('#btn-conferma-import').click();await page.waitForFunction(()=>anteprimaImportazionePendente===null);
    return page.evaluate(async()=>{
      const r=(await db.elencaSopralluoghi()).find(r=>r.punto_vendita==='QA Import Confermato');
      if(!r||(await db.elencaSopralluoghi()).length!==qaBefore+1)throw new Error('import not persisted');
      for(const a of r.risposte)for(const id of a.foto||[])if((await db.leggiFoto(id)).domanda_id!==a.domanda_id)throw new Error('photo wrong owner');
      return {responses:r.risposte.length};
    });
  });
  await check('conferma ambigua bloccata fino alla scelta manuale domanda',async()=>{
    await page.evaluate(()=>{
      const {target,ex,matched}=qaVersionFixture;
      anteprimaImportazionePendente={...ex,...matched,immagini:[],checklist:target,rilevamentoAutomatico:true,checklistTitolo:target.titolo,bozzaAnagrafica:{checklist_id:target.id,punto_vendita:'QA Ambiguo'}};
      router.navigate('import-preview');
    });
    await page.locator('#btn-conferma-import').click();
    assert.equal(await page.evaluate(()=>!!anteprimaImportazionePendente),true);
    assert.equal(await page.evaluate(async()=>(await db.elencaSopralluoghi()).some(r=>r.punto_vendita==='QA Ambiguo')),false);
    await page.evaluate(()=>{anteprimaImportazionePendente=null;router.navigate('home');});
  });
  await check('caricamento PDF reale da input file, annullamento senza scrittura',async()=>{
    const before=await page.evaluate(async()=>(await db.elencaSopralluoghi()).length);
    await page.evaluate(()=>router.navigate('new-inspection'));
    await page.locator('#input-importa-pdf').setInputFiles(path.join(out,'coin.pdf'));
    await page.waitForFunction(()=>anteprimaImportazionePendente?.righe?.length>0);
    assert.equal(await page.evaluate(async()=>(await db.elencaSopralluoghi()).length),before);
    await page.screenshot({path:path.join(out,'upload-anteprima.png'),fullPage:true});
    await page.evaluate(()=>{anteprimaImportazionePendente=null;router.navigate('home');});
  });
  await check('anteprima PDF, download reale e riapertura',async()=>{
    await page.evaluate(()=>pdf.apri(qaFixture.blob,'qa-preview.pdf',null));assert.ok(await page.locator('.pdf-preview-overlay canvas').count()>1);
    await page.screenshot({path:path.join(out,'preview.png')});await page.getByRole('button',{name:'Chiudi anteprima PDF'}).click();
    const downloading=page.waitForEvent('download');await page.evaluate(()=>pdf.scarica(qaFixture.blob,'qa-download.pdf'));const d=await downloading;
    await d.saveAs(path.join(out,'download.pdf'));const bytes=fs.readFileSync(path.join(out,'download.pdf'));assert.equal(bytes.subarray(0,5).toString(),'%PDF-');
    const pages=await page.evaluate(async bytes=>{const doc=await pdfjsLib.getDocument({data:new Uint8Array(bytes)}).promise;const pages=doc.numPages;await doc.destroy();return pages;},Array.from(bytes));assert.ok(pages>1);return {pages,bytes:bytes.length};
  });
  await check('PDF corrotto rifiutato',async()=>{
    assert.equal(await page.evaluate(async()=>{try{await pdfImport.estraiRighe(new Blob(['%PDF-1.4\ncorrupt']));return false;}catch{return true;}}),true);
  });
  await check('nessun errore JavaScript, nessuna rete cloud',async()=>{assert.deepEqual(report.errors,[]);assert.deepEqual(report.blocked,[]);});
})().catch(e=>{report.fatal=e.stack;process.exitCode=1;console.error(e);}).finally(async()=>{
  if(page)await page.evaluate(async()=>{for(const r of await db.elencaTuttiSopralluoghi())await db.eliminaSopralluogoSenzaNotifica(r.id);}).catch(()=>{});
  await context?.close();await browser?.close();server.close();report.cleaned='isolated browser context closed; synthetic records deleted';
  fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(report,null,2));if(report.tests.some(t=>t.status==='FAIL'))process.exitCode=1;
});
