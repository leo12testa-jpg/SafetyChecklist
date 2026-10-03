const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {chromium}=require('playwright-core');

const BASE=process.env.ORE_LIVE_URL||'https://leo12testa-jpg.github.io/SafetyChecklist/ore-produttivita/';
const executablePath=process.env.CHROME_PATH;
if(!executablePath) throw new Error('CHROME_PATH mancante');

const out=path.join(process.cwd(),'reports','ore-ui');
fs.mkdirSync(out,{recursive:true});

function overlaps(a,b){
  const x=Math.max(0,Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x));
  const y=Math.max(0,Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y));
  return x*y>6;
}
async function noOverlap(page,selector,label){
  const boxes=await page.locator(selector).evaluateAll(els=>els.filter(el=>{
    const s=getComputedStyle(el),r=el.getBoundingClientRect();
    return !el.hidden&&s.display!=='none'&&s.visibility!=='hidden'&&r.width>1&&r.height>1;
  }).map(el=>{
    const r=el.getBoundingClientRect();
    return {x:r.x,y:r.y,width:r.width,height:r.height};
  }));
  for(let i=0;i<boxes.length;i++) for(let j=i+1;j<boxes.length;j++){
    assert.equal(overlaps(boxes[i],boxes[j]),false,`${label} overlap ${i}/${j}`);
  }
}
async function fit(page,label){
  const m=await page.evaluate(()=>({
    vw:innerWidth,
    doc:document.documentElement.scrollWidth,
    body:document.body.scrollWidth,
    content:document.querySelector('.app-content')?.getBoundingClientRect().width||0
  }));
  assert.ok(m.doc<=m.vw+2,`${label} document overflow: ${JSON.stringify(m)}`);
  assert.ok(m.body<=m.vw+2,`${label} body overflow: ${JSON.stringify(m)}`);
  assert.ok(m.content>0,`${label} app content missing`);
}
async function prepare(page,screen){
  await page.evaluate(screen=>{
    document.querySelector('#loginView').hidden=true;
    const app=document.querySelector('#appView');
    app.hidden=false;
    document.querySelector('#oreUpdateBanner').hidden=true;
    document.querySelector('#userName').textContent='Leonardo Testa';
    document.querySelector('#userRole').textContent='Amministratore';
    document.querySelectorAll('.side-nav-item').forEach(x=>x.hidden=false);
    document.querySelectorAll('.screen').forEach(x=>x.hidden=x.id!==screen);

    if(screen==='dayPanel'){
      document.querySelector('#crmSyncStatus').textContent='LT · 03/10, 11:30';
      document.querySelector('#crmDetected').innerHTML='<div class="crm-empty">Nessun appuntamento CRM importato per questa data.</div>';
      document.querySelector('#sessions').innerHTML='<div class="empty">Nessuna attività per questa giornata.</div>';
      document.querySelector('#recentActivities').innerHTML=
        '<article class="recent-card"><div><span class="code-pill code-c">46C</span><strong>Preven srl · MMC</strong></div><small>Rendicontazione MMC</small><button type="button">＋ Aggiungi ore</button></article>'+
        '<article class="recent-card"><div><span class="code-pill code-o">1O</span><strong>PAM PANORAMA SPA · Forfait / Consulenza</strong></div><small>PAM - Forfait Consulenza 2026</small><button type="button">＋ Aggiungi ore</button></article>';
    }

    if(screen==='adminPanel'){
      document.querySelector('#kpiHours').textContent='17,5';
      document.querySelector('#kpiJobs').textContent='3';
      document.querySelector('#kpiAvgJob').textContent='5,8h';
      document.querySelector('#kpiTechs').textContent='2';
      document.querySelector('#kpiClients').textContent='3';
      document.querySelector('#crmSyncFresh').textContent='2 aggiornati';
      document.querySelector('#crmSyncLate').textContent='1 in ritardo';
      document.querySelector('#crmSyncNever').textContent='21 mai';
      document.querySelector('#crmResourceCount').textContent='24';
      document.querySelector('#crmResourceRows').innerHTML=Array.from({length:24},(_,i)=>
        `<tr><td><b>T${String(i+1).padStart(2,'0')}</b></td><td>Tecnico ${i+1}</td><td>${i<3?'03/10/2026, 11:30':'Mai'}</td><td><span class="sync-state ${i<2?'sync-ok':i===2?'sync-late':'sync-never'}">${i<2?'Aggiornato':i===2?'In ritardo':'Mai sincronizzato'}</span></td></tr>`
      ).join('');
    }

    if(screen==='archivePanel'){
      document.querySelector('#archiveJobsCount').textContent='227';
      document.querySelector('#archiveSessionsCount').textContent='1000';
      document.querySelector('#archiveHoursCount').textContent='3911';
      document.querySelector('#archiveTechCount').textContent='21';
      document.querySelector('#archiveRows').innerHTML=Array.from({length:12},(_,i)=>
        `<tr>
          <td><span class="archive-code">${18+i}P</span><br><span class="muted">CM00${2200+i}</span></td>
          <td><b>Cliente aziendale con nome ${i+1}</b></td>
          <td><b>DVR / pratica tecnica con descrizione sufficientemente lunga ${i+1}</b></td>
          <td>MMC</td>
          <td><span class="archive-status ${i%2?'':'completed'}">${i%2?'In lavorazione':'Completata'}</span></td>
          <td><b>${i+1},5 h</b></td><td>${i+2}</td><td>1</td><td>03/10/2026</td>
          <td><button class="archive-open" type="button">Apri</button></td>
        </tr>`
      ).join('');
    }

    if(screen==='economicsPanel'){
      document.querySelector('#econCoverage').textContent='82%';
      document.querySelector('#econInternalCost').textContent='4.320 €';
      document.querySelector('#econRevenue').textContent='7.900 €';
      document.querySelector('#econMargin').textContent='45%';
      document.querySelector('#costRateRows').innerHTML=Array.from({length:8},(_,i)=>
        `<tr><td><b>Tecnico ${i+1}</b><br><span class="muted">Storico CRM</span></td><td><input value="35"></td><td><input type="date" value="2026-01-01"></td><td><input type="date"></td><td><button type="button">Salva</button></td></tr>`
      ).join('');
    }
  },screen);
  await page.waitForTimeout(80);
}

