const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=(process.env.QA_BASELINE_REF?require('node:child_process').execFileSync('git',['show',process.env.QA_BASELINE_REF+':js/auth.js'],{encoding:'utf8'}):fs.readFileSync('js/auth.js','utf8')).replace(/\r/g,'');
function setup({error=null}={}){
  const start=source.indexOf('  async function ricontrollaAccount('),fn=source.slice(start,source.indexOf('\n  }\n',start)+5);
  const c=vm.createContext({profile:{uid:'qa',ruolo:'admin'},navigator:{onLine:true},location:{hash:'#settings'},
    firebase:{auth:()=>({currentUser:{uid:'qa'},signOut:async()=>{c.signedOut=true;}})},
    caricaProfilo:async()=>{if(error)throw error;return{uid:'qa',ruolo:'tecnico'};},callEndpoint:async()=>({active:true}),
    mostraApp:value=>{c.profile=value;},mostraLogin:()=>{c.loggedOut=true;},localStorage:{removeItem:()=>{c.cacheRemoved=true;}},PROFILE_CACHE:'qa',
    router:{navigate:s=>{c.location.hash='#'+s;}}
  });vm.runInContext(fn+';globalThis.recheck=ricontrollaAccount;',c);return c;
}
test('online role demotion refreshes profile and redirects protected current route',async()=>{
  const c=setup();await c.recheck();assert.equal(c.profile.ruolo,'tecnico');assert.equal(c.location.hash,'#home');
});
test('transient profile outage retains the verified session',async()=>{
  const c=setup({error:Object.assign(new Error('outage'),{status:503})});await c.recheck();assert.equal(c.signedOut,undefined);assert.equal(c.profile.ruolo,'admin');
});
test('authorization rejection removes cached profile and signs out',async()=>{
  const c=setup({error:Object.assign(new Error('disabled'),{status:403})});c.callEndpoint=async()=>{throw Object.assign(new Error('disabled'),{status:403});};await c.recheck();assert.equal(c.signedOut,true);assert.equal(c.cacheRemoved,true);
});
