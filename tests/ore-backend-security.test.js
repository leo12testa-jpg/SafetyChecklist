const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const source = fs.readFileSync('supabase/functions/ore-produttivita-api/index.ts', 'utf8');

function backend({ role = 'tecnico', tokenValid = true, owner = 'other', database } = {}) {
  let handler, dbCalls = 0;
  const query = { select(){ return this; }, eq(){ return this; },
    maybeSingle: async () => ({ data: { id: 's1', tecnico_uid: owner, data_lavoro: '2026-10-03', minuti_effettivi: 60 } }) };
  const context = vm.createContext({ Request, Response, fetch: async url => {
    if (url.includes('accounts:lookup')) return new Response(JSON.stringify(tokenValid ? { users: [{localId:'u1'}] } : {}), {status: tokenValid ? 200 : 400});
    return new Response(JSON.stringify({fields:{attivo:{booleanValue:true},ruolo:{stringValue:role}}}));
  }, createClient: () => database || ({from(){ dbCalls++; return query; }}),
  Deno: {env:{get:name=> name==='SUPABASE_SECRET_KEYS' ? undefined : 'test'},serve: fn => {handler=fn;}} });
  vm.runInContext(stripTypeScriptTypes(source.replace(/^import .*;\n/, ''), {mode:'transform'}), context);
  vm.runInContext('verifyFirebaseJwt=async()=>"u1"',context); // Auth is exercised separately with real RSA signatures.
  return { call: body => handler(new Request('https://test/', {method:'POST',headers:{authorization:'Bearer test','content-type':'application/json'},body:JSON.stringify(body)})),
    dbCalls: () => dbCalls, context };
}
for (const action of ['adminSummary','adminEconomics','saveJobEconomics','archiveJobs','importPlanner','importHistoryBatch','crmResources','crmAgentHeartbeat','ingestAgendaCompany','economicsCatalog','saveTechnicianCost','archiveJobDetail','crmLinks','previewCrmLink','approveCrmLink','workSchedules','saveWorkSchedule']) {
  test(`tecnico: ${action} restituisce 403 prima di accedere ai dati`, async () => {
    const app=backend();
    assert.equal((await app.call({action,ruolo:'admin'})).status,403);
    assert.equal(app.dbCalls(),0);
  });
}
test('tecnico: modifica sessione altrui restituisce 403', async () => {
  const app=backend(); assert.equal((await app.call({action:'saveSession',id:'s1',minutiEffettivi:90})).status,403);
});
test('token rifiutato da Firebase restituisce 401 senza accesso DB',async()=>{
  const app=backend({tokenValid:false});assert.equal((await app.call({action:'me'})).status,401);assert.equal(app.dbCalls(),0);
});
test('azioni sconosciute e nomi ereditati falliscono senza accesso DB',async()=>{
  for(const action of ['missing','constructor','__proto__']){const app=backend();assert.equal((await app.call({action})).status,400);assert.equal(app.dbCalls(),0);}
});
test('ogni azione implementata è presente nella tabella centralizzata',()=>{
  const app=backend();const roles=vm.runInContext('ACTION_ROLES',app.context);
  const actions=[...source.matchAll(/action === "([^"]+)"/g)].map(m=>m[1]);
  assert.deepEqual(Object.keys(roles).sort(),actions.sort());
});
test('lettura risorsa CRM usa solo UID e non trasferisce o cancella sessioni',async()=>{
  const app=backend(); const filters=[];
  const db={from:table=>{assert.equal(table,'ore_risorse_crm');const query={select(){return this;},eq(k,v){filters.push([k,v]);return this;},then(resolve){resolve({data:[{id:'r1',tecnico_uid:'u1'}]});}};return query;}};
  app.context.testDb=db;
  const resource=await vm.runInContext('bindCallerResource(testDb,{uid:"u1",profile:{nome:"Nome uguale"}})',app.context);
  assert.equal(resource.id,'r1');assert.deepEqual(filters,[['attiva',true],['tecnico_uid','u1']]);
});
test('risorsa senza account: ingest conserva evento da verificare senza creare sessioni',async()=>{
  const writes=[];
  const database={from(table){
    assert.notEqual(table,'ore_sessioni','nessun accesso alle sessioni per risorsa senza account');
    const q={select(){return this;},eq(){return this;},neq(){return this;},limit(){return this;},update(value){writes.push({table,value});return this;},
      insert(value){writes.push({table,value});return this;},maybeSingle:async()=>({data:null}),
      then(resolve){resolve({data:table==='ore_risorse_crm'?[{id:'r1',sigla_crm:'XX',nome_crm:'Nome CRM',tecnico_uid:'legacy:XX'}]:[],error:null});}};return q;
  }};
  const app=backend({role:'admin',database});
  const response=await app.call({action:'ingestAgendaCompany',events:[{tecnicoSigla:'XX',crmEventId:'ev1',date:'2026-10-03',minutes:60,title:'1B DVR'}]});
  assert.equal(response.status,200);
  const result=await response.json();assert.equal(result.saved,0);assert.equal(result.resourceUnmatched,1);
  const issue=writes.find(w=>w.table==='ore_sync_issues');assert.equal(issue.value.tecnico_uid,'unassigned:r1');assert.equal(issue.value.stato,'aperta');assert.equal(issue.value.minuti,60);
});
test('fatturabilità include interne ed esclude assenze, anche per tecnico',()=>{
  const app=backend();app.context.rows=[{tecnico_uid:'u1',tecnico_nome:'Leo',minuti_effettivi:480,fatturabile:true,assenza:false},{tecnico_uid:'u1',tecnico_nome:'Leo',minuti_effettivi:120,fatturabile:false,assenza:false},{tecnico_uid:'u1',tecnico_nome:'Leo',minuti_effettivi:240,fatturabile:false,assenza:true}];
  const result=vm.runInContext('billability(rows)',app.context);assert.equal(result.percent,80);assert.equal(result.technicians[0].percent,80);assert.equal(result.reportedExcludingAbsence,600);assert.equal(result.absenceMinutes,240);
  assert.equal(vm.runInContext('billability([]).percent',app.context),null);
});
test('attività interne: categorie e minuti invalidi rifiutati prima del salvataggio',async()=>{
  for(const body of [{categoria:'malattia',minutiEffettivi:60},{categoria:'assenza',minutiEffettivi:1441},{categoria:'amministrazione',minutiEffettivi:-1}]){
    const app=backend();assert.equal((await app.call({action:'saveInternal',date:'2026-10-03',...body})).status,400);assert.equal(app.dbCalls(),0);
  }
});
test('tecnico non crea né modifica attività interne altrui',async()=>{
  for(const body of [{tecnicoUid:'other'},{id:'s1'}]){const app=backend();assert.equal((await app.call({action:'saveInternal',date:'2026-10-03',categoria:'assenza',minutiEffettivi:60,...body})).status,403);}
});
test('assenza: nessun motivo inviato al database, ruolo nel body ignorato',async()=>{
  let saved;
  const app=backend({database:{rpc:async(name,args)=>{saved=args;return {data:{ok:true},error:null};}}});
  const response=await app.call({action:'saveInternal',date:'2026-10-03',categoria:'assenza',minutiEffettivi:60,motivo:'dato da non registrare',ruolo:'admin'});
  assert.equal(response.status,200);assert.equal(saved.p_admin,false);assert.equal(saved.p_uid,'u1');assert.equal(saved.p_category,'assenza');assert.equal('motivo' in saved,false);
});
test('day usa vista unificata per totale e quota e filtra sempre sul chiamante',async()=>{
  const filters=[];
  const activities=[{id:'s1',tipo_record:'sessione',tecnico_uid:'u1',minuti_effettivi:480,fatturabile:true,assenza:false},{id:'i1',tipo_record:'interna',tecnico_uid:'u1',minuti_effettivi:120,fatturabile:false,assenza:false},{id:'a1',tipo_record:'interna',tecnico_uid:'u1',minuti_effettivi:240,fatturabile:false,assenza:true}];
  const database={from(table){const q={select(){return this;},eq(k,v){filters.push([table,k,v]);return this;},lte(){return this;},limit(){return this;},order(){return this;},maybeSingle:async()=>({data:null}),then(resolve){resolve({data:table==='ore_rendicontazioni'?activities:table==='ore_sessioni'?[activities[0]]:[],error:null});}};return q;}};
  const app=backend({database});const response=await app.call({action:'day',date:'2026-10-03',tecnicoUid:'other'});assert.equal(response.status,200);const data=await response.json();
  assert.equal(data.totalMinutes,840);assert.equal(data.sessions.length,1);assert.equal(data.internalActivities.length,2);assert.equal(data.billability.percent,80);
  assert.ok(filters.some(f=>f[0]==='ore_rendicontazioni'&&f[1]==='tecnico_uid'&&f[2]==='u1'));
});
test('orario default, part-time e decorrenze rispettano lo storico',()=>{
  const app=backend();app.context.schedules=[{valido_dal:'2026-01-01',settimana_minuti:[240,240,240,240,240,0,0]},{valido_dal:'2026-09-01',settimana_minuti:[360,360,360,360,360,0,0]}];
  for(const [day,expected] of [['2025-12-29',480],['2026-08-31',240],['2026-09-01',360],['2026-10-03',0]]){
    assert.equal(vm.runInContext(`expectedWork('${day}',schedules).minutes`,app.context),expected);
  }
});
test('festività italiane: Pasqua, lunedì Angelo e 4 ottobre solo dal 2026',()=>{
  const app=backend();for(const day of ['2026-01-01','2026-04-05','2026-04-06','2026-04-25','2026-10-04','2027-10-04','2026-12-25'])assert.equal(vm.runInContext(`expectedWork('${day}',[]).minutes`,app.context),0);
  assert.equal(vm.runInContext("italianHoliday('2025-10-04')",app.context),null);
  assert.equal(vm.runInContext("easterDate(2026)",app.context),'2026-04-05');
  for(const day of ['2026-03-30','2026-10-26'])assert.equal(vm.runInContext(`expectedWork('${day}',[]).minutes`,app.context),480);
});
test('date impossibili rifiutate, anno bisestile accettato',()=>{
  const app=backend();assert.throws(()=>vm.runInContext("dateOnly('2026-02-29')",app.context));assert.throws(()=>vm.runInContext("dateOnly('2026-04-31')",app.context));assert.equal(vm.runInContext("dateOnly('2024-02-29')",app.context),'2024-02-29');
});