(async()=>{
  const browser=await chromium.launch({executablePath,headless:true,args:['--no-sandbox']});
  try{
    const context=await browser.newContext({serviceWorkers:'block'});
    const viewports=[
      {name:'desktop',width:1440,height:1000},
      {name:'tablet',width:1024,height:900},
      {name:'phone',width:390,height:844}
    ];
    const screens=['dayPanel','adminPanel','archivePanel','economicsPanel'];

    for(const vp of viewports){
      const page=await context.newPage();
      await page.setViewportSize({width:vp.width,height:vp.height});
      await page.goto(BASE,{waitUntil:'domcontentloaded',timeout:45000});
      await page.waitForSelector('#loginView',{timeout:15000});

      for(const screen of screens){
        await prepare(page,screen);
        await fit(page,`${vp.name}/${screen}`);
        await noOverlap(page,`#${screen} .summary-card`,`${vp.name}/${screen} KPI`);

        if(screen==='dayPanel'){
          const agendaH=await page.locator('.crm-detected-card').evaluate(el=>el.getBoundingClientRect().height);
          assert.ok(agendaH<190,`${vp.name} empty agenda too tall: ${agendaH}`);
          const emptyH=await page.locator('#sessions .empty').evaluate(el=>el.getBoundingClientRect().height);
          assert.ok(emptyH<=90,`${vp.name} empty hours state too tall: ${emptyH}`);
        }
        if(screen==='adminPanel'){
          const details=page.locator('details.company-sync-panel');
          assert.equal(await details.getAttribute('open'),null,`${vp.name} CRM details should start collapsed`);
          const h=await details.evaluate(el=>el.getBoundingClientRect().height);
          assert.ok(h<125,`${vp.name} collapsed CRM panel too tall: ${h}`);
        }
        if(screen==='archivePanel'){
          const btn=page.locator('.archive-open').first();
          const b=await btn.evaluate(el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return {w:r.width,h:r.height,whiteSpace:s.whiteSpace}});
          assert.ok(b.w>=50&&b.h<=42,`${vp.name} archive Apri geometry: ${JSON.stringify(b)}`);
          assert.equal(b.whiteSpace,'nowrap',`${vp.name} archive Apri wraps`);
        }
        if(screen==='economicsPanel'){
          const guide=page.locator('details.economics-guide');
          assert.equal(await guide.getAttribute('open'),null,`${vp.name} economics guide should start collapsed`);
          const h=await guide.evaluate(el=>el.getBoundingClientRect().height);
          assert.ok(h<105,`${vp.name} collapsed economics guide too tall: ${h}`);
        }

        await page.screenshot({path:path.join(out,`${screen.replace('Panel','')}-${vp.name}.png`),fullPage:true});
      }
      await page.close();
    }
    console.log('ORE UI VISUAL SMOKE PASS');
  }finally{
    await browser.close();
  }
})().catch(err=>{console.error(err);process.exit(1)});
