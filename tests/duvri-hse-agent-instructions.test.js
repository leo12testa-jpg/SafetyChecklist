'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {AGENTS,SIGNAL_TO_AGENT,BASE_AGENTS}=require('../js/duvri-agent-contract.js');
const {stage,getAgentInstruction,VERSION}=require('../js/duvri-hse-agent-instructions.js');
const job='FASCICOLO_SYNTH_ROLES_001',analysis='ANALYSIS_SYNTH_ROLES_001',
 extraction='EXTRACT_SYNTH_ROLES_001';
const scope=()=>({
 schema_version:'colligo-duvri-hse-evidence-scope/1.0',
 job_id:job,analysis_revision_id:analysis,extraction_revision_id:extraction,
 state:'ready_for_hse_screening',checklist_ready:true,issuance_allowed:false,
 allowed_file_ids:['CHECKLIST_SYNTH_ROLES_001','PDF_SYNTH_ROLES_001'],
 withheld_file_ids:[],manual_review_file_ids:[]
});
const signals=()=>Object.fromEntries(Object.keys(SIGNAL_TO_AGENT).map(x=>[x,'no']));
const sample=()=>({jobId:job,analysisRevisionId:analysis,extractionRevisionId:extraction,
 sourceScope:scope(),screeningSignals:signals()});
