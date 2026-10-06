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
      case 'dataQuality':return ok({checkedAt:'2026-10-05T15:00:00Z',groups:[{kind:'without_phase',label:'Sessioni senza fase',count:1,offset:0,rows:[{id:'quality-session',jobId:'c1',tecnicoUid:'u1',tecnicoNome:'Leo',date:'2026-10-02',minutes:60,title:'Verifica '+EVIL}]}]});
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
      case 'unlockRequests':return ok({rows:[{id:'unlock1',tecnico_uid:'u1',tecnico_nome:'Nome tecnico '+EVIL,data:'2026-10-02',motivo:'Verifica '+EVIL,stato:'aperta'}]});
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
      case 'crmResources':return ok({resources:[{sigla_crm:'XX',nome_crm:'Risorsa '+EVIL,attiva:true,ultimo_errore_lettura:'agenda_identica_sospetta'},{sigla_crm:'VD',nome_crm:'Veronica',attiva:true,agenda_crm_attiva:false,ultimo_errore_lettura:'risorsa_non_trovata'}],agent:{heartbeat_at:new Date().toISOString(),state:'partial',failures:1,failure_details:[{sigla:'XX',reason:'agenda_identica_sospetta'}]}});
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
module.exports={run,server,EVIL,iso,job};
