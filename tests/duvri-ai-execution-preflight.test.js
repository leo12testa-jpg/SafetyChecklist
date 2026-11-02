'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {assess}=require('../js/duvri-ai-execution-preflight.js');
const {BASE_AGENTS,SIGNAL_TO_AGENT}=require('../js/duvri-agent-contract.js');
const job='FASCICOLO_SYNTH_AI_001',analysis='ANALYSIS_SYNTH_AI_001',
 extraction='EXTRACTION_SYNTH_AI_001',approval='APPROVAL_SYNTH_AI_001';
const signals=()=>Object.fromEntries(Object.keys(SIGNAL_TO_AGENT).map(x=>[x,'no']));
const scope=()=>({
 schema_version:'colligo-duvri-hse-evidence-scope/1.0',job_id:job,
 analysis_revision_id:analysis,extraction_revision_id:extraction,
 state:'ready_for_hse_screening',checklist_ready:true,
 allowed_file_ids:['CHECKLIST_SYNTH_AI_001','PDF_SYNTH_AI_001'],
 withheld_file_ids:[],manual_review_file_ids:[],issuance_allowed:false
});
const provider=()=>({provider_id:'PROVIDER_SYNTH_001',
 model_id:'MODEL_SYNTH_001',region:'REGION_SYNTH_001',
 config_revision_id:'CONFIG_SYNTH_001'});
