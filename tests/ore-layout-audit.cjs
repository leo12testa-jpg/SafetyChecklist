// Visual audit uses the shared Firebase/backend fixtures, including manual-only resources.
const {run,server}=require('./ore-browser-fixtures.cjs');


const PROBLEMS=[];
async function auditPage(page,label,mobile){
  for(const t of ['#tabDay','#tabAdmin','#tabArchive','#tabEconomics']){
    if(!(await page.locator(t).isVisible().catch(()=>false)))continue;
    await page.click(t);await page.waitForTimeout(700);
    await page.evaluate(()=>document.querySelectorAll('#appView details').forEach(d=>d.open=true));
    for(const b of await page.locator('#appView details button[id^="load"]').all()){if(await b.isVisible().catch(()=>false))await b.click().catch(()=>{})}
    await page.waitForTimeout(600);
    await page.evaluate(()=>document.querySelectorAll('#appView details').forEach(d=>d.open=true));
    await page.mouse.move(5,5);await page.waitForTimeout(200);
    const found=await page.evaluate(({mobile})=>{
      const out=[];const vis=e=>{const r=e.getBoundingClientRect(),cs=getComputedStyle(e);return r.width>0&&r.height>0&&cs.visibility!=='hidden'&&cs.display!=='none'&&!e.closest('[hidden]')};
      const name=e=>(e.id?'#'+e.id:'')+(e.className&&typeof e.className==='string'?'.'+e.className.split(' ')[0]:'')+' «'+(e.textContent||e.getAttribute('aria-label')||'').trim().slice(0,30)+'»';
      // 1. contenitori di icona: solo SVG della libreria, nessun simbolo di testo
      document.querySelectorAll('#appView .nav-icon,#appView .summary-icon,#appView .icon-btn,#refreshDay,#appView .proto-close').forEach(e=>{if(!vis(e))return;if(!e.querySelector('svg.ico')||e.textContent.trim())out.push('Icona non SVG: '+name(e))});
      // 2. dimensioni icone coerenti per contesto
      const sz={};document.querySelectorAll('#appView svg.ico').forEach(s=>{if(!vis(s))return;const ctx=s.closest('.nav-icon')?'nav':s.closest('.summary-icon')?'kpi':s.classList.contains('ico-inline')?'inline':'btn';const r=s.getBoundingClientRect();(sz[ctx]=sz[ctx]||new Set()).add(Math.round(r.width)+'x'+Math.round(r.height))});
      for(const [k,v] of Object.entries(sz))if(v.size>1)out.push(`Icone "${k}" di dimensioni diverse: ${[...v].join(', ')}`);
      // 3. testo leggibile: minimo 12px
      document.querySelectorAll('#appView *').forEach(e=>{if(!vis(e))return;if(![...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim().length>1))return;const fs=parseFloat(getComputedStyle(e).fontSize);if(fs<11.9)out.push(`Testo ${fs}px: ${name(e)}`)});
      // 4. pulsanti: altezze ammesse
      const allowed=mobile?[40,44]:[32,36,44];
      document.querySelectorAll('#appView button,#appView summary').forEach(b=>{if(!vis(b)||b.closest('.toast-host'))return;const h=Math.round(b.getBoundingClientRect().height);const multi=h>44&&b.textContent.trim().length>12;if(b.tagName==='SUMMARY'?h<(mobile?40:32):mobile?h<40:!allowed.includes(h)&&!multi)out.push(`Altezza ${h}px fuori standard: ${name(b)}`)});
      // 5. su telefono: campi toccabili almeno 40px
      if(mobile)document.querySelectorAll('#appView input:not([type=checkbox]):not([type=radio]),#appView select').forEach(e=>{if(vis(e)&&e.getBoundingClientRect().height<39.5)out.push('Campo troppo basso su mobile: '+name(e))});
      // 6. elementi del browser senza stile (bordo nero di default)
      document.querySelectorAll('#appView button').forEach(b=>{if(vis(b)&&getComputedStyle(b).borderTopColor==='rgb(0, 0, 0)')out.push('Pulsante senza stile: '+name(b))});
      // 7. pannelli <details> diretti delle sezioni: devono avere l'aspetto di card
      document.querySelectorAll('#adminPanel>details,#archivePanel>details,#economicsPanel>details').forEach(d=>{if(!vis(d))return;const sm=d.querySelector('summary')||d;let e=sm,ok=false;while(e&&e!==d.parentElement){if(getComputedStyle(e).backgroundColor!=='rgba(0, 0, 0, 0)'){ok=true;break}e=e.parentElement}if(!ok)out.push('Pannello senza stile card: '+name(sm))});
      // 8. testi descrittivi non più grandi del corpo delle card
      document.querySelectorAll('#appView p').forEach(e=>{if(vis(e)&&parseFloat(getComputedStyle(e).fontSize)>15.5)out.push('Paragrafo fuori scala: '+name(e))});
      // 9. caselle di spunta di dimensione normale
      document.querySelectorAll('#appView input[type=checkbox],#appView input[type=radio]').forEach(e=>{const r=e.getBoundingClientRect();if(vis(e)&&(r.width>24||r.height>24))out.push('Casella di spunta deformata: '+name(e.closest('label')||e))});
      // 10. date visibili in formato ISO (aaaa-mm-gg)
      document.querySelectorAll('#appView td,#appView p,#appView dd,#appView small,#appView span,#appView strong').forEach(e=>{if(!vis(e))return;const own=[...e.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent).join(' ');if(/\b(19|20)\d\d-\d\d-\d\d\b/.test(own))out.push('Data in formato ISO: '+name(e))});
      return out;
    },{mobile});
    for(const f of new Set(found))PROBLEMS.push(`[${label} ${t}] ${f}`);
  }
}
(async()=>{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  try{
    for(const [role,vp,l] of [['tecnico',{width:1366,height:900},'tecnico-desktop'],['tecnico',{width:390,height:844},'tecnico-mobile'],['admin',{width:1366,height:900},'admin-desktop'],['admin',{width:390,height:844},'admin-mobile'],['admin_operativo',{width:1366,height:900},'operativo-desktop']])
      await run(role,vp,'layout-'+l,async page=>auditPage(page,l,vp.width<500));
  }finally{server.close()}
  if(PROBLEMS.length){console.error('PROBLEMI DI LAYOUT:\n'+PROBLEMS.join('\n'));process.exit(1)}
  console.log('LAYOUT COERENTE: icone SVG uniformi, testi >= 12px, pulsanti a misura standard');
})().catch(e=>{console.error('FALLITO:',e.stack);server.close();process.exit(1)});
