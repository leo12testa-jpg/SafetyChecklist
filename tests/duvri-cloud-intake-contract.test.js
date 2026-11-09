'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../backend/duvri/index.ts'),'utf8');
function harness(enabled=false){
  let handler, calls=0;
  const vars={SUPABASE_URL:'https://test.invalid',SUPABASE_SERVICE_ROLE_KEY:'test-only',
    DUVRI_INTAKE_ENABLED:String(enabled)};
  const globals={Deno:{env:{get:k=>vars[k]},serve:fn=>{handler=fn;}},
    Request,Response,URL,Set,Date,JSON,Number,Object,Uint8Array,TextDecoder,
    AbortSignal,atob,encodeURIComponent,
    fetch:()=>{calls++;throw Error('network not expected');}};
  vm.runInNewContext(source,globals,{timeout:1000});
  return {handler,calls:()=>calls};
}
async function invoke(h,origin,authorization=''){
  const headers={origin,authorization};
  const r=await h(new Request('https://test.invalid/functions/v1/document-jobs?action=create',{
    method:'POST',headers,body:'{}'}));
  return {status:r.status,body:await r.json()};
}
test('no Firebase or Storage requests when worker feature is off',async()=>{
  const {handler,calls}=harness(false);
  const r=await invoke(handler,'https://leo12testa-jpg.github.io');
  assert.equal(r.status,503);
  assert.equal(calls(),0);
});
test('cross-origin access rejected before any identity lookup',async()=>{
  const {handler,calls}=harness(true);
  const r=await invoke(handler,'https://untrusted.example');
  assert.equal(r.status,403);
  assert.equal(calls(),0);
});
test('missing bearer cannot use server storage credentials',async()=>{
  const {handler,calls}=harness(true);
  const r=await invoke(handler,'https://leo12testa-jpg.github.io');
  assert.equal(r.status,401);
  assert.equal(calls(),0);
});
test('strictly private and non-issuing server contract',()=>{
  assert.match(source,/DUVRI_INTAKE_ENABLED/);
  assert.match(source,/accounts:lookup/);
  assert.match(source,/firestore.googleapis.com/);
  assert.match(source,/profile\?\.attivo!==true/);
  assert.match(source,/\['admin','tecnico'\]/);
  assert.match(source,/public:false/);
  assert.match(source,/x-upsert':'false/);
  assert.match(source,/crypto\.subtle\.digest\('SHA-256'/);
  assert.match(source,/word_generated:false/);
  assert.match(source,/issuance_allowed:false/);
  assert.doesNotMatch(source,/api\.openai\.com|api\.anthropic\.com|-----BEGIN PRIVATE KEY-----/);
  assert.doesNotMatch(source,/DUVRI_BASE_GENERALE_2026\.docx|MODELLO_DUVRI_segnaposto\.docx/);
});
