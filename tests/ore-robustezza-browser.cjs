// Test end-to-end dell'app Ore con backend e Firebase simulati (nessun dato reale).
// Uso: NODE_PATH=$(npm root -g) node tests/ore-robustezza-browser.cjs
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const ROOT=process.cwd(),OUT=path.join(ROOT,'reports','ore-ui');fs.mkdirSync(OUT,{recursive:true});
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png'};
const server=http.createServer((q,r)=>{let p=path.join(ROOT,decodeURIComponent(q.url.split('?')[0]));if(p.endsWith(path.sep))p+='index.html';fs.readFile(p,(e,d)=>{if(e){r.writeHead(404);r.end();return}r.writeHead(200,{'content-type':types[path.extname(p)]||'application/octet-stream'});r.end(d)})});

const FIREBASE_STUB=role=>`(function(){const user={uid:"u1",getIdToken:async()=>"tok"};
const auth=()=>({setPersistence:()=>Promise.resolve(),onAuthStateChanged:cb=>setTimeout(()=>cb(user),0),currentUser:user,signOut:async()=>{},signInWithEmailAndPassword:async()=>{}});
auth.Auth={Persistence:{LOCAL:"local"}};
window.firebase={initializeApp(){},auth,firestore:()=>({collection:()=>({doc:()=>({get:async()=>({exists:true,data:()=>({attivo:true,ruolo:"${role}",nome:"Leo",cognome:"Test",username:"leo.test"})})})})})};})();`;
const EVIL='<img src=x onerror="window.__xss=1">';
const iso=h=>`2026-10-03T${String(h).padStart(2,'0')}:00:00Z`;
const job=(id,desc)=>({descrizione:desc,codice_commessa_crm:'CM00'+id,cliente_id:'k1',ore_clienti:{codice_breve:'1',ragione_sociale:'ACME & Figli '+EVIL},ore_tipologie:{codice:'B',nome:'DVR'}});

