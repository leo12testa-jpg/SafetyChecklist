'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {prepare,VERSION}=require('../js/duvri-agent-activation-preparation.js');
const {SIGNAL_TO_AGENT,AGENTS}=require('../js/duvri-agent-contract.js');
const JOB='JOB_SYNTH_ACTIVATION_001',
 AN='ANALYSIS_SYNTH_ACTIVATION_001',EX='EXTRACTION_SYNTH_ACTIVATION_001',
 APPROVAL='APPROVAL_SYNTH_ACTIVATION_001';
const signals=(on=[])=>Object.fromEntries(Object.keys(SIGNAL_TO_AGENT)
 .map(k=>[k,on.includes(k)?'yes':'no']));
const scope=()=>({
 schema_version:'colligo-duvri-hse-evidence-scope/1.0',
 job_id:JOB,analysis_revision_id:AN,extraction_revision_id:EX,
 state:'ready_for_hse_screening',checklist_ready:true,issuance_allowed:false,
 allowed_file_ids:['CHECKLIST_SYNTH_001','SOURCE_PDF_SYNTH_001'],
 withheld_file_ids:[],manual_review_file_ids:[]
});
const provider=()=>({provider_id:'PROVIDER_SYNTH_001',
 model_id:'MODEL_SYNTH_001',region:'REGION_SYNTH_001',
 config_revision_id:'CONFIG_SYNTH_001'});
const authorization=()=>({
 job_id:JOB,analysis_revision_id:AN,extraction_revision_id:EX,
 organization_approval_id:'ORG_SYNTH_001',approval_revision_id:APPROVAL,
 approver_id:'DIRECTOR_SYNTH_001',approver_role:'direzione',
 approved_provider_id:'PROVIDER_SYNTH_001',
 approved_model_id:'MODEL_SYNTH_001',approved_region:'REGION_SYNTH_001',
 authenticated:true,can_authorize_ai:true,provider_processing_approved:true,
 customer_data_processing_authorized:true,retention_policy_approved:true,
 client_scope_reviewed:true,human_hse_review_required:true
});
const budget=()=>({
 job_id:JOB,analysis_revision_id:AN,approval_revision_id:APPROVAL,
 price_schedule_revision_id:'PRICES_SYNTH_001',cost_approval_id:'COST_SYNTH_001',
 estimated_run_cents:50,max_run_cents:100,
 job_remaining_cents:400,organization_remaining_cents:1000,
 cost_approved:true,estimate_server_verified:true
});
const runtime=()=>({
 backend_mode:'private_backend',backend_config_revision_id:'BACKEND_SYNTH_001',
 provider_config_revision_id:'CONFIG_SYNTH_001',
 job_id:JOB,analysis_revision_id:AN,extraction_revision_id:EX,
 secrets_server_side:true,endpoint_allowlisted:true,
 runtime_egress_controlled:true,input_data_minimized:true,
 no_unapproved_storage:true,audit_logging_enabled:true,provider_enabled:true
});
const initial=()=>({jobId:JOB,analysisRevisionId:AN,
 extractionRevisionId:EX,sourceScope:scope(),
 screeningSignals:signals(),mode:'synthetic_preparation'});
const review=()=>({...initial(),mode:'private_provider_review',
 provider:provider(),authorization:authorization(),
 budget:budget(),runtime:runtime()});
