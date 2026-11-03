'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createPrivateGateway}=require('../server/duvri-ai-real-provider-gateway.cjs');
const job='JOB_SYNTH_LIVE_GATEWAY_001';
const ref=()=>({
 jobId:job,agentId:'documentale',
 analysisRevisionId:'ANALYSIS_SYNTH_LIVE_001',
 extractionRevisionId:'EXTRACTION_SYNTH_LIVE_001',
 runRevisionId:'RUN_SYNTH_LIVE_001'
});
const validAnswer=()=>({
 schema_version:'colligo-duvri-agent-analysis/1.0',
 job_id:job,agent_id:'documentale',
 status:'needs_clarification',findings:[],
 missing_information:[{
  question:'Orario lavori non confermato?',
  why_needed:'Serve verificare la compresenza',
  blocking:true
 }],conflicts:[],requires_human_review:true
});
const policy=()=>({
 backend_verified:true,authenticated_operator_authorized:true,
 company_approval_verified:true,privacy_and_retention_verified:true,
 region_binding_verified:true,request_revision_current:true,
 provider_id:'vercel_ai_gateway',model_id:'openai/SYNTH_MODEL_001',
 max_request_cents:25,max_output_tokens:400,
 allowed_file_ids:['DOCX_SYNTH_001'],
 source_facts:{
  job_id:job,analysis_revision_id:'ANALYSIS_SYNTH_LIVE_001',
  extraction_revision_id:'EXTRACTION_SYNTH_LIVE_001',
  agent_id:'documentale',scoped_and_minimized:true,
  task:{work:'SYNTHETIC_TEST_ONLY',source_id:'DOCX_SYNTH_001'}
 }
});
const res=answer=>({ok:true,json:async()=>({
 choices:[{message:{content:JSON.stringify(answer)}}],
 usage:{prompt_tokens:15,completion_tokens:12}
})});
function harness(overrides={}){
 const calls={fetch:[],reserve:[],settle:[],audit:[],policy:0,key:0};
 const deps={
  enabled:true,
  loadAuthorizedRun:async()=>{calls.policy++;return policy();},
  reserveBudget:async args=>{calls.reserve.push(args);
   return {reserved:true,reservation_id:'BUDGET_HOLD_SYNTH_001',max_request_cents:25};},
  settleBudget:async args=>{calls.settle.push(args);return {settled:true};},
  recordAudit:async args=>{calls.audit.push(args);},
  getServerApiKey:async()=>{calls.key++;return 'SYNTHETIC_TEST_SECRET_NOT_REAL';},
  fetchImpl:async(url,options)=>{calls.fetch.push({url,options});
   return res(validAnswer());},
  ...overrides
 };
 return {gateway:createPrivateGateway(deps),calls};
}
const noIssue=r=>{
 assert.equal(r.approved,false);
 assert.equal(r.issuance_allowed,false);
 assert.equal(r.needs_human_review,true);
};
test('disabled by default: no key, model, reserve or fetch',async()=>{
 const {gateway,calls}=harness({enabled:false});
 const x=await gateway.invoke(ref());noIssue(x);
 assert.equal(x.status,'blocked');assert.equal(x.code,'DISABLED');
 assert.equal(calls.policy,0);assert.equal(calls.fetch.length,0);
});
test('real transport can call a fake Vercel endpoint with only synthetic facts after all gates',async()=>{
 const {gateway,calls}=harness();
 const x=await gateway.invoke(ref());noIssue(x);
 assert.equal(x.status,'candidate_for_private_source_verification');
 assert.equal(x.request_sent,true);
 assert.equal(x.agent_result.agent_id,'documentale');
 assert.equal(calls.fetch.length,1);
 assert.equal(calls.fetch[0].url,'https://ai-gateway.vercel.sh/v1/chat/completions');
 const body=JSON.parse(calls.fetch[0].options.body);
 assert.equal(body.model,policy().model_id);
 assert.equal(body.messages[0].role,'system');
 assert.equal(body.messages[1].role,'user');
 assert.equal(body.stream,false);
 assert.equal(body.max_tokens,400);
 assert.equal(body.messages[1].content.includes('SYNTHETIC_TEST_ONLY'),true);
 assert.equal(calls.reserve.length,1);assert.equal(calls.settle.length,1);
 assert.deepEqual(calls.audit.map(x=>x.event),['started','completed']);
 assert.equal(JSON.stringify(x).includes('SYNTHETIC_TEST_SECRET_NOT_REAL'),false);
});
test('no data can be sent when privacy or company approvals absent',async()=>{
 for(const key of [
  'company_approval_verified','authenticated_operator_authorized',
  'privacy_and_retention_verified','region_binding_verified',
  'request_revision_current','backend_verified']){
  const p=policy();p[key]=false;
  const {gateway,calls}=harness({loadAuthorizedRun:async()=>p});
  const x=await gateway.invoke(ref());noIssue(x);
  assert.equal(x.status,'blocked',key);
  assert.equal(calls.fetch.length,0,key);assert.equal(calls.reserve.length,0,key);
 }
});
test('rejects browser-supplied arbitrary prompts, model IDs or flags on invocation',async()=>{
 const {gateway,calls}=harness();
 for(const extra of [
  {prompt:'PRIVATE_CUSTOMER_DOCUMENT'},
  {api_key:'PRIVATE_SECRET'},
  {model_id:'openai/another-model'},
  {provider_dispatch_allowed:true}
 ]){
  const x=await gateway.invoke({...ref(),...extra});noIssue(x);
  assert.equal(x.status,'blocked');assert.equal(x.code,'INVALID_REQUEST');
 }
 assert.equal(calls.fetch.length,0);
});
test('unauthorized role, wrong job and unsupported agent rejected before policy lookup',async()=>{
 const {gateway,calls}=harness();
 for(const a of [
  {...ref(),agentId:'fictional_agent'},
  {...ref(),jobId:'!'},
  {...ref(),runRevisionId:'not id'}
 ]){
  const x=await gateway.invoke(a);noIssue(x);
  assert.equal(x.status,'blocked');
 }
 assert.equal(calls.policy,0);
});
test('rejects wrong provider, malformed model and nonpositive budget',async()=>{
 for(const patch of [
  {provider_id:'DIRECT_UNAPPROVED'},
  {model_id:'unprefixed'},
  {max_request_cents:0},
  {max_output_tokens:9000}
 ]){
  const p={...policy(),...patch};
  const {gateway,calls}=harness({loadAuthorizedRun:async()=>p});
  const x=await gateway.invoke(ref());noIssue(x);
  assert.equal(x.code,'AUTHORIZATION_NOT_VERIFIED');
  assert.equal(calls.fetch.length,0);
 }
});
test('invalid or excessive private facts block before reservation',async()=>{
 const p=policy();p.source_facts.task.text='X'.repeat(24001);
 const {gateway,calls}=harness({loadAuthorizedRun:async()=>p});
 const x=await gateway.invoke(ref());noIssue(x);
 assert.equal(x.code,'PRIVATE_PAYLOAD_NOT_VERIFIED');
 assert.equal(calls.fetch.length,0);assert.equal(calls.reserve.length,0);
});
test('unserializable or cyclic facts fail closed without sending',async()=>{
 const p=policy();p.source_facts.task.self=p.source_facts.task;
 const {gateway,calls}=harness({loadAuthorizedRun:async()=>p});
 const x=await gateway.invoke(ref());noIssue(x);
 assert.equal(x.code,'PRIVATE_PAYLOAD_NOT_VERIFIED');
 assert.equal(calls.fetch.length,0);
});
test('budget reservation failure prevents any transport request',async()=>{
 const {gateway,calls}=harness({reserveBudget:async()=>({reserved:false})});
 const x=await gateway.invoke(ref());noIssue(x);
 assert.equal(x.code,'BUDGET_RESERVATION_FAILED');
 assert.equal(calls.fetch.length,0);
});
test('audit start failure prevents network and triggers reservation settlement',async()=>{
 const {gateway,calls}=harness({
  recordAudit:async()=>{throw Error('PRIVATE_MSG');}
 });
 // Handler does not rely on logging private error.
 const x=await gateway.invoke(ref());noIssue(x);
 assert.equal(x.code,'AUDIT_START_FAILED');
 assert.equal(calls.fetch.length,0);assert.equal(calls.settle.length,1);
});
test('missing credentials never makes provider request and releases budget',async()=>{
 const {gateway,calls}=harness({getServerApiKey:async()=>null});
 const x=await gateway.invoke(ref());noIssue(x);
 assert.equal(x.code,'GATEWAY_CREDENTIAL_UNAVAILABLE');
 assert.equal(calls.fetch.length,0);assert.equal(calls.settle.length,1);
});
test('HTTP provider failure is sanitized, charge settlement still occurs',async()=>{
 const {gateway,calls}=harness({fetchImpl:async()=>({ok:false,status:429})});
 const x=await gateway.invoke(ref());noIssue(x);
 assert.equal(x.code,'PROVIDER_HTTP_FAILURE');
 assert.equal(calls.settle.length,1);assert.equal(calls.audit.length,2);
});
test('provider network failure never exposes secret or raw error',async()=>{
 const {gateway,calls}=harness({fetchImpl:async()=>{throw Error('PRIVATE_API_SECRET');}});
 const x=await gateway.invoke(ref());noIssue(x);
 assert.equal(x.code,'PROVIDER_TIMEOUT_OR_NETWORK');
 assert.equal(calls.settle.length,1);
 assert.equal(JSON.stringify(x).includes('PRIVATE_API_SECRET'),false);
});
test('unparseable output rejects without producing HSE candidate',async()=>{
 const {gateway}=harness({fetchImpl:async()=>({ok:true,json:async()=>({
  choices:[{message:{content:'NOT JSON'}}]
 })})});
 const x=await gateway.invoke(ref());noIssue(x);
 assert.equal(x.code,'HSE_RESULT_INVALID');
 assert.equal('agent_result' in x,false);
});
test('agent impersonation and invented risk_score never produce candidate',async()=>{
 const cases=[
  {...validAnswer(),agent_id:'normativa'},
  {...validAnswer(),risk_score:9},
  {...validAnswer(),requires_human_review:false}
 ];
 for(const answer of cases){
  const {gateway}=harness({fetchImpl:async()=>res(answer)});
  const x=await gateway.invoke(ref());noIssue(x);
  assert.equal(x.status,'blocked');
  assert.equal('agent_result' in x,false);
 }
});
test('evidence from a foreign client file is rejected by schema allowlist',async()=>{
 const a=validAnswer();a.status='needs_clarification';a.findings=[{
  finding_id:'F_001',category:'interference',work_phase:'synthetic work',
  scenario:'synthetic scenario',interference_explanation:'synthetic interference',
  exposed_parties:['technician'],
  source_evidence:[{
   source_type:'current_job_document',file_id:'FOREIGN_CLIENT_FILE_001',
   locator:'section 1',excerpt_or_fact:'SYNTHETIC_ONLY',verification_status:'confirmed'
  }],proposed_measures:[],validation_status:'to_be_reviewed'
 }];
 const {gateway}=harness({fetchImpl:async()=>res(a)});
 const x=await gateway.invoke(ref());noIssue(x);
 assert.equal(x.code,'HSE_RESULT_INVALID');
});
test('even a valid candidate does not grant Word, D1, D2 or human approvals',async()=>{
 const {gateway}=harness();
 const x=await gateway.invoke(ref());noIssue(x);
 assert.equal(x.status,'candidate_for_private_source_verification');
 assert.equal('document_draft_allowed' in x,false);
 assert.equal('risk_score' in x,false);
});
test('settlement or audit completion failure prevents candidate delivery',async()=>{
 const {gateway:a}=harness({settleBudget:async()=>({settled:false})});
 let x=await a.invoke(ref());noIssue(x);
 assert.equal(x.code,'BUDGET_SETTLEMENT_FAILED');
 const {gateway:b}=harness({recordAudit:async e=>{
  if(e.event==='completed')throw Error('AUDIT_PRIVATE_FAILURE');
 }});
 x=await b.invoke(ref());noIssue(x);
 assert.equal(x.code,'AUDIT_COMPLETION_FAILED');
});
test('unconfigured callbacks fail closed before any network',async()=>{
 const gateway=createPrivateGateway({enabled:true});
 const x=await gateway.invoke(ref());noIssue(x);
 assert.equal(x.code,'INVALID_SERVER_DEPENDENCIES');
});
