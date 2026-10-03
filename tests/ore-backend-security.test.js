const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const source = fs.readFileSync('supabase/functions/ore-produttivita-api/index.ts', 'utf8');

function backend({ role = 'tecnico', tokenValid = true, owner = 'other' } = {}) {
  let handler, dbCalls = 0;
  const query = { select(){ return this; }, eq(){ return this; },
    maybeSingle: async () => ({ data: { id: 's1', tecnico_uid: owner, data_lavoro: '2026-10-03', minuti_effettivi: 60 } }) };
  const context = vm.createContext({ Request, Response, fetch: async url => {
    if (url.includes('accounts:lookup')) return new Response(JSON.stringify(tokenValid ? { users: [{localId:'u1'}] } : {}), {status: tokenValid ? 200 : 400});
    return new Response(JSON.stringify({fields:{attivo:{booleanValue:true},ruolo:{stringValue:role}}}));
  }, createClient: () => ({from(){ dbCalls++; return query; }}),
  Deno: {env:{get:name=> name==='SUPABASE_SECRET_KEYS' ? undefined : 'test'},serve: fn => {handler=fn;}} });
  vm.runInContext(stripTypeScriptTypes(source.replace(/^import .*;\n/, ''), {mode:'transform'}), context);
  return { call: body => handler(new Request('https://test/', {method:'POST',headers:{authorization:'Bearer test','content-type':'application/json'},body:JSON.stringify(body)})),
    dbCalls: () => dbCalls, context };
}
for (const action of ['adminSummary','adminEconomics','saveJobEconomics','archiveJobs','importPlanner','importHistoryBatch','crmResources','crmAgentHeartbeat','ingestAgendaCompany','economicsCatalog','saveTechnicianCost','archiveJobDetail']) {
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