const run=p=>prepare({...initial(),...p});
const noIssuance=x=>{
 assert.equal(x.schema_version,VERSION);
 assert.equal(x.provider_dispatch_allowed,false);
 assert.equal(x.external_data_transfer_allowed,false);
 assert.equal(x.document_draft_allowed,false);
 assert.equal(x.hse_approved,false);
 assert.equal(x.issuance_allowed,false);
 assert.equal(x.requires_d1_d2,true);
 assert.equal(x.requires_human_hse_review,true);
};
test('synthetic task preparation produces the three default HSE agents, not artificial analysis',()=>{
 const r=run();noIssuance(r);
 assert.equal(r.state,'synthetic_tasks_prepared');
 assert.equal(r.phase,'foundation');
 assert.deepEqual(r.selected_agent_ids,['documentale','normativa','coordinamento']);
 assert.deepEqual(r.next_agent_ids,['documentale','normativa']);
 assert.deepEqual(r.blocker_codes,['PRIVATE_SYNTHETIC_EXECUTOR_REQUIRED']);
 assert.equal('agent_results' in r,false);
});
test('screening yes routes exactly one specialty without activating a provider',()=>{
 const x=run({screeningSignals:signals(['chimici_atex'])});noIssuance(x);
 assert.deepEqual(x.selected_agent_ids,
 ['documentale','normativa','coordinamento','chimico_atex']);
});
test('all nine yes select exactly twelve agents',()=>{
 const x=run({screeningSignals:signals(Object.keys(SIGNAL_TO_AGENT))});
 noIssuance(x);assert.equal(x.selected_agent_ids.length,12);
 assert.deepEqual([...x.selected_agent_ids].sort(),[...AGENTS].sort());
});
test('unknown screening never becomes no',()=>{
 for(const answer of ['unknown',undefined]){
  const s=signals();if(answer===undefined)delete s.ambienti_confinati;
  else s.ambienti_confinati=answer;
  const r=run({screeningSignals:s});noIssuance(r);
  assert.equal(r.state,'blocked');assert.deepEqual(r.selected_agent_ids,[]);
 }
});
test('foreign or changed document scope cannot stage specialists',()=>{
 for(const [key,v] of [
  ['job_id','JOB_FOREIGN_SYNTH_002'],
  ['analysis_revision_id','OLD_ANALYSIS_SYNTH_002'],
  ['extraction_revision_id','OLD_EXTRACTION_SYNTH_002'],
  ['checklist_ready',false],
  ['withheld_file_ids',['WITHHELD_FILE_SYNTH_002']],
  ['manual_review_file_ids',['NEEDS_OCR_SYNTH_002']],
  ['issuance_allowed',true]
 ]){
  const x=scope();x[key]=v;
  const r=run({sourceScope:x});noIssuance(r);assert.equal(r.state,'blocked',key);
 }
});
test('synthetic mode ignores model/cost permission flags in a safe way',()=>{
 const r=run({authorization:{admin:true},budget:{free:true},provider:{api_key:'PRIVATE_SECRET_FAKE'}});
 noIssuance(r);assert.equal(r.state,'synthetic_tasks_prepared');
 assert.equal(JSON.stringify(r).includes('PRIVATE_SECRET_FAKE'),false);
});
test('private provider mode with no approvals is blocked',()=>{
 const r=run({mode:'private_provider_review'});noIssuance(r);
 assert.equal(r.state,'blocked');
 assert.ok(r.blocker_codes.includes('PROVIDER_PREFLIGHT_NOT_APPROVED'));
});
test('synthetic approval and budget metadata still never produces authorization token',()=>{
 const r=prepare(review());noIssuance(r);
 assert.equal(r.state,'ready_for_private_gateway_authorization_review');
 assert.deepEqual(r.blocker_codes,['ATOMIC_BACKEND_GATEWAY_AUTHORIZATION_REQUIRED']);
 assert.equal(r.estimated_run_cents,50);
 assert.deepEqual(r.next_agent_ids,['documentale','normativa']);
});
test('provider authorization must match selected provider model and region',()=>{
 const r=review();r.provider.region='REGION_OUTSIDE_SYNTH_002';
 const x=prepare(r);noIssuance(x);
 assert.equal(x.state,'blocked');
 assert.ok(x.blocker_codes.includes('ORGANIZATION_OR_PRIVACY_APPROVAL_MISSING'));
});
test('provider cannot be enabled by spoofing browser flag',()=>{
 const r=run({mode:'live',provider_enabled:true});noIssuance(r);
 assert.equal(r.state,'blocked');
 assert.deepEqual(r.blocker_codes,['UNEXPECTED_ACTIVATION_PARAMETER']);
});
test('unexpected mode cannot trigger network or dispatch',()=>{
 const r=run({mode:'production'});noIssuance(r);
 assert.equal(r.state,'blocked');
 assert.deepEqual(r.blocker_codes,['UNSUPPORTED_OR_UNAUTHORIZED_ACTIVATION_MODE']);
});
test('provider key or fake secret in provider configuration fails closed',()=>{
 const r=review();r.provider.api_key='SECRET_MUST_NOT_LEAK';
 const x=prepare(r);noIssuance(x);
 assert.equal(x.state,'blocked');
 assert.equal(JSON.stringify(x).includes('SECRET_MUST_NOT_LEAK'),false);
});
test('privacy, retention and company authorization remain mandatory',()=>{
 for(const key of [
  'provider_processing_approved','customer_data_processing_authorized',
  'retention_policy_approved','client_scope_reviewed','human_hse_review_required']){
  const r=review();r.authorization[key]=false;
  const x=prepare(r);noIssuance(x);
  assert.equal(x.state,'blocked',key);
 }
});
test('cost cap and available budget enforced for all agents',()=>{
 const r=review();r.budget.organization_remaining_cents=40;
 const x=prepare(r);noIssuance(x);
 assert.equal(x.state,'blocked');
 assert.ok(x.blocker_codes.includes('AI_BUDGET_NOT_VERIFIED'));
});
test('provider disabled in private gateway cannot pass readiness',()=>{
 const r=review();r.runtime.provider_enabled=false;
 const x=prepare(r);noIssuance(x);
 assert.equal(x.state,'blocked');
 assert.ok(x.blocker_codes.includes('PRIVATE_GATEWAY_NOT_VERIFIED'));
});
test('browser-side backend, endpoint and secrets configuration are insufficient',()=>{
 for(const [key,v] of [
  ['backend_mode','browser'],['endpoint_allowlisted',false],
  ['secrets_server_side',false],['runtime_egress_controlled',false],
  ['input_data_minimized',false]]){
  const r=review();r.runtime[key]=v;
  const x=prepare(r);noIssuance(x);assert.equal(x.state,'blocked',key);
 }
});
test('activation plan cannot disclose file, client, approver, model or auth data',()=>{
 const r=prepare(review());const out=JSON.stringify(r);
 for(const secret of [
  'CHECKLIST_SYNTH_001','SOURCE_PDF_SYNTH_001','ORG_SYNTH_001',
  'DIRECTOR_SYNTH_001','MODEL_SYNTH_001','BACKEND_SYNTH_001']){
  assert.equal(out.includes(secret),false,secret);
 }
});
test('output is deterministic and does not mutate source scope',()=>{
 const args=review();const before=structuredClone(args);
 const a=prepare(args),b=prepare(args);
 assert.deepEqual(a,b);assert.deepEqual(args,before);
 a.selected_agent_ids.push('fake_agent');
 assert.deepEqual(args,before);
});
test('missing or malformed input never throws',()=>{
 for(const value of [undefined,null,false,[],{},'INVALID']){
  const x=prepare(value);noIssuance(x);assert.equal(x.state,'blocked');
 }
});
test('no provider is invoked in simulated all-12 mode',()=>{
 const r=prepare({...review(),screeningSignals:signals(Object.keys(SIGNAL_TO_AGENT))});
 noIssuance(r);assert.equal(r.selected_agent_ids.length,12);
 assert.equal(r.state,'ready_for_private_gateway_authorization_review');
});
test('provider review rejects unresolved screening even with complete paper approvals',()=>{
 const r=review();r.screeningSignals.chimici_atex='unknown';
 const x=prepare(r);noIssuance(x);assert.equal(x.state,'blocked');
});
test('changed analysis revision cannot reuse old source-scope, budget or provider approval',()=>{
 const r=review();r.analysisRevisionId='NEW_ANALYSIS_SYNTH_002';
 const x=prepare(r);noIssuance(x);assert.equal(x.state,'blocked');
});
