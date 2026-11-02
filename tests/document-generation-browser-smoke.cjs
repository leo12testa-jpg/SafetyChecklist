// Browser smoke: DUVRI document screen has ONLY two visible upload zones.
// Synthetic files and loopback-only server; external network is blocked.
const assert=require('node:assert/strict');
const JSZip=require('../js/vendor/jszip.min.js');
const {makeServer,guard,playwright}=require('./qa-support.cjs');

const engine=process.env.DUVRI_BROWSER || 'chromium';
const browserType=playwright('chromium')[engine];
const server=makeServer({raw:true});
const executablePath=engine==='chromium' ? process.env.CHROME_PATH : undefined;

async function expose(page,viewport) {
  await page.setViewportSize(viewport);
  await page.goto(server.origin+'/SafetyChecklist/',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('#screen-document-generation',{state:'attached'});
  await page.waitForFunction(()=>document.body.dataset.authReady==='true');
  await page.evaluate(()=>{
    document.body.dataset.authReady='true';
    document.body.dataset.authenticated='true';
    document.body.dataset.role='admin';
    document.querySelector('#login-view').hidden=true;
    document.querySelector('#screens').hidden=false;
    document.querySelectorAll('.screen').forEach(s=>{
      s.hidden=s.dataset.screen!=='document-generation';
    });
  });
  await page.waitForTimeout(120);
}
async function syntheticDocx() {
  const zip=new JSZip();
  zip.file('word/document.xml',
    '<w:document xmlns:w="w"><w:body><w:p><w:r><w:t>'+
    'Checklist committente sintetica'+
    '</w:t></w:r></w:p></w:body></w:document>');
  return zip.generateAsync({type:'nodebuffer'});
}

(async()=>{
  const origin=await server.start();
  const browser=await browserType.launch({
    ...(executablePath?{executablePath}:{}),
    headless:true,
    ...(engine==='chromium'?{args:['--no-sandbox']}: {})
  });
  try{
    const context=await browser.newContext({serviceWorkers:'block',acceptDownloads:true});
    const blocked=await guard(context,new URL(origin).origin);
    const checklistBytes=await syntheticDocx();
    for(const viewport of [{width:1440,height:900},{width:390,height:844}]){
      const page=await context.newPage();
      const pageErrors=[];
      page.on('pageerror',error=>pageErrors.push(String(error)));
      page.on('dialog',dialog=>dialog.dismiss());
      await expose(page,viewport);
      const before=blocked.length;
      const layout=await page.evaluate(()=>{
        const screen=document.querySelector('#screen-document-generation');
        const visible=el=>Boolean(el&&getComputedStyle(el).display!=='none' &&
          el.getClientRects().length>0);
        const areas=[...screen.querySelectorAll('.dg-intake-area')];
        const visibleUploads=[...screen.querySelectorAll('input[type="file"]')]
          .filter(visible).map(el=>el.id);
        return {
          visibleUploads,areaCount:areas.filter(visible).length,
          columns:areas.length===2 &&
            Math.abs(areas[0].getBoundingClientRect().left-
              areas[1].getBoundingClientRect().left)>1?2:1,
          oldFormVisible:visible(screen.querySelector('#dg-form')),
          oldTemplateVisible:visible(screen.querySelector('#dg-template-details')),
          oldQueueVisible:visible(screen.querySelector('.dg-queue-panel')),
          oldQuestionnaireVisible:visible(screen.querySelector('.dg-prototype-alert')),
          oldResultsVisible:visible(screen.querySelector('#dg-auto-results')),
          typePickerVisible:visible(screen.querySelector('#dg-auto-type')),
          width:innerWidth,scrollWidth:document.documentElement.scrollWidth
        };
      });
      assert.deepEqual(layout.visibleUploads,
        ['dg-checklist-file','dg-auto-files'],
        'solo due caricatori visibili: Word e tutti gli allegati');
      assert.equal(layout.areaCount,2);
      assert.equal(layout.columns,viewport.width>700?2:1);
      assert.ok(layout.scrollWidth<=layout.width+2,'overflow orizzontale');
      for(const prop of [
        'oldFormVisible','oldTemplateVisible','oldQueueVisible',
        'oldQuestionnaireVisible','oldResultsVisible','typePickerVisible'
      ]) assert.equal(layout[prop],false,prop+' deve essere nascosto');
      assert.equal(await page.locator('#dg-checklist-file').getAttribute('accept'),'.docx');
      assert.equal(await page.locator('#dg-auto-files').getAttribute('multiple'),'');
      await page.locator('#dg-checklist-file').setInputFiles({
        name:'checklist-cliente.docx',
        mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        buffer:checklistBytes
      });
      await page.waitForFunction(()=>
        document.getElementById('dg-checklist-file-status').textContent.includes('checklist-cliente.docx')
      );
      const removeChecklist=page.locator('#dg-checklist-remove');
      assert.equal(await removeChecklist.isVisible(),true);
      await page.locator('#dg-auto-files').setInputFiles([
        {name:'dvr-specifico.pdf',mimeType:'application/pdf',
          buffer:Buffer.from('PDF sintetico non reale')},
        {name:'foto-sito.jpg',mimeType:'image/jpeg',
          buffer:Buffer.from([0xff,0xd8,0xff,0xe0,1,2,3,4])}
      ]);
      await page.waitForFunction(()=>
        document.getElementById('dg-auto-files-list').querySelectorAll('li').length===2
      );
      assert.equal(await page.locator('#dg-auto-files-list > li').count(),2);
      assert.equal(await page.locator('#dg-auto-files-list select').first().isVisible(),false,
        'nessuna correzione categoria manuale nella vista ridotta');
      assert.equal(await page.locator('#dg-auto-files-list > li:first-child button').isVisible(),true,
        'consentire la rimozione di un allegato');
      await page.locator('#dg-auto-files-list > li:first-child button').click();
      assert.equal(await page.locator('#dg-auto-files-list > li').count(),1);
      await removeChecklist.click();
      assert.match(await page.locator('#dg-checklist-file-status').textContent(),
        /Nessuna checklist Word selezionata/);
      assert.equal(blocked.length,before,'nessuna chiamata esterna o cloud');
      assert.deepEqual(pageErrors,[],'nessun errore JavaScript');
      await page.close();
      console.log('DUVRI TWO UPLOAD UI PASS',JSON.stringify({engine,viewport,layout}));
    }
    await context.close();
  }finally{
    await browser.close();
    await new Promise(resolve=>server.close(resolve));
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
