'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {
 safeModels,parseTcpListeners,lastCloudLogStatus
}=require('../tools/duvri_ollama_local_diagnostic.cjs');
test('only local preinstalled model names are listed',()=>{
 const x=safeModels({models:[
  {name:'qwen3:4b'}, {name:'test:cloud'}, {name:'qwen3:4b'},
  {name:'another-local:latest'}]});
 assert.deepEqual(x.local_models,['another-local:latest','qwen3:4b']);
 assert.equal(x.rejected_cloud_model_count,1);
});
test('cloud models rejected even when lower/upper case mixed',()=>{
 const x=safeModels({models:[{name:'foo/CLOUD'},{name:'LocalCloud:latest'}]});
 assert.deepEqual(x.local_models,[]);
 assert.equal(x.rejected_cloud_model_count,2);
});
test('garbled and extra-long model names ignored instead of being printed',()=>{
 const x=safeModels({models:[{name:'model:good'},{name:'\nSECRET'},
  {name:'X'.repeat(200)}, {}, {name:123}]});
 assert.deepEqual(x.local_models,['model:good']);
});
test('invalid model list or excessive entries rejected',()=>{
 for(const input of [null,{}, {models:null},{models:'qwen'},
  {models:new Array(1001).fill({name:'qwen'})}]){
  assert.equal(safeModels(input),null);
 }
});
test('Windows IPv4 loopback listener is recognized',()=>{
 const x=parseTcpListeners('TCP    127.0.0.1:11434   0.0.0.0:0   LISTENING   1456');
 assert.equal(x.verified,true);
 assert.deepEqual(x.addresses,['127.0.0.1']);
});
test('Windows IPv6 loopback listener recognized',()=>{
 const x=parseTcpListeners(' TCP    [::1]:11434    [::]:0    LISTENING    2456');
 assert.equal(x.verified,true);
 assert.deepEqual(x.addresses,['[::1]']);
});
test('LAN and wildcard listeners fail closed even if localhost also present',()=>{
 const inputs=[
  'TCP    0.0.0.0:11434    0.0.0.0:0 LISTENING 1456',
  'TCP    192.168.1.20:11434  0.0.0.0:0 LISTENING 1456',
  'TCP    [::]:11434      [::]:0 LISTENING 1456',
  'TCP 127.0.0.1:11434 0.0.0.0:0 LISTENING 1\n'+
   'TCP 0.0.0.0:11434 0.0.0.0:0 LISTENING 2'
 ];
 for(const raw of inputs)assert.equal(parseTcpListeners(raw).verified,false);
});
test('different ports or no listeners never count as verified',()=>{
 assert.equal(parseTcpListeners('TCP 127.0.0.1:11435 0.0.0.0:0 LISTENING 1').verified,false);
 assert.equal(parseTcpListeners('TCP 127.0.0.1:11434 0.0.0.0:0 ESTABLISHED 1').verified,false);
 assert.equal(parseTcpListeners('').verified,false);
 assert.equal(parseTcpListeners(null).verified,false);
});
test('last server log cloud setting wins rather than earlier true',()=>{
 assert.equal(lastCloudLogStatus('Ollama cloud disabled: true\nOllama cloud disabled: false'),'FALSE');
 assert.equal(lastCloudLogStatus('Ollama cloud disabled: false\nOllama cloud disabled: true'),'TRUE');
});
test('no log evidence is UNKNOWN, not permission to run',()=>{
 assert.equal(lastCloudLogStatus('no relevant line'),'UNKNOWN');
 assert.equal(lastCloudLogStatus(null),'UNKNOWN');
});
test('diagnostic source contains only one loopback URL and no chat/pull requests',()=>{
 const src=fs.readFileSync(path.join(__dirname,'..','tools','duvri_ollama_local_diagnostic.cjs'),'utf8');
 assert.match(src,/http:\/\/127\.0\.0\.1:11434\/api\/tags/);
 assert.doesNotMatch(src,/http:\/\/localhost:11434\/api\/chat|https:\/\/ai-gateway|https:\/\/api\.openai/);
 assert.match(src,/method:'GET'/);
 assert.doesNotMatch(src,/method:'POST'/);
 assert.match(src,/effective_ollama_process_cloud_disabled_verified:false/);
});