test('fase: enum e proprietà della sessione controllati sul server',async()=>{
  const invalid=backend();assert.equal((await invalid.call({action:'savePhase',id:'s1',fase:'inventata'})).status,400);assert.equal(invalid.dbCalls(),0);
  const foreign=backend();assert.equal((await foreign.call({action:'savePhase',id:'s1',fase:'redazione',updatedAt:'2026-10-03T10:00:00Z',ruolo:'admin'})).status,403);
});
test('fase: versione obbligatoria e conferma umana trasmessa al database',async()=>{
  assert.equal((await backend({owner:'u1'}).call({action:'savePhase',id:'s1',fase:'redazione'})).status,400);
  let saved;const q={select(){return this;},eq(){return this;},maybeSingle:async()=>({data:{tecnico_uid:'u1',confermata:false}})};
  const app=backend({database:{from:()=>q,rpc:async(name,args)=>{assert.equal(name,'ore_salva_fase');saved=args;return {data:{ok:true,updatedAt:'2026-10-03T11:00:00Z'}};}}});
  const response=await app.call({action:'savePhase',id:'s1',fase:'trasferta',updatedAt:'2026-10-03T10:00:00Z',ruolo:'admin'});assert.equal(response.status,200);assert.equal(saved.p_phase,'trasferta');assert.equal(saved.p_admin,false);assert.equal(saved.p_actor,'u1');
});
test('riepilogo admin legge oltre 1000 sessioni senza troncare le fasi',async()=>{
  const ranges=[];const database={from(table){const q={select(){return this;},gte(){return this;},lte(){return this;},order(){return this;},range(start,end){ranges.push([table,start,end]);this.start=start;return this;},then(resolve){resolve({data:table==='ore_sessioni'?Array.from({length:this.start===0?1000:1},()=>({commessa_id:'j1',fase:'trasferta',minuti_effettivi:1})):[],error:null});}};return q;}};
  const response=await backend({role:'admin',database}).call({action:'adminSummary',from:'2026-10-01',to:'2026-10-03'});
  assert.equal(response.status,200);assert.equal((await response.json()).rows.length,1001);assert.ok(ranges.some(r=>r[0]==='ore_sessioni'&&r[1]===1000));
});