const auth=()=>({
 job_id:job,analysis_revision_id:analysis,extraction_revision_id:extraction,
 organization_approval_id:'ORG_SYNTH_001',approval_revision_id:approval,
 approver_id:'DIRECTOR_SYNTH_001',approver_role:'direzione',
 approved_provider_id:'PROVIDER_SYNTH_001',
 approved_model_id:'MODEL_SYNTH_001',approved_region:'REGION_SYNTH_001',
 authenticated:true,can_authorize_ai:true,
 provider_processing_approved:true,customer_data_processing_authorized:true,
 retention_policy_approved:true,client_scope_reviewed:true,
 human_hse_review_required:true
});
const budget=()=>({
 job_id:job,analysis_revision_id:analysis,approval_revision_id:approval,
 price_schedule_revision_id:'PRICES_SYNTH_001',cost_approval_id:'COST_SYNTH_001',
 estimated_run_cents:50,max_run_cents:100,job_remaining_cents:400,
 organization_remaining_cents:1000,cost_approved:true,estimate_server_verified:true
});
const runtime=()=>({
 backend_mode:'private_backend',backend_config_revision_id:'BACKEND_SYNTH_001',
 provider_config_revision_id:'CONFIG_SYNTH_001',
 job_id:job,analysis_revision_id:analysis,extraction_revision_id:extraction,
 secrets_server_side:true,endpoint_allowlisted:true,
 runtime_egress_controlled:true,input_data_minimized:true,
 no_unapproved_storage:true,audit_logging_enabled:true,provider_enabled:true
});
const inputs=()=>({
 jobId:job,analysisRevisionId:analysis,extractionRevisionId:extraction,
 sourceScope:scope(),screeningSignals:signals(),selectedAgentIds:[...BASE_AGENTS],
 provider:provider(),authorization:auth(),budget:budget(),runtime:runtime()
});
const run=(p={})=>assess({...inputs(),...p});
const fail=(r,code)=>{
 assert.equal(r.state,'blocked');
 assert.equal(r.provider_dispatch_allowed,false);
 assert.equal(r.external_data_transfer_allowed,false);
 assert.equal(r.issuance_allowed,false);
 assert.deepEqual(r.blockers,[code]);
};
test('complete synthetic paperwork only enables gateway review, never AI dispatch',()=>{
 const r=run();
 assert.equal(r.state,'preflight_passed_pending_gateway_review');
 assert.equal(r.eligible_for_private_execution_review,true);
 assert.deepEqual(r.selected_agents,BASE_AGENTS);
 assert.equal(r.estimated_cost_cents,50);
 assert.equal(r.provider_dispatch_allowed,false);
 assert.equal(r.external_data_transfer_allowed,false);
 assert.equal(r.document_draft_allowed,false);
 assert.equal(r.issuance_allowed,false);
});
test('missing input fails closed',()=>fail(assess(),'INVALID_JOB_OR_REVISION'));
test('changed job or revision of file scope invalidates AI plan',()=>{
 for(const [key,val] of [
  ['job_id','OTHER_JOB_001'],['analysis_revision_id','OLD_ANALYSIS_001'],
  ['extraction_revision_id','OLD_EXTRACT_001'],['state','awaiting_extraction'],
  ['checklist_ready',false],['issuance_allowed',true]]){
  const s=scope();s[key]=val;fail(run({sourceScope:s}),'SOURCES_INCOMPLETE_OR_STALE');
 }
});
test('unreadable and withheld sources block provider review',()=>{
 for(const [key,val] of [
  ['withheld_file_ids',['UNREAD_FILE_001']],
  ['manual_review_file_ids',['SCAN_FILE_001']],
  ['allowed_file_ids',[]],
  ['allowed_file_ids',['CHECKLIST_SYNTH_AI_001','CHECKLIST_SYNTH_AI_001']]]){
  const s=scope();s[key]=val;fail(run({sourceScope:s}),'SOURCES_INCOMPLETE_OR_STALE');
 }
});
test('unknown screening name does not let new risk bypass specialist',()=>{
 const s=signals();s.invented_risk='no';
 fail(run({screeningSignals:s}),'INVALID_SCREENING_SIGNALS');
});
test('unresolved or omitted signal cannot invoke provider',()=>{
 const s=signals();delete s.ambienti_confinati;
 fail(run({screeningSignals:s}),'SCREENING_UNRESOLVED_OR_INCOMPLETE_ROSTER');
 s.ambienti_confinati='unknown';
 fail(run({screeningSignals:s}),'SCREENING_UNRESOLVED_OR_INCOMPLETE_ROSTER');
});
test('yes requires appropriate specialist even when base agents present',()=>{
 const s=signals();s.lavori_in_quota='yes';
 fail(run({screeningSignals:s}),'SCREENING_UNRESOLVED_OR_INCOMPLETE_ROSTER');
 const r=run({screeningSignals:s,selectedAgentIds:[...BASE_AGENTS,'lavori_quota']});
 assert.equal(r.state,'preflight_passed_pending_gateway_review');
 assert.equal(r.provider_dispatch_allowed,false);
});
test('duplicate, unknown or missing base agent is refused',()=>{
 fail(run({selectedAgentIds:['documentale','normativa','normativa']}),'INVALID_SPECIALIST_SELECTION');
 fail(run({selectedAgentIds:['documentale','normativa','fake_agent']}),'INVALID_SPECIALIST_SELECTION');
 fail(run({selectedAgentIds:['documentale','normativa','antincendio']}),
  'SCREENING_UNRESOLVED_OR_INCOMPLETE_ROSTER');
});
test('provider model and region must match organization approval',()=>{
 for(const [key,val] of [
  ['provider_id','OTHER_PROVIDER_001'],['model_id','OTHER_MODEL_001'],
  ['region','OTHER_REGION_001']]){
  const p=provider();p[key]=val;fail(run({provider:p}),'ORGANIZATION_OR_PRIVACY_APPROVAL_MISSING');
 }
});
test('provider config rejects embedded API secrets and malformed revision',()=>{
 const p=provider();p.api_key='SHOULD_NOT_APPEAR';
 fail(run({provider:p}),'PROVIDER_CONFIG_UNVERIFIED');
 assert.equal(JSON.stringify(run({provider:p})).includes('SHOULD_NOT_APPEAR'),false);
 const q=provider();q.config_revision_id='?';
 fail(run({provider:q}),'PROVIDER_CONFIG_UNVERIFIED');
});
test('all privacy and processing approvals are individually required',()=>{
 for(const key of [
  'provider_processing_approved','customer_data_processing_authorized',
  'retention_policy_approved','client_scope_reviewed','human_hse_review_required']){
  const a=auth();a[key]=false;
  fail(run({authorization:a}),'ORGANIZATION_OR_PRIVACY_APPROVAL_MISSING');
 }
});
test('approver must be authenticated and authorized, not arbitrary technician',()=>{
 for(const [key,val] of [
  ['authenticated',false],['can_authorize_ai',false],
  ['approver_role','tecnico'],['approver_id',null]]){
  const a=auth();a[key]=val;
  fail(run({authorization:a}),'ORGANIZATION_OR_PRIVACY_APPROVAL_MISSING');
 }
});
test('approval of another job or revision cannot be reused',()=>{
 for(const [key,val] of [
  ['job_id','OTHER_JOB_001'],['analysis_revision_id','OLD_ANALYSIS_001'],
  ['extraction_revision_id','OLD_EXTRACT_001']]){
  const a=auth();a[key]=val;fail(run({authorization:a}),'ORGANIZATION_OR_PRIVACY_APPROVAL_MISSING');
 }
});
test('unexpected authorization keys cannot grant automatic send',()=>{
 const a=auth();a.auto_dispatch=true;
 fail(run({authorization:a}),'ORGANIZATION_OR_PRIVACY_APPROVAL_MISSING');
});
test('budget approvals, tariff revision and revision agreement required',()=>{
 for(const [key,val] of [
  ['cost_approved',false],['estimate_server_verified',false],
  ['approval_revision_id','OLD_APPROVAL_001'],['job_id','OTHER_JOB_001'],
  ['price_schedule_revision_id','bad!']]){
  const b=budget();b[key]=val;fail(run({budget:b}),'AI_BUDGET_NOT_VERIFIED');
 }
});
test('worst-case cap cannot exceed remaining company or job budget',()=>{
 for(const [key,val] of [
  ['max_run_cents',500],['organization_remaining_cents',90],
  ['job_remaining_cents',90],['max_run_cents',0],
  ['estimated_run_cents',150],['estimated_run_cents',-3],
  ['estimated_run_cents',1.5]]){
  const b=budget();b[key]=val;fail(run({budget:b}),'AI_BUDGET_NOT_VERIFIED');
 }
});
test('real gateway prerequisites are individually mandatory',()=>{
 for(const key of [
  'secrets_server_side','endpoint_allowlisted','runtime_egress_controlled',
  'input_data_minimized','no_unapproved_storage',
  'audit_logging_enabled','provider_enabled']){
  const r=runtime();r[key]=false;
  fail(run({runtime:r}),'PRIVATE_GATEWAY_NOT_VERIFIED');
 }
});
test('stale, browser or foreign backend cannot dispatch AI',()=>{
 for(const [key,val] of [
  ['backend_mode','browser'],['provider_config_revision_id','OLD_CONFIG_001'],
  ['job_id','OTHER_JOB_001'],['analysis_revision_id','OLD_ANALYSIS_001'],
  ['extraction_revision_id','OLD_EXTRACT_001']]){
  const r=runtime();r[key]=val;fail(run({runtime:r}),'PRIVATE_GATEWAY_NOT_VERIFIED');
 }
});
test('unexpected runtime input is not copied into report',()=>{
 const r=runtime();r.prompt='PRIVATE_SYNTHETIC_DATA';
 const out=run({runtime:r});fail(out,'PRIVATE_GATEWAY_NOT_VERIFIED');
 assert.equal(JSON.stringify(out).includes('PRIVATE_SYNTHETIC_DATA'),false);
});
test('result omits IDs for source files, approvals, private model and approver',()=>{
 const s=JSON.stringify(run());
 for(const secret of [
  'CHECKLIST_SYNTH_AI_001','PDF_SYNTH_AI_001','ORG_SYNTH_001',
  'DIRECTOR_SYNTH_001','MODEL_SYNTH_001']){
  assert.equal(s.includes(secret),false);
 }
});
test('immutable input snapshots even if output is mutated',()=>{
 const x=inputs(),before=structuredClone(x);
 const r=assess(x);r.selected_agents.push('other');
 assert.deepEqual(x,before);
});
test('null or malformed roots block safely',()=>{
 fail(run({sourceScope:null}),'SOURCES_INCOMPLETE_OR_STALE');
 fail(run({screeningSignals:null}),'INVALID_SPECIALIST_SELECTION');
 fail(run({authorization:null}),'ORGANIZATION_OR_PRIVACY_APPROVAL_MISSING');
 fail(run({budget:null}),'AI_BUDGET_NOT_VERIFIED');
 fail(run({runtime:null}),'PRIVATE_GATEWAY_NOT_VERIFIED');
});
