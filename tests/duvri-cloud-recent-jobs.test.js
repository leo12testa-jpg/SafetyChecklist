'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const source=fs.readFileSync(path.join(__dirname,'../backend/duvri/index.ts'),'utf8');
const b64=v=>Buffer.from(JSON.stringify(v)).toString('base64url');
const jwt=['a',b64({aud:'safety-checklist-colligo',
  iss:'https://securetoken.google.com/safety-checklist-colligo',
  sub:'uid-a',iat:Math.floor(Date.now()/1000)-60,exp:Math.floor(Date.now()/1000)+600}),'b'].join('.');
const UUID='12345678-1234-4123-8123-123456789012';

function init(options={}){
  let handler;
  const seen=[];
  const env={DUVRI_INTAKE_ENABLED:options.enabled===false?'false':'true',
    DUVRI_MASTER_INSTALL_ALLOWED:options.bootstrap?'true':'false',
    SUPABASE_URL:'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY:'server-only-test-key',DUVRI_ALLOWED_ORIGINS:'https://leo12testa-jpg.github.io'};
  const fakeFetch=async (input,options={})=>{
    const url=String(input);seen.push({url,headers:options.headers});
    if(url.includes('/accounts:lookup?'))return Response.json({users:[{localId:'uid-a',disabled:false}]});
    if(url.includes('/documents/utenti/uid-a'))return Response.json({fields:{
      uid:{stringValue:'uid-a'},attivo:{booleanValue:true},ruolo:{stringValue:options.admin?'admin':'tecnico'}}});
    if(url.includes('/rest/v1/duvri_jobs?')){
      assert.ok(url.includes('owner_uid=eq.uid-a'),'other users cannot be enumerated');
      assert.ok(url.includes('limit=20'));
      return Response.json([{id:UUID,state:'needs_review',
        created_at:'2026-11-09T12:00:00Z',result_sha256:'0'.repeat(64)}]);
    }
    throw Error('Unexpected outbound request: '+url);
  };
  vm.runInNewContext(source,{
    Deno:{env:{get:k=>env[k]},serve:fn=>{handler=fn;}},
    Request,Response,URL,Set,Date,JSON,Number,Object,Uint8Array,TextDecoder,
    AbortSignal,atob,encodeURIComponent,TextEncoder,
    crypto:require('node:crypto').webcrypto,fetch:fakeFetch
  },{timeout:2000});
  return {handler,seen};
}
test('a verified technician sees only own recent dossiers, not Word before review',async()=>{
  const {handler,seen}=init();
  const req=new Request('https://example.supabase.co/functions/v1/document-jobs?action=list',
    {headers:{origin:'https://leo12testa-jpg.github.io',authorization:'Bearer '+jwt}});
  const r=await handler(req);const b=await r.json();
  assert.equal(r.status,200);assert.equal(b.issuance_allowed,false);
  assert.equal(b.jobs.length,1);assert.equal(b.jobs[0].id,UUID);
  assert.equal(b.jobs[0].download_ready,true);
  assert.ok(seen.some(x=>x.url.includes('owner_uid=eq.uid-a')));
  assert.ok(!JSON.stringify(b).includes('server-only-test-key'));
});
test('invalid origin prevents all remote work',async()=>{
  const {handler,seen}=init();
  const r=await handler(new Request('https://example.supabase.co/functions/v1/document-jobs?action=list',
    {headers:{origin:'https://evil.example',authorization:'Bearer '+jwt}}));
  assert.equal(r.status,403);assert.equal(seen.length,0);
});
test('cloud supported file formats agree with source intake V5',()=>{
  assert.ok(source.includes("zip:'application/zip'"));
  assert.ok(!source.includes("xls:'application/vnd.ms-excel'"));
  assert.ok(!source.includes("doc:'application/msword'"));
  assert.ok(source.includes("pdf:'application/pdf'"));
  assert.match(source,/duvri_jobs/);
});

test('only verified administrators can install the exact private master',async()=>{
  const {handler,seen}=init({bootstrap:true,admin:false});
  const url='https://example.supabase.co/functions/v1/document-jobs?action=install-master';
  const body=new Uint8Array([80,75,3,4,...Array(120).fill(88)]);
  const req=new Request(url,{method:'POST',headers:{
    origin:'https://leo12testa-jpg.github.io',authorization:'Bearer '+jwt
  },body});
  const result=await handler(req);
  assert.equal(result.status,403);
  assert.ok(!seen.some(x=>x.url.includes('/storage/v1/object/')));
});
test('admin bootstrap refuses any master with a different SHA-256',async()=>{
  const {handler,seen}=init({bootstrap:true,enabled:false,admin:true});
  const url='https://example.supabase.co/functions/v1/document-jobs?action=install-master';
  const body=new Uint8Array([80,75,3,4,...Array(120).fill(88)]);
  const req=new Request(url,{method:'POST',headers:{
    origin:'https://leo12testa-jpg.github.io',authorization:'Bearer '+jwt
  },body});
  const result=await handler(req);
  assert.equal(result.status,422);
  assert.ok(!seen.some(x=>x.url.includes('/storage/v1/object/')));
});
