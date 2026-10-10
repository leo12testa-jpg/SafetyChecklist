const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {root,playwright,makeServer,guard}=require('./qa-support.cjs');
const server=makeServer(),out=path.join(root,'reports/qa-historical');fs.mkdirSync(out,{recursive:true});
const report={tests:[],documents:[]};let browser;
async function check(name,fn){try{const details=await fn();report.tests.push({name,status:'PASS',details});console.log('PASS '+name);}catch(e){report.tests.push({name,status:'FAIL',error:e.stack});console.error(e);}fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(report,null,2));}
(async()=>{
  const url=await server.start();browser=await playwright().chromium.launch({channel:'chrome',headless:true});const context=await browser.newContext({serviceWorkers:'block'});await guard(context,server.origin);const page=await context.newPage();await page.goto(url);
  const oracle=JSON.parse(fs.readFileSync(path.join(root,'tests/fixtures/historical/oracle.json'),'utf8'));
  for(const fixture of oracle){
    await check(fixture.file+' responses and notes compared source row by source row',async()=>{
      const result=await page.evaluate(async fixture=>{
        const blob=await(await fetch('tests/fixtures/historical/'+fixture.file)).blob(),ex=await pdfImport.estraiRighe(blob);
        window.historicalDebug=ex;
        const tokens=r=>new Set(String(r.nota_originale||'').match(/QA-P\d+-R\d+/g)||[]);
        for(const expected of fixture.rows){const matches=ex.righe.filter(r=>tokens(r).has(expected.note));if(matches.length!==1)throw Error('Note owner mismatch '+expected.note+' matches '+matches.length);
          if(matches[0].stato_originale!==expected.state)throw Error('State mismatch '+expected.note+' '+matches[0].stato_originale+' expected '+expected.state);
          const other=fixture.rows.filter(r=>r.note!==expected.note&&tokens(matches[0]).has(r.note));if(other.length)throw Error('Adjacent note contamination '+expected.note+' other='+other.map(o=>o.note).join(',')+' source='+JSON.stringify(matches[0]));
        }
        for(const row of ex.righe)if(!tokens(row).size && (row.stato_originale!=null || row.nota_originale))throw Error('Unexpected non-anonymized response/note');
        const expectedPhotos=fixture.file.startsWith('coin')?0:5;
        if(ex.immagini.length!==expectedPhotos)throw Error('Wrong historical photo count '+ex.immagini.length+' expected '+expectedPhotos);
        const client=fixture.file.startsWith('coin')?'coin':'restage',cl=await checklistEngine.carica(client+'_sopralluogo');
        const matched=importMatching.abbinaRighe(ex.righe,cl,{puntoDivisioneGruppi:pdf.calcolaPuntoDivisioneGruppi(cl)});
        const photos=importMatching.collegaImmaginiAlleDomande(ex.immagini,matched.righe,cl);
        window.historical={ex,matched,photos,cl};
        return {rows:ex.righe.length,photos:photos.length,uncertain:matched.righe.filter(r=>!importMatching.rigaImportabile(r)).length,states:ex.righe.map(r=>({note:r.nota_originale,state:r.stato_originale,question:r.testo_originale})),photoOwners:photos.map(p=>p.domanda_id_collegata)};
      },fixture);report.documents.push({file:fixture.file,...result});return{rows:result.rows,photos:result.photos,uncertain:result.uncertain};
    });
    await check(fixture.file+' preview and manual confirmation preserve uncertain source ownership',async()=>{
      await page.evaluate(()=>{
        const {ex,matched,photos,cl}=historical;
        anteprimaImportazionePendente={...ex,...matched,immagini:photos,checklist:cl,checklistTitolo:cl.titolo,rilevamentoAutomatico:true,bozzaAnagrafica:{checklist_id:cl.id,punto_vendita:'QA Storico Anonimo',tecnico:'QA'}};router.navigate('import-preview');
      });
      const unresolved=await page.evaluate(()=>anteprimaImportazionePendente.righe.filter(r=>r.domanda_id!=null&&!importMatching.rigaImportabile(r)).length);
      if(unresolved){page.once('dialog',d=>d.accept());await page.locator('#btn-conferma-import').click();assert.equal(await page.evaluate(()=>!!anteprimaImportazionePendente),true);}
      await page.screenshot({path:path.join(out,fixture.file+'.png'),fullPage:true});
      await page.locator('#btn-annulla-import-preview').click();assert.equal(await page.evaluate(async()=>(await db.elencaSopralluoghi()).length),0);
    });
  }
})().catch(e=>{report.fatal=e.stack;process.exitCode=1;console.error(e);}).finally(async()=>{await browser?.close();server.close();fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(report,null,2));if(report.tests.some(t=>t.status==='FAIL'))process.exitCode=1;});
