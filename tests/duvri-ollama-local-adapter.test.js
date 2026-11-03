'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createLocalOllamaAdapter}=require('../server/duvri-ollama-local-adapter.cjs');

const JOB='JOB_SYNTH_OLLAMA_001',AN='ANALYSIS_SYNTH_OLLAMA_001';
const EX='EXTRACTION_SYNTH_OLLAMA_001',RUN='RUN_SYNTH_OLLAMA_001';
const MODEL='test-local-hse:latest';
const ref=()=>({
 jobId:JOB,agentId:'documentale',analysisRevisionId:AN,
 extractionRevisionId:EX,runRevisionId:RUN
});
const policy=()=>({
 backend_verified:true,local_execution_authorized:true,
 data_classification:'synthetic',synthetic_only:true,
 revision_current:true,local_only:true,
 job_id:JOB,agent_id:'documentale',
 analysis_revision_id:AN,extraction_revision_id:EX,
 run_revision_id:RUN,model_id:MODEL,
 allowed_file_ids:['DOCX_SYNTH_001'],
 source_facts:{
  synthetic_only:true,job_id:JOB,agent_id:'documentale',
  analysis_revision_id:AN,extraction_revision_id:EX,
  task:{summary:'Esempio sintetico; nessun cliente',file_id:'DOCX_SYNTH_001'}
 }
});
const runtime=()=>({
 backend_checked:true,ollama_no_cloud_effective:true,
 ollama_loopback_only:true,no_external_provider_configured:true
});
const answer=()=>({
 schema_version:'colligo-duvri-agent-analysis/1.0',
 job_id:JOB,agent_id:'documentale',status:'needs_clarification',
 findings:[],missing_information:[{
  question:'Orario di lavoro non confermato?',
  why_needed:'Verificare compresenze della prova sintetica',
  blocking:true
 }],conflicts:[],requires_human_review:true
});
const modelResponse=value=>({
 ok:true,text:async()=>JSON.stringify({
  done:true,model:MODEL,
  message:{role:'assistant',content:JSON.stringify(value)},
  prompt_eval_count:30,eval_count:15
 })
});
function harness(overrides={}){
 const events={fetch:[],audit:[],policy:0,localRuntime:0};
 const deps={
  enabled:true,
  loadSyntheticCase:async()=>{events.policy++;return policy();},
  verifyLocalRuntime:async()=>{events.localRuntime++;return runtime();},
  recordAudit:async e=>{events.audit.push(e);},
  fetchImpl:async(url,opts)=>{
   events.fetch.push({url,opts});
   return url.endsWith('/api/tags')?
    {ok:true,text:async()=>JSON.stringify({models:[{name:MODEL,size:1000}]})}:
    modelResponse(answer());
  },...overrides
 };
 return {adapter:createLocalOllamaAdapter(deps),events};
}
const safe=x=>{
 assert.equal(x.issuance_allowed,false);
 assert.equal(x.hse_approved,false);
 assert.equal(x.external_data_transfer_allowed,false);
 assert.equal(x.provider_dispatch_allowed,false);
};
test('adapter default OFF: zero calls, zero cost and no local model execution',async()=>{
 const x=await createLocalOllamaAdapter().invoke(ref());safe(x);
 assert.equal(x.blocker_code,'LOCAL_ADAPTER_DISABLED');
 assert.equal(x.local_request_attempted,false);
});
test('enabled without server callbacks fails without network',async()=>{
 const x=await createLocalOllamaAdapter({enabled:true}).invoke(ref());safe(x);
 assert.equal(x.blocker_code,'PRIVATE_CALLBACKS_MISSING');
});
test('valid synthetic run makes exactly two loopback requests, no cloud',async()=>{
 const {adapter,events}=harness();const x=await adapter.invoke(ref());safe(x);
 assert.equal(x.state,'candidate_for_private_fact_verification');
 assert.equal(x.agent_result.agent_id,'documentale');
 assert.equal(x.needs_human_review,true);
 assert.deepEqual(events.fetch.map(v=>v.url),[
  'http://127.0.0.1:11434/api/tags','http://127.0.0.1:11434/api/chat'
 ]);
 assert.equal(events.fetch[0].opts.redirect,'error');
 assert.equal(events.fetch[1].opts.redirect,'error');
 assert.deepEqual(events.audit.map(v=>v.event),['local_run_started','local_run_finished']);
 const request=JSON.parse(events.fetch[1].opts.body);
 assert.equal(request.model,MODEL);assert.equal(request.format,'json');
 assert.equal(request.stream,false);
 assert.equal(request.messages[0].role,'system');
 assert.equal(request.messages[1].role,'user');
 assert.equal(JSON.stringify(x).includes('DOCX_SYNTH_001'),false);
});
test('runtime fails closed if Ollama cloud features not verifiably disabled',async()=>{
 for(const name of ['backend_checked','ollama_no_cloud_effective',
  'ollama_loopback_only','no_external_provider_configured']){
  const s=runtime();s[name]=false;
  const {adapter,events}=harness({verifyLocalRuntime:async()=>s});
  const x=await adapter.invoke(ref());safe(x);
  assert.equal(x.blocker_code,'LOCAL_ONLY_RUNTIME_NOT_VERIFIED',name);
  assert.equal(events.fetch.length,0);
 }
});
test('cloud-tagged model forbidden even if available locally',async()=>{
 for(const model of ['llama:cloud','qwen-cloud:latest','CloudModel','foo/cloud']){
  const p=policy();p.model_id=model;
  const {adapter,events}=harness({loadSyntheticCase:async()=>p});
  const x=await adapter.invoke(ref());safe(x);
  assert.equal(x.blocker_code,'CLOUD_OR_INVALID_MODEL_REJECTED');
  assert.equal(events.fetch.length,0);
 }
});
test('uninstalled model returns block; NEVER calls pull, create or chat',async()=>{
 const {adapter,events}=harness({fetchImpl:async(url,opts)=>{
  events.fetch.push({url,opts});
  return {ok:true,text:async()=>JSON.stringify({models:[{name:'different-local'}]})};
 }});
 const x=await adapter.invoke(ref());safe(x);
 assert.equal(x.blocker_code,'LOCAL_MODEL_NOT_INSTALLED');
 assert.deepEqual(events.fetch.map(x=>x.url),['http://127.0.0.1:11434/api/tags']);
});
test('private client classification or missing synthetic authorization prohibits even tags call',async()=>{
 for(const [name,val] of [
  ['data_classification','customer'],
  ['synthetic_only',false],['local_execution_authorized',false],
  ['backend_verified',false],['local_only',false],['revision_current',false]
 ]){
  const p=policy();p[name]=val;
  const {adapter,events}=harness({loadSyntheticCase:async()=>p});
  const x=await adapter.invoke(ref());safe(x);
  assert.equal(x.blocker_code,'SYNTHETIC_CASE_NOT_VERIFIED');
  assert.equal(events.fetch.length,0,name);
 }
});
test('foreign job / stale revisions blocked before any local model request',async()=>{
 for(const [name,val] of [
  ['job_id','JOB_OTHER_SYNTH_002'],
  ['analysis_revision_id','ANALYSIS_OLD_SYNTH_002'],
  ['extraction_revision_id','EXTRACTION_OLD_SYNTH_002'],
  ['run_revision_id','RUN_OLD_SYNTH_002']
 ]){
  const p=policy();p[name]=val;
  const {adapter,events}=harness({loadSyntheticCase:async()=>p});
  const x=await adapter.invoke(ref());safe(x);
  assert.equal(x.blocker_code,'SYNTHETIC_CASE_NOT_VERIFIED');
  assert.equal(events.fetch.length,0);
 }
});
test('browser cannot inject endpoint, model, prompt, real data, token or permissions',async()=>{
 const {adapter,events}=harness();
 for(const args of [
  {model_id:'paid-provider'},
  {prompt:'REAL_PRIVATE_TEXT'}, {endpoint:'https://example.invalid'},
  {api_key:'SECRET'}, {local_execution_authorized:true},
  {document_text:'REAL_CLIENT_DATA'}
 ]){
  const x=await adapter.invoke({...ref(),...args});safe(x);
  assert.equal(x.blocker_code,'INVALID_REQUEST');
 }
 assert.equal(events.fetch.length,0);
 assert.equal(events.policy,0);
});
test('unknown specialist and malformed ID never reach runtime',async()=>{
 const {adapter,events}=harness();
 for(const arg of [{...ref(),agentId:'fake_hse'},
  {...ref(),jobId:'?bad'},null,undefined,[],{}]){
  const x=await adapter.invoke(arg);safe(x);
  assert.equal(x.state,'blocked');
 }
 assert.equal(events.fetch.length,0);
});
test('source allowlist duplicate or foreign shape blocked',async()=>{
 for(const fileIds of [
  [],['DOCX_SYNTH_001','DOCX_SYNTH_001'],['bad!']]){
  const p=policy();p.allowed_file_ids=fileIds;
  const {adapter,events}=harness({loadSyntheticCase:async()=>p});
  const x=await adapter.invoke(ref());safe(x);
  assert.equal(x.blocker_code,'SOURCE_SCOPE_INVALID');
  assert.equal(events.fetch.length,0);
 }
});
test('invalid, oversized and circular synthetic facts fail without model call',async()=>{
 for(const kind of ['oversized','cyclic','real']){
  const p=policy();
  if(kind==='oversized')p.source_facts.task.text='X'.repeat(30000);
  if(kind==='cyclic')p.source_facts.task.self=p.source_facts.task;
  if(kind==='real')p.source_facts.synthetic_only=false;
  const {adapter,events}=harness({loadSyntheticCase:async()=>p});
  const x=await adapter.invoke(ref());safe(x);
  assert.equal(x.blocker_code,'SYNTHETIC_FACTS_INVALID');
  assert.equal(events.fetch.length,0);
 }
});
test('audit start failure prevents all Ollama calls',async()=>{
 const {adapter,events}=harness({recordAudit:async()=>{throw Error('private details');}});
 const x=await adapter.invoke(ref());safe(x);
 assert.equal(x.blocker_code,'LOCAL_AUDIT_NOT_AVAILABLE');
 assert.equal(events.fetch.length,0);
});
test('Ollama API unreachable blocks and records audit ending',async()=>{
 const {adapter,events}=harness({fetchImpl:async()=>{
  throw Error('connection refused');
 }});
 const x=await adapter.invoke(ref());safe(x);
 assert.equal(x.blocker_code,'LOCAL_REQUEST_FAILED_OR_TIMED_OUT');
 assert.equal(x.local_request_attempted,true);
 assert.equal(events.audit.length,2);
});
test('Ollama invalid tags JSON fails before chat',async()=>{
 const {adapter,events}=harness({fetchImpl:async(url,opts)=>{
  events.fetch.push({url,opts});return {ok:true,text:async()=>'{not JSON}'};
 }});
 const x=await adapter.invoke(ref());safe(x);
 assert.equal(x.blocker_code,'LOCAL_MODEL_LIST_INVALID');
 assert.equal(events.fetch.length,1);
});
test('incomplete model response cannot become an HSE review candidate',async()=>{
 const {adapter}=harness({fetchImpl:async url=>url.endsWith('/api/tags')?
  {ok:true,text:async()=>JSON.stringify({models:[{name:MODEL}]})}:
  {ok:true,text:async()=>JSON.stringify({done:false,model:MODEL,
   message:{content:JSON.stringify(answer())}})}
 });
 const x=await adapter.invoke(ref());safe(x);
 assert.equal(x.blocker_code,'LOCAL_MODEL_RESPONSE_INVALID');
});
test('model result wrong specialist rejected',async()=>{
 const a=answer();a.agent_id='normativa';
 const {adapter}=harness({fetchImpl:async url=>url.endsWith('/api/tags')?
  {ok:true,text:async()=>JSON.stringify({models:[{name:MODEL}]})}:
  modelResponse(a)});
 const x=await adapter.invoke(ref());safe(x);
 assert.equal(x.blocker_code,'HSE_OUTPUT_REJECTED');
});
test('model result schema invalid or missing human review rejected',async()=>{
 for(const patch of [{requires_human_review:false},{risk_score:9},{schema_version:'bad'}]){
  const a={...answer(),...patch};
  const {adapter}=harness({fetchImpl:async url=>url.endsWith('/api/tags')?
   {ok:true,text:async()=>JSON.stringify({models:[{name:MODEL}]})}:
   modelResponse(a)});
  const x=await adapter.invoke(ref());safe(x);
  assert.equal(x.blocker_code,'HSE_OUTPUT_REJECTED');
 }
});
test('audit completion failure discards generated answer',async()=>{
 const {adapter}=harness({recordAudit:async x=>{
  if(x.event==='local_run_finished')throw Error('private audit not saved');
 }});
 const x=await adapter.invoke(ref());safe(x);
 assert.equal(x.blocker_code,'LOCAL_AUDIT_COMPLETION_FAILED');
 assert.equal('agent_result' in x,false);
});
test('valid answer is still not an HSE approval, risk score, Word generation or emission',async()=>{
 const {adapter}=harness();
 const x=await adapter.invoke(ref());safe(x);
 assert.equal(x.state,'candidate_for_private_fact_verification');
 assert.equal('risk_score' in x,false);
 assert.equal('document_draft_allowed' in x,false);
 assert.equal('d1_approved' in x,false);
});
test('no local attempt if runtime verification itself throws',async()=>{
 const {adapter,events}=harness({verifyLocalRuntime:async()=>{
  throw Error('PRIVATE_RUNTIME_FAILURE');
 }});
 const x=await adapter.invoke(ref());safe(x);
 assert.equal(x.blocker_code,'LOCAL_ONLY_RUNTIME_NOT_VERIFIED');
 assert.equal(events.fetch.length,0);
});
