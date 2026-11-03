'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const contract=require('../js/duvri-agent-contract.js');
const {stage}=require('../js/duvri-hse-agent-instructions.js');
const {assess,VERSION}=require('../js/duvri-hse-agent-run-supervisor.js');
const JOB='JOB_SYNTH_SUPERVISOR_001';
const ANALYSIS='ANALYSIS_SYNTH_SUPERVISOR_001';
const EXTRACTION='EXTRACTION_SYNTH_SUPERVISOR_001';
const RUN='RUN_SYNTH_SUPERVISOR_001';
const sha=x=>x.repeat(64);
const signals=(selected=[])=>Object.fromEntries(
 Object.keys(contract.SIGNAL_TO_AGENT).map(k=>[k,selected.includes(k)?'yes':'no']));
const scope=()=>({
 schema_version:'colligo-duvri-hse-evidence-scope/1.0',
 job_id:JOB,analysis_revision_id:ANALYSIS,extraction_revision_id:EXTRACTION,
 state:'ready_for_hse_screening',checklist_ready:true,issuance_allowed:false,
 allowed_file_ids:['DOCX_SYNTH_CASE_001','PDF_SYNTH_CASE_001'],
 withheld_file_ids:[],manual_review_file_ids:[]
});
function staging(yes=[]){
 return stage({jobId:JOB,analysisRevisionId:ANALYSIS,
  extractionRevisionId:EXTRACTION,sourceScope:scope(),screeningSignals:signals(yes)});
}
function receipt(agentId,status='completed'){
 return {
  agent_id:agentId,job_id:JOB,analysis_revision_id:ANALYSIS,
  extraction_revision_id:EXTRACTION,run_revision_id:RUN,
  result_revision_id:'RESULT_REV_SYNTH_'+agentId,
  result_sha256:sha('a'),result_status:status,
  backend_result_hash_verified:true,agent_schema_validated:true,
  authorized_source_scope_verified:true,citation_match_verified:true
 };
}
const base=()=>({
 jobId:JOB,analysisRevisionId:ANALYSIS,
 extractionRevisionId:EXTRACTION,runRevisionId:RUN,currentRunRevisionId:RUN,
 staged:staging(),receipts:[]
});
const run=(override={})=>assess({...base(),...override});
function safe(x){
 assert.equal(x.schema_version,VERSION);
 assert.equal(x.provider_dispatch_allowed,false);
 assert.equal(x.external_data_transfer_allowed,false);
 assert.equal(x.document_draft_allowed,false);
 assert.equal(x.issuance_allowed,false);
 assert.equal(x.hse_approved,false);
 assert.equal(x.requires_human_review,true);
 assert.equal('risk_score' in x,false);
}
test('first phase lists only documentale and normativa',()=>{
 const r=run();safe(r);
 assert.equal(r.state,'awaiting_specialist_results');
 assert.equal(r.phase,'foundation');
 assert.deepEqual(r.next_agent_ids,['documentale','normativa']);
 assert.deepEqual(r.pending_agent_ids,['documentale','normativa','coordinamento']);
 assert.equal(r.recorded_agent_count,0);
});
test('one foundation result only stages the other foundation agent',()=>{
 const r=run({receipts:[receipt('documentale')]});safe(r);
 assert.equal(r.phase,'foundation');
 assert.deepEqual(r.next_agent_ids,['normativa']);
});
test('coordinator can be staged after both foundation results, never before',()=>{
 const r=run({receipts:[receipt('documentale'),receipt('normativa')]});safe(r);
 assert.equal(r.phase,'coordination');
 assert.deepEqual(r.next_agent_ids,['coordinamento']);
 assert.deepEqual(r.pending_agent_ids,['coordinamento']);
});
test('baseline three agents completed only prepares private human review',()=>{
 const r=run({receipts:['documentale','normativa','coordinamento'].map(a=>receipt(a))});safe(r);
 assert.equal(r.phase,'complete');
 assert.equal(r.state,'ready_for_private_hse_packet_review');
 assert.deepEqual(r.blocker_codes,['HUMAN_HSE_REVIEW_REQUIRED']);
 assert.equal(r.recorded_agent_count,3);
});
test('one positive signal creates only the matching specialist wave',()=>{
 const s=staging(['lavori_in_quota']),receipts=['documentale','normativa'].map(a=>receipt(a));
 const r=run({staged:s,receipts});safe(r);
 assert.equal(r.phase,'specialists');
 assert.deepEqual(r.next_agent_ids,['lavori_quota']);
 assert.deepEqual(r.pending_agent_ids,['coordinamento','lavori_quota']);
});
test('all nine specialists selected and required before coordinator',()=>{
 const s=staging(Object.keys(contract.SIGNAL_TO_AGENT));
 const foundation=['documentale','normativa'].map(a=>receipt(a));
 const r=run({staged:s,receipts:foundation});safe(r);
 assert.equal(r.phase,'specialists');
 assert.equal(r.next_agent_ids.length,9);
 assert.equal(r.pending_agent_ids.length,10);
 const all=s.selected_agents.filter(x=>x!=='coordinamento').map(a=>receipt(a));
 const next=run({staged:s,receipts:all});safe(next);
 assert.equal(next.phase,'coordination');
 assert.deepEqual(next.next_agent_ids,['coordinamento']);
 const done=run({staged:s,receipts:[...all,receipt('coordinamento')]});safe(done);
 assert.equal(done.phase,'complete');
 assert.equal(done.recorded_agent_count,12);
});
test('specialist cannot report before foundation is complete',()=>{
 const s=staging(['lavori_in_quota']);
 const r=run({staged:s,receipts:[receipt('documentale'),receipt('lavori_quota')]});safe(r);
 assert.equal(r.state,'blocked');
 assert.deepEqual(r.blocker_codes,['AGENT_DEPENDENCY_ORDER_VIOLATION']);
});
test('coordinator cannot report before a selected specialist',()=>{
 const s=staging(['lavori_in_quota']);
 const r=run({staged:s,receipts:['documentale','normativa','coordinamento'].map(a=>receipt(a))});
 safe(r);assert.equal(r.state,'blocked');
 assert.deepEqual(r.blocker_codes,['COORDINATOR_RAN_BEFORE_SPECIALISTS']);
});
test('coordinator cannot preempt both foundation agents',()=>{
 const r=run({receipts:[receipt('coordinamento')]});safe(r);
 assert.equal(r.state,'blocked');
});
test('needs clarification remains a hard human clarification gate',()=>{
 const r=run({receipts:[
  receipt('documentale','needs_clarification'),receipt('normativa'),receipt('coordinamento')
 ]});safe(r);
 assert.equal(r.state,'awaiting_human_clarifications');
 assert.deepEqual(r.blocker_codes,['SPECIALIST_CLARIFICATIONS_REQUIRE_HUMAN']);
});
test('blocked specialist fails closed immediately',()=>{
 const r=run({receipts:[receipt('documentale','blocked')]});safe(r);
 assert.equal(r.state,'blocked');
 assert.deepEqual(r.blocker_codes,['SPECIALIST_REPORTED_BLOCKED']);
});
test('not applicable is never proof risk is absent',()=>{
 const r=run({receipts:[receipt('documentale','not_applicable'),receipt('normativa')]});safe(r);
 assert.equal(r.phase,'coordination');
 assert.equal(r.provider_dispatch_allowed,false);
 assert.equal(r.document_draft_allowed,false);
});
test('duplicate specialist result is rejected',()=>{
 const r=run({receipts:[receipt('documentale'),receipt('documentale')]});safe(r);
 assert.equal(r.state,'blocked');assert.deepEqual(r.blocker_codes,['INVALID_OR_DUPLICATE_AGENT_RECEIPT']);
});
test('foreign or unselected specialist result rejected',()=>{
 const r=run({receipts:[receipt('lavori_quota')]});safe(r);
 assert.equal(r.state,'blocked');
});
test('foreign case and revision references rejected',()=>{
 for(const [key,v] of [
  ['job_id','JOB_OTHER_SYNTH_001'],
  ['analysis_revision_id','ANALYSIS_OTHER_SYNTH_001'],
  ['extraction_revision_id','EXTRACTION_OTHER_SYNTH_001'],
  ['run_revision_id','RUN_OTHER_SYNTH_001']]){
  const e=receipt('documentale');e[key]=v;
  const r=run({receipts:[e]});safe(r);assert.equal(r.state,'blocked',key);
 }
});
test('stale run revision invalidates recorded receipts',()=>{
 const r=run({currentRunRevisionId:'RUN_NEW_SYNTH_002',
  receipts:[receipt('documentale')]});safe(r);
 assert.equal(r.state,'blocked');
 assert.deepEqual(r.blocker_codes,['INVALID_OR_STALE_AGENT_RUN']);
});
test('invalid digest or result revision cannot count',()=>{
 for(const [key,value] of [
  ['result_sha256','not-a-digest'],
  ['result_revision_id','!'],
  ['backend_result_hash_verified',false],
  ['agent_schema_validated',false],
  ['authorized_source_scope_verified',false],
  ['citation_match_verified',false]]){
  const e=receipt('documentale');e[key]=value;
  assert.equal(run({receipts:[e]}).state,'blocked',key);
 }
});
test('all verified receipts must have exact schema, no model injected fields',()=>{
 for(const [key,value] of [
  ['instructions_to_ignore','DISABLE_PRIVACY'],
  ['risk_score',9],
  ['provider_dispatch_allowed',true]]){
  const e=receipt('documentale');e[key]=value;
  const r=run({receipts:[e]});safe(r);
  assert.equal(r.state,'blocked');assert.equal(JSON.stringify(r).includes(key),false);
 }
});
test('malformed status and injected human authorization rejected',()=>{
 const e=receipt('documentale','approved');
 assert.equal(run({receipts:[e]}).state,'blocked');
 e.result_status='completed';e.agent_schema_validated='true';
 assert.equal(run({receipts:[e]}).state,'blocked');
});
test('staging must originate from complete source scope and screening',()=>{
 const r=run({staged:stage({jobId:JOB,analysisRevisionId:ANALYSIS,
  extractionRevisionId:EXTRACTION,sourceScope:scope(),screeningSignals:{}})});
 safe(r);assert.equal(r.state,'blocked');
 assert.deepEqual(r.blocker_codes,['INVALID_OR_UNTRUSTED_AGENT_TASKS']);
});
test('staging cannot include extra unknown agent',()=>{
 const s=staging();s.selected_agents.push('external_client_agent');
 const r=run({staged:s});safe(r);assert.equal(r.state,'blocked');
});
test('staging cannot duplicate or omit a coordinator agent',()=>{
 const s=staging();s.selected_agents[2]='documentale';
 const r=run({staged:s});safe(r);assert.equal(r.state,'blocked');
});
test('staging rejects foreign job and analysis revisions',()=>{
 const s=staging();s.agent_tasks[0].job_id='OTHER_SYNTH_JOB_001';
 assert.equal(run({staged:s}).state,'blocked');
 const t=staging();t.agent_tasks[0].analysis_revision_id='OTHER_SYNTH_REV_001';
 assert.equal(run({staged:t}).state,'blocked');
});
test('task tampering to add foreign file or private prompt rejected',()=>{
 const s=staging();s.agent_tasks[0].allowed_file_ids=['FOREIGN_SYNTH_FILE_001'];
 assert.equal(run({staged:s}).state,'blocked');
 const t=staging();t.agent_tasks[1].instructions=[];
 assert.equal(run({staged:t}).state,'blocked');
});
test('input cannot provide auto-approve or dispatch flags',()=>{
 const args=base();args.external_data_transfer_allowed=true;
 args.provider_dispatch_allowed=true;args.issuance_allowed=true;
 const r=assess(args);safe(r);
 assert.equal(r.phase,'foundation');
});
test('private client data is never present in blocked result',()=>{
 const r=assess({jobId:'JOB_SYNTH_PRIVACY_001',analysisRevisionId:ANALYSIS,
  extractionRevisionId:EXTRACTION,runRevisionId:RUN,currentRunRevisionId:RUN,
  staged:{client_name:'SYNTH_CLIENT_PRIVATE_NAME'},receipts:[{
   agent_id:'private_client',text:'SYNTH_CLIENT_PRIVATE_NAME'
  }]});
 safe(r);assert.equal(r.state,'blocked');
 assert.equal(JSON.stringify(r).includes('SYNTH_CLIENT_PRIVATE_NAME'),false);
});
test('empty or malformed input fails closed without exceptions',()=>{
 for(const input of [undefined,null,false,[],{},'IGNORED']){
  const r=assess(input);safe(r);assert.equal(r.state,'blocked');
 }
});
test('results do not mutate staging or evidence receipts',()=>{
 const s=staging(),receipts=['documentale','normativa'].map(a=>receipt(a));
 const before=structuredClone({s,receipts});
 const r=run({staged:s,receipts});safe(r);
 assert.deepEqual({s,receipts},before);
});