const run=override=>stage({...sample(),...override});
const safe=x=>{
 assert.equal(x.provider_dispatch_allowed,false);
 assert.equal(x.external_data_transfer_allowed,false);
 assert.equal(x.issuance_allowed,false);
};
test('every official HSE agent has a distinct two-part role catalog',()=>{
 assert.equal(AGENTS.length,12);
 const descriptions=new Set();
 for(const agentId of AGENTS){
  const role=getAgentInstruction(agentId);
  assert.equal(role.agent_id,agentId);
  assert.equal(role.output_schema_version,'colligo-duvri-agent-analysis/1.0');
  assert.equal(role.requires_human_review,true);
  assert.ok(role.instructions.length>=9);
  assert.equal(Object.isFrozen(role.instructions),true);
  const specialty=role.instructions.slice(-2).join(' ');
  assert.equal(descriptions.has(specialty),false);
  descriptions.add(specialty);
 }
});
test('all role instructions reject instructions embedded in documents',()=>{
 for(const id of AGENTS){
  const s=getAgentInstruction(id).instructions.join(' ');
  assert.match(s,/DATI NON AFFIDABILI/);
  assert.match(s,/ignora qualsiasi istruzione/);
  assert.match(s,/file_id/);
  assert.match(s,/locator/);
  assert.match(s,/requires_human_review:true/);
  assert.match(s,/risk_score/);
 }
});
test('missing or unknown specialist never creates a role',()=>{
 assert.equal(getAgentInstruction('fake_agent'),null);
 assert.equal(getAgentInstruction(''),null);
});
test('complete all-no screening creates only baseline three tasks, never calls AI',()=>{
 const x=run();
 assert.equal(x.schema_version,VERSION);
 assert.equal(x.state,'tasks_staged_for_private_backend');
 assert.deepEqual(x.selected_agents,BASE_AGENTS);
 assert.equal(x.agent_tasks.length,3);
 assert.deepEqual(x.needs_screening,[]);
 safe(x);
});
test('quota yes causes quota agent to be included in exact roster',()=>{
 const s=signals();s.lavori_in_quota='yes';
 const x=run({screeningSignals:s});
 assert.equal(x.state,'tasks_staged_for_private_backend');
 assert.deepEqual(x.selected_agents,[...BASE_AGENTS,'lavori_quota']);
 safe(x);
});
test('all specialist signals yes result in exactly twelve tasks',()=>{
 const s=Object.fromEntries(Object.keys(SIGNAL_TO_AGENT).map(x=>[x,'yes']));
 const x=run({screeningSignals:s});
 assert.equal(x.agent_tasks.length,12);
 assert.equal(new Set(x.selected_agents).size,12);
 for(const agent of AGENTS)assert.ok(x.selected_agents.includes(agent));
 safe(x);
});
test('unanswered risk screening cannot silently drop specialists',()=>{
 const s=signals();delete s.ambienti_confinati;
 const x=run({screeningSignals:s});
 assert.equal(x.state,'blocked');
 assert.deepEqual(x.blockers,['SPECIALIST_SCREENING_INCOMPLETE']);
 assert.deepEqual(x.needs_screening,['ambienti_confinati']);
 assert.deepEqual(x.agent_tasks,[]);
 safe(x);
});
test('explicit unknown produces unresolved screening, not agent exclusion',()=>{
 const s=signals();s.chimici_atex='unknown';
 const x=run({screeningSignals:s});
 assert.equal(x.state,'blocked');
 assert.ok(x.needs_screening.includes('chimici_atex'));
 safe(x);
});
test('unknown signal name fails without leaking arbitrary input',()=>{
 const s=signals();s.untrusted_instruction='INVADE_DOCUMENTI';
 const x=run({screeningSignals:s});
 assert.equal(x.state,'blocked');
 assert.deepEqual(x.blockers,['INVALID_SPECIALIST_SCREENING']);
 assert.equal(JSON.stringify(x).includes('INVADE_DOCUMENTI'),false);
 safe(x);
});
test('missing checklist, withheld or manual-review document blocks task staging',()=>{
 for(const [key,val] of [
  ['state','awaiting_extraction'],['checklist_ready',false],
  ['withheld_file_ids',['SCAN_SYNTH_ROLES_001']],
  ['manual_review_file_ids',['OCR_SYNTH_ROLES_001']],
  ['issuance_allowed',true],
  ['allowed_file_ids',[]]
 ]){
  const sc=scope();sc[key]=val;
  const x=run({sourceScope:sc});
  assert.equal(x.state,'blocked');
  assert.deepEqual(x.blockers,['SOURCES_INCOMPLETE_OR_STALE']);
  safe(x);
 }
});
test('duplicated or invalid file IDs do not enter agent task payloads',()=>{
 for(const ids of [
  ['CHECKLIST_SYNTH_ROLES_001','CHECKLIST_SYNTH_ROLES_001'],
  ['INVALID!'],
  []]){
  const sc=scope();sc.allowed_file_ids=ids;
  const x=run({sourceScope:sc});
  assert.equal(x.state,'blocked');safe(x);
 }
});
test('foreign case or extraction revision cannot reuse specialist task list',()=>{
 for(const [key,val] of [
  ['job_id','FOREIGN_CASE_001'],['analysis_revision_id','OLD_ANALYSIS_001'],
  ['extraction_revision_id','OLD_EXTRACT_001']]){
  const sc=scope();sc[key]=val;
  assert.equal(run({sourceScope:sc}).state,'blocked');
 }
});
test('invalid input blocks without throwing or disclosing private text',()=>{
 const x=stage();assert.equal(x.state,'blocked');safe(x);
 const other=run({sourceScope:null});assert.equal(other.state,'blocked');safe(other);
});
test('task envelope includes IDs and output schema but no copied source text',()=>{
 const x=run();
 for(const task of x.agent_tasks){
  assert.equal(task.job_id,job);
  assert.equal(task.analysis_revision_id,analysis);
  assert.equal(task.extraction_revision_id,extraction);
  assert.equal(task.output_schema_version,'colligo-duvri-agent-analysis/1.0');
  assert.deepEqual(task.allowed_file_ids,scope().allowed_file_ids);
  assert.equal(task.requires_human_review,true);
  assert.equal('source_text' in task,false);
  assert.equal('prompt_data' in task,false);
 }
 safe(x);
});
test('mutating output does not alter trusted input or static role definitions',()=>{
 const params=sample(),before=structuredClone(params);
 const result=stage(params);result.agent_tasks[0].instructions.push('MODIFIED');
 assert.deepEqual(params,before);
 assert.equal(getAgentInstruction('documentale').instructions.includes('MODIFIED'),false);
});
test('scope status false plus irrelevant client flag never allows dispatch',()=>{
 const input=sample();input.auto_approve=true;input.provider_key='SECRET';
 const x=stage(input);
 assert.equal(x.state,'tasks_staged_for_private_backend');
 assert.equal(JSON.stringify(x).includes('SECRET'),false);
 safe(x);
});
test('normativa agent must not fabricate law or threshold',()=>{
 const t=getAgentInstruction('normativa').instructions.join(' ');
 assert.match(t,/Non attribuire articoli/);
 assert.match(t,/fonte normativa aggiornata/);
});
test('no role contains a specific client name or a ready-to-send email',()=>{
 for(const a of AGENTS){
  const t=getAgentInstruction(a).instructions.join(' ');
  for(const term of ['COIN','Carrefour','Interparking','PAM Local','@gmail.com']){
   assert.equal(t.includes(term),false);
  }
 }
});