async function run(role,viewport,label,extra){
  const browser=await chromium.launch();
  const ctx=await browser.newContext({viewport,serviceWorkers:'block'});
  const page=await ctx.newPage();
  const errors=[],calls=[];
  page.on('pageerror',e=>errors.push('pageerror: '+e.message));
  page.on('console',m=>{if(m.type()==='error'&&!/Failed to load resource|produttivit|recent activities/.test(m.text()))errors.push('console: '+m.text())});
  await page.route('**/js/vendor/firebase-app-compat.js',r=>r.fulfill({contentType:'text/javascript',body:FIREBASE_STUB(role==="admin_operativo"?"admin":role)}));
  await page.route(/firebase-(firestore|auth)-compat\.js/,r=>r.fulfill({contentType:'text/javascript',body:''}));
  await page.route('**/functions/v1/manage-users',r=>{const body=JSON.parse(r.request().postData());calls.push(body);return r.fulfill({contentType:'application/json',body:JSON.stringify({user:{uid:'new-test-user'}})});});
  await page.route('**/functions/v1/ore-produttivita-api',async r=>{
    const b=JSON.parse(r.request().postData()||'{}');calls.push(b);
    const ok=o=>r.fulfill({contentType:'application/json',body:JSON.stringify(o)});
    switch(b.action){
      case 'me':return ok({profile:{attivo:true,ruolo:role==='admin_operativo'?'admin':role,ore_ruolo:role==='admin'?'direzione':role}});
      case 'oreRoles':return ok({rows:[{uid:'u1',nome:'Leo '+EVIL,username:'leo.test',ore_ruolo:'direzione'}]});
      case 'setOreRole':return ok({ruolo:b.oreRuolo});
      case 'day':{
        if(b.date==='2026-10-01'){await new Promise(x=>setTimeout(x,1500));return ok({totalMinutes:60,sessions:[{id:'old',origine:'manuale',minuti_effettivi:60,commessa_id:'c9',ore_commesse:job(9,'RISPOSTA VECCHIA')}]})}
        return ok({totalMinutes:360,expectedMinutes:240,workSchedule:{source:'configurato',validFrom:'2026-09-01'},internalActivities:[{id:'int1',categoria:'amministrazione',minuti_effettivi:30},{id:'abs1',categoria:'assenza',minuti_effettivi:60}],dayStatus:{stato:'aperta'},sessions:[
          {id:'s1',origine:'crm_agenda',inizio:iso(7),fine:iso(9),minuti_agenda:120,minuti_effettivi:150,commessa_id:'c1',crm_oggetto:'Sopralluogo '+EVIL,ore_commesse:job(1,'DVR sede '+EVIL)},
          {id:'s2',origine:'manuale',minuti_effettivi:120,commessa_id:'c2',ore_commesse:job(2,'DUVRI appalto pulizie')}]});}
      case 'syncStatus':return ok({resource:{sigla:'LT',ultima_sync:new Date().toISOString()},openIssues:[{id:'i1',codice_lavoro:'1B',titolo:'Riunione '+EVIL,minuti:30,inizio:iso(10),fine:iso(10),candidati:[]}]});
      case 'catalog':return ok({clienti:[{id:'k1',codice_breve:'1',ragione_sociale:'ACME & Figli '+EVIL}],tipologie:[{id:'t1',codice:'B',nome:'DVR'}]});
      case 'commesse':return ok({commesse:[{id:'c1',cliente_id:'k1',tipologia_id:'t1',descrizione:'DVR sede '+EVIL,codice_lavoro:'1B'}]});
      case 'recentPersonal':return r.fulfill({status:500,body:'boom'});
      case 'saveSession':return ok({ok:true});
      case 'savePhase':return ok({ok:true,updatedAt:'2026-10-03T11:00:00Z'});
      case 'saveInternal':return ok({ok:true,id:'int2'});
      case 'requestUnlock':return ok({id:'unlock1'});
      case 'unlockRequests':return ok({rows:[{id:'unlock1',tecnico_uid:'u1',data:'2026-10-02',motivo:'Verifica '+EVIL,stato:'aperta'}]});
      case 'decideUnlock':return ok({ok:true});
      case 'workSchedules':return ok({technicians:[{uid:'u1',nome:'Leo'}],schedules:[{tecnico_uid:'u1',tecnico_nome:'Leo',valido_dal:'2026-01-01',settimana_minuti:[240,240,240,240,240,0,0]}]});
      case 'saveWorkSchedule':return ok({ok:true,id:'schedule2'});
      case 'companyPeriods':return ok({rows:[{id:'period1',nome:'Estate sintetica',data_inizio:'2090-05-15',data_fine:'2090-08-31',settimana_minuti:[540,540,540,540,240,0,0],updated_at:'2026-10-05T10:00:00Z'}]});
      case 'saveCompanyPeriod':return ok({id:'period2'});
      case 'monthStatus':return ok({rows:[{mese:'2099-02-01',chiuso:false,updated_at:'2026-10-05T12:00:00Z'}],history:[{entita_id:'2099-02-01',azione:'riapri_mese',created_at:'2026-10-05T12:00:00Z',tecnico_uid:'u1',dettagli:{motivo:EVIL}}]});
      case 'changeMonth':return ok({chiuso:b.operation==='close'});
      case 'missingDays':return ok({from:'2026-09-04',to:'2026-10-03',people:1,rows:[{tecnico_uid:'u1',tecnico_nome:'Leo '+EVIL,date:'2026-10-02',expectedMinutes:240,expectedSource:'configurato',reportedMinutes:120,absenceMinutes:60,confirmed:false,underHours:true}]});
      case 'confirmDay':return r.fulfill({status:409,contentType:'application/json',body:JSON.stringify({error:'Giornata già chiusa dal responsabile.'})});
      case 'adminSummary':return ok({totalMinutes:960,technicians:1,jobs:2,billability:{percent:80,technicians:[{tecnico_uid:'u1',tecnico_nome:'Leo '+EVIL,billableMinutes:480,reportedExcludingAbsence:600,percent:80}]},rows:[{data_lavoro:'2026-10-02',tecnico_nome:'Leo '+EVIL,commessa_id:'c1',minuti_effettivi:600,origine:'manuale',ore_commesse:{...job(1,'DVR sede'),stato:'completata'}}]});
      case 'crmResources':return ok({resources:[],agent:{heartbeat_at:new Date().toISOString(),state:'ok'}});
      case 'crmLinks':return ok({rows:[{id:'r1',sigla_crm:'XX',nome_crm:'Risorsa '+EVIL,tecnico_uid:'u1',tecnico_nome:'Leo',account_reale:true,stato_collegamento:'da confermare',sessioni_risorsa:1,sessioni_uid_storiche:2}],technicians:[{uid:'u1',nome:'Leo'},{uid:'u2',nome:'Nuovo tecnico'}],ambigui:{},pending:[]});
      case 'previewCrmLink':return ok({resource:{tecnico_uid:'u1',collegamento_approvato_at:null},sessions:[{id:'move1',tecnico_uid:'u1',data_lavoro:'2026-10-02',minuti_effettivi:60,updated_at:'2026-10-03T10:00:00Z'}],nota:'Le sessioni confermate non vengono spostate.'});
      case 'approveCrmLink':return ok({ok:true,riassegnate:b.sessions.length});
      case 'previewIdentity':return ok({resource:{tecnico_uid:'legacy:XX',collegamento_approvato_at:null},legacyUid:'legacy:XX',alias:null,sessions:12,minutes:1200});
      case 'approveIdentity':return ok({ok:true,sessioniRiscritte:0});
      case 'changeJobState':return ok({ok:true});
      case 'saveJobComplexity':return ok({ok:true,updatedAt:'2026-10-04T11:00:00Z'});
      case 'archiveJobDetail':return ok({job:{id:b.commessaId,stato:calls.some(c=>c.action==='changeJobState'&&c.operation==='close')?'completata':'in_lavorazione',updated_at:'2026-10-04T10:00:00Z',ore_clienti:{ragione_sociale:'Cliente'},ore_tipologie:{nome:'DVR'}},totals:{},sessions:[],technicians:[],closureHistory:[]});
      case 'economicsCatalog':return ok({technicians:[],rates:[],jobs:[]});
      case 'adminEconomics':return ok({jobs:[],costRows:[],typeStats:b.complexity?.fascia_lavoratori==='250+'?[]:[{codice:'B',nome:'DVR',n:b.complexity?.fascia_lavoratori==='10-49'?1:2,mediana_ore:b.complexity?.fascia_lavoratori==='10-49'?40:30}],blendedHourlyCost:60,coverage:{percent:0},comparable:{jobs:0}});
      case 'archiveJobs':return ok({totals:{commesse:3},rows:[
        {id:'c1',stato:'completata',ore:40,fascia_lavoratori:'10-49',numero_sedi:2,tipologia:{codice:'B',nome:'DVR'},cliente:{id:'k1',ragione_sociale:'ACME'}},
        {id:'c2',stato:'completata',ore:20,fascia_lavoratori:'1-9',numero_sedi:1,tipologia:{codice:'B',nome:'DVR'},cliente:{id:'k1',ragione_sociale:'ACME'}},
        {id:'c3',stato:'in_lavorazione',ore:99,tipologia:{codice:'B',nome:'DVR'},cliente:{id:'k1',ragione_sociale:'ACME'}}]});
      default:return ok({});
    }
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/ore-produttivita/`);
  await page.waitForSelector('#sessions .proto-hour-row',{timeout:10000});
  await page.waitForTimeout(600);
  await extra(page,calls);
  if(role==='admin'||role==='admin_operativo')for(const [tab,panel] of [['#tabDay','#dayPanel'],['#tabAdmin','#adminPanel'],['#tabArchive','#archivePanel'],...(role==='admin'?[['#tabEconomics','#economicsPanel']]:[])]){
    await page.click(tab);await page.waitForTimeout(450);assert.equal(await page.locator(panel).isVisible(),true);
    const size=await page.evaluate(()=>({vw:innerWidth,doc:document.documentElement.scrollWidth}));
    assert.ok(size.doc<=size.vw+2,`${label} ${panel}: overflow ${JSON.stringify(size)}`);
  }
  assert.equal(await page.evaluate(()=>window.__xss),undefined,'XSS eseguito!');
  assert.equal(await page.locator('#appView img[src="x"]').count(),0,'tag img iniettato nel DOM');
  const m=await page.evaluate(()=>({vw:innerWidth,doc:document.documentElement.scrollWidth}));
  assert.ok(m.doc<=m.vw+2,`${label}: overflow orizzontale ${JSON.stringify(m)}`);
  await page.screenshot({path:path.join(OUT,`robustezza-${label}.png`),fullPage:true});
  assert.deepEqual(errors,[],`${label}: errori JS`);
  await browser.close();
  console.log('ok -',label);
}

(async()=>{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  try{
    await run('tecnico',{width:1366,height:900},'tecnico-desktop',async(page,calls)=>{
      // le schede riservate all'amministratore non devono comparire al tecnico
      for(const id of ['#tabAdmin','#tabArchive','#tabEconomics'])assert.equal(await page.locator(id).isVisible(),false,id+' visibile al tecnico');
      assert.ok((await page.locator('#dayTotal').innerText()).endsWith('/ 4h 00m'),'ore previste personalizzate');
      await page.evaluate(()=>renderMonthLock({monthClosed:true}));assert.equal(await page.locator('#confirmDay').isDisabled(),true);await page.evaluate(()=>renderMonthLock({monthClosed:false}));assert.equal(await page.locator('#confirmDay').isDisabled(),false);
      // testo del CRM mostrato come testo
      assert.ok((await page.locator('#sessions').innerText()).includes('<img src=x'),'il testo pericoloso deve apparire come testo');
      // 1h30 -> 90 minuti, Invio salva
      const inp=page.locator('#sessions .proto-hours input').first();
      await inp.fill('1h30');
      assert.ok(await page.locator('#sessions .proto-hour-row.dirty').count()===1,'riga modificata evidenziata');
      // tornare sulla scheda NON deve cancellare la modifica
      const before=calls.filter(c=>c.action==='day').length;
      await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
      await page.waitForTimeout(900);
      assert.equal(calls.filter(c=>c.action==='day').length,before,'ricarica fatta nonostante modifiche aperte');
      assert.equal(await inp.inputValue(),'1h30');
      await inp.press('Enter');
      await page.waitForTimeout(500);
      const save=calls.find(c=>c.action==='saveSession');
      assert.equal(save?.minutiEffettivi,90,'salvati 90 minuti');
      // formato errato: niente chiamata al server
      const n=calls.filter(c=>c.action==='saveSession').length;
      await page.locator('#sessions .proto-hours input').first().fill('2h75');
      await page.locator('#sessions .save').first().click();
      await page.waitForTimeout(300);
      assert.equal(calls.filter(c=>c.action==='saveSession').length,n);
      assert.ok(await page.locator('.toast-warn').count()>=1,'avviso formato');
      await page.locator('#sessions .proto-hours input').first().press('Escape');
      // conferma: chiede conferma per attività non abbinate, poi mostra errore leggibile del server
      page.once('dialog',d=>d.accept());
      await page.click('#confirmDay');
      await page.waitForTimeout(500);
      assert.ok((await page.locator('.toast-error').innerText()).includes('Giornata già chiusa'),'errore server leggibile');
      // cambio data veloce: la risposta lenta e vecchia non deve sovrascrivere
      await page.fill('#dayDate','2026-10-01');await page.dispatchEvent('#dayDate','change');
      await page.fill('#dayDate','2026-10-03');await page.dispatchEvent('#dayDate','change');
      await page.waitForTimeout(2000);
      assert.equal((await page.locator('#sessions').innerText()).includes('RISPOSTA VECCHIA'),false,'risposta vecchia mostrata');
      // anteprima durata nell'inserimento manuale
      await page.click('#manualToggle');await page.fill('#manualDuration','2:30');
      assert.equal(await page.locator('#manualCard .duration-preview').innerText(),'= 2h 30m');
      await page.fill('#manualDuration','');await page.click('#manualClose');
      assert.equal(await page.locator('#internalActivities .internal-entry').count(),2);
      await page.selectOption('#internalCategory','assenza');await page.fill('#internalDuration','2:30');
      assert.equal(await page.locator('#internalDurationPreview').innerText(),'= 2h 30m');
      await page.click('#saveInternal');await page.waitForTimeout(300);
      const internal=calls.find(c=>c.action==='saveInternal');assert.equal(internal.categoria,'assenza');assert.equal(internal.minutiEffettivi,150);assert.equal('motivo' in internal,false);
      assert.equal(await page.locator('#internalDuration').inputValue(),'');
      const phase=page.locator('#sessions .phase-select').first();
      assert.equal(await phase.inputValue(),'','nessuna deduzione dalla parola sopralluogo');
      await phase.selectOption('trasferta');assert.equal(calls.filter(c=>c.action==='savePhase').length,0,'fase non salvata senza conferma');
      await page.locator('#sessions .proto-hours input').first().fill('1h45');
      await page.locator('#sessions .save-phase').first().click();await page.waitForTimeout(250);
      assert.equal(calls.find(c=>c.action==='savePhase').fase,'trasferta');
      assert.equal(await page.locator('#sessions .proto-hours input').first().inputValue(),'1h45','salvare fase preserva ore aperte');
      assert.equal(await phase.inputValue(),'trasferta');
      await page.locator('#sessions .proto-hours input').first().press('Escape');
      await page.click('#missingPersonal [data-missing-date="2026-10-02"]');await page.waitForTimeout(250);
      await page.evaluate(()=>renderDayUnlock({date:'2026-10-02',dayStatus:{stato:'confermata'},sessions:[{confermata:true},{confermata:true}],internalActivities:[]}));
      assert.equal(await page.locator('#sessions .proto-hours input').first().isDisabled(),true);
      await page.fill('#dayUnlockRequest input','Correzione ore');await page.click('#dayUnlockRequest button');await page.waitForTimeout(250);assert.equal(calls.find(c=>c.action==='requestUnlock').date,'2026-10-02');
      assert.equal(await page.locator('#dayDate').inputValue(),'2026-10-02');assert.equal(calls.filter(c=>c.action==='day').at(-1).date,'2026-10-02');
    });
    await run('tecnico',{width:390,height:844},'tecnico-mobile',async(page)=>{
      for(const id of ['#tabAdmin','#tabArchive','#tabEconomics'])assert.equal(await page.locator(id).isVisible(),false,id+' visibile al tecnico (mobile)');
    });
    await run('admin',{width:1366,height:900},'admin-desktop',async(page,calls)=>{
      await page.click('#tabAdmin');await page.locator('#oreRolesPanel').evaluate(el=>el.open=true);await page.click('#loadOreRoles');await page.waitForSelector('[data-ore-role="u1"]');assert.equal(await page.locator('[data-ore-role="u1"]').inputValue(),'direzione');assert.ok((await page.locator('#oreRolesRows').innerText()).includes('<img src=x'));
      await page.click('#tabAdmin');await page.locator('#monthForm').evaluate(el=>el.closest('details').open=true);await page.fill('#monthForm [name="mese"]','2099-02');await page.click('#monthForm [value="reopen"]');assert.equal(calls.filter(c=>c.action==='changeMonth').length,0);await page.fill('#monthForm [name="motivo"]','Verifica sintetica');await page.click('#monthForm [value="close"]');await page.waitForTimeout(300);await page.click('#monthForm [value="reopen"]');await page.waitForTimeout(300);assert.deepEqual(calls.filter(c=>c.action==='changeMonth').map(c=>c.operation),['close','reopen']);assert.ok((await page.locator('#monthHistory').innerText()).includes('<img src=x'));
      for(const id of ['#tabAdmin','#tabArchive','#tabEconomics'])assert.equal(await page.locator(id).isVisible(),true,id+' non visibile all\'admin');
      await page.click('#tabAdmin');await page.waitForTimeout(800);
      assert.equal(await page.locator('#kpiBillable').innerText(),'80%');
      assert.ok((await page.locator('#billabilityRows').innerText()).includes('80%'));
      await page.locator('#loadMissingDays').evaluate(el=>el.closest('details').open=true);await page.click('#loadMissingDays');await page.waitForTimeout(250);assert.match(await page.locator('#missingAdminRows').innerText(),/Non confermata/);assert.match(await page.locator('#missingAdminRows').innerText(),/Ore sotto il previsto/);
      await page.locator('#loadUnlockRequests').evaluate(el=>el.closest('details').open=true);await page.click('#loadUnlockRequests');await page.waitForSelector('[data-unlock-reason="unlock1"]');await page.fill('[data-unlock-reason="unlock1"]','Richiesta verificata');await page.click('[data-unlock-id="unlock1"][data-approve="true"]');await page.waitForTimeout(250);assert.equal(calls.find(c=>c.action==='decideUnlock').approve,true);
      await page.locator('#loadCompanyPeriods').evaluate(el=>el.closest('details').open=true);await page.click('#loadCompanyPeriods');await page.waitForSelector('[data-period-copy="period1"]');await page.click('[data-period-copy="period1"]');assert.equal(await page.inputValue('#companyPeriodForm [name="inizio"]'),'');assert.equal(await page.inputValue('#companyPeriodForm [data-company-week="4"]'),'4h 00m');await page.fill('#companyPeriodForm [name="inizio"]','2091-05-15');await page.fill('#companyPeriodForm [name="fine"]','2091-08-31');await page.click('#companyPeriodForm [type="submit"]');await page.waitForTimeout(250);assert.equal(calls.find(c=>c.action==='saveCompanyPeriod').id,null);assert.deepEqual(calls.find(c=>c.action==='saveCompanyPeriod').settimanaMinuti,[540,540,540,540,240,0,0]);
      const prod=await page.locator('#productivityRows').innerText();
      assert.match(prod,/B · DVR/);assert.match(prod,/30 h/,'mediana sullo storico (40 e 20) = 30 h');
      assert.ok(!prod.includes('99'),'pratiche aperte escluse');
      await page.selectOption('#productivityFilters [data-complexity="fascia_lavoratori"]','10-49');await page.waitForTimeout(250);
      assert.match(await page.locator('#productivityRows').innerText(),/40 h/);assert.match(await page.locator('#productivityRows').innerText(),/campione ridotto/);
      await page.selectOption('#productivityFilters [data-complexity="fascia_lavoratori"]','');
      await page.click('#tabEconomics');await page.waitForTimeout(300);await page.selectOption('#estimateType','B');
      assert.match(await page.locator('#estimateSample').innerText(),/2 casi/);
      await page.selectOption('#estimateComplexityFilters [data-complexity="fascia_lavoratori"]','10-49');await page.waitForTimeout(400);
      assert.match(await page.locator('#estimateSample').innerText(),/1 casi.*campione ridotto/);assert.equal(await page.locator('#estimateHours').inputValue(),'40');
      await page.click('#tabAdmin');
      await page.locator('#loadCrmLinks').evaluate(el=>el.closest('details').open=true);
      await page.click('#loadCrmLinks');
      await page.waitForSelector('#crmLinksRows .crm-target');
      assert.ok((await page.locator('#crmLinksRows').innerText()).includes('da confermare'));
      await page.selectOption('#crmLinksRows .crm-target','u2');await page.click('#crmLinksRows .crm-preview');
      await page.waitForSelector('#crmLinkPreview input');
      assert.equal(await page.locator('#crmLinkPreview input').isChecked(),false,'nessuna riassegnazione automatica');
      await page.check('#crmLinkPreview input');await page.click('#crmLinkPreview .crm-approve');
      await page.waitForTimeout(300);
      const approval=calls.find(c=>c.action==='approveCrmLink');
      assert.equal(approval.tecnicoUid,'u2');assert.equal(approval.sessions.length,1);assert.equal(approval.sessions[0].id,'move1');
      await page.selectOption('#crmLinksRows .crm-target','u2');await page.click('#crmLinksRows .identity-existing');await page.waitForSelector('.identity-check');
      assert.ok((await page.locator('#crmLinkPreview').innerText()).includes('12 sessioni'));
      await page.click('.identity-confirm');assert.equal(calls.filter(c=>c.action==='approveIdentity').length,0,'alias senza conferma rifiutato');
      await page.check('.identity-check');await page.click('.identity-confirm');await page.waitForTimeout(250);
      assert.equal(calls.find(c=>c.action==='approveIdentity').tecnicoUid,'u2');
      await page.click('#crmLinksRows .identity-new');await page.waitForSelector('#identityAccountForm');
      await page.fill('#identityAccountForm [name="nome"]','Nome');await page.fill('#identityAccountForm [name="cognome"]','Test');await page.fill('#identityAccountForm [name="username"]','nome.test');await page.fill('#identityAccountForm [name="password"]','Password-di-test-123');
      await page.check('.identity-check');await page.click('.identity-confirm');await page.waitForTimeout(300);
      const created=calls.filter(c=>c.action==='create');assert.equal(created.length,1);assert.equal(created[0].ruolo,'tecnico');assert.equal(calls.filter(c=>c.action==='approveIdentity').at(-1).tecnicoUid,'new-test-user');
      await page.locator('#loadWorkSchedules').evaluate(el=>el.closest('details').open=true);await page.click('#loadWorkSchedules');
      await page.selectOption('#workScheduleTech','u1');await page.fill('#workScheduleFrom','2026-11-01');
      for(let i=0;i<5;i++)await page.fill(`#workScheduleWeek input[data-weekday="${i}"]`,'4h');
      await page.click('#saveWorkSchedule');await page.waitForTimeout(300);
      const schedule=calls.find(c=>c.action==='saveWorkSchedule');assert.equal(schedule.validoDal,'2026-11-01');assert.deepEqual(schedule.settimanaMinuti,[240,240,240,240,240,0,0]);
      await page.click('#tabArchive');await page.waitForSelector('.archive-open');await page.locator('.archive-open').first().click();await page.waitForSelector('#jobClosureForm');
      await page.fill('#jobClosureForm [name="delivery"]','2026-10-01');await page.fill('#jobClosureForm [name="revisions"]','0');await page.click('#jobClosureForm button');await page.waitForTimeout(250);
      assert.equal(calls.find(c=>c.action==='changeJobState').revisioniCliente,0);
      await page.click('#jobClosureForm button');await page.waitForTimeout(250);assert.equal(calls.filter(c=>c.action==='changeJobState').at(-1).operation,'reopen');
      await page.fill('#jobComplexityForm [data-complexity="numero_sedi"]','2');await page.click('#jobComplexityForm button');await page.waitForTimeout(250);
      assert.equal(calls.find(c=>c.action==='saveJobComplexity').complexity.numero_sedi,2);assert.equal(calls.find(c=>c.action==='saveJobComplexity').complexity.numero_mansioni,null);
      await page.click('#tabAdmin');
      await page.fill('#adminFrom','2026-10-10');await page.fill('#adminTo','2026-10-01');await page.click('#loadAdmin');
      await page.waitForTimeout(200);
      assert.ok(await page.locator('.toast-warn').count()>=1,'periodo invertito segnalato');
    });
    await run('admin',{width:390,height:844},'admin-mobile',async(page)=>{
      await page.click('#tabAdmin');await page.waitForTimeout(800);
      assert.equal(await page.locator('#kpiBillable').innerText(),'80%');
      await page.click('#tabArchive');await page.waitForSelector('.archive-open');await page.locator('.archive-open').first().click();await page.waitForSelector('#jobClosureForm');
    });
    for(const viewport of [{width:1366,height:900},{width:390,height:844}])await run('admin_operativo',viewport,`operativo-${viewport.width}`,async(page,calls)=>{assert.equal(await page.locator('#tabAdmin').isVisible(),true);assert.equal(await page.locator('#tabArchive').isVisible(),true);assert.equal(await page.locator('#tabEconomics').isVisible(),false);assert.equal(await page.locator('#oreRolesPanel').isVisible(),false);await page.evaluate(()=>loadEconomics());assert.ok(!calls.some(c=>['adminEconomics','economicsCatalog'].includes(c.action)));});
    console.log('TUTTI I TEST BROWSER SUPERATI');
  }finally{server.close()}
})().catch(e=>{console.error('FALLITO:',e.message);server.close();process.exit(1)});
