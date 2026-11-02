'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {buildClarificationRegister}=require('../js/duvri-clarification-register.js');

const jobId='FASCICOLO_SYNTH_REQ_001';
const revision='ANALYSIS_SYNTH_REQ_001';
const extraction='EXTRACTION_SYNTH_REQ_001';
const checklist='CHECKLIST_SYNTH_REQ_001';
const pdf='ALLEGATO_SYNTH_REQ_001';
const clone=x=>structuredClone(x);
const historical=()=>({...ev('HISTORICAL_EXAMPLE','historical_2026_reference'),
  verification_status:'historical_example_only'});
const ev=(file_id=checklist,source_type='current_job_checklist')=>({
 source_type,file_id,locator:'sezione sintetica 1',
 excerpt_or_fact:'Informazione di prova da non copiare',
 verification_status:'confirmed'
});
const scope=()=>({
 schema_version:'colligo-duvri-hse-evidence-scope/1.0',job_id:jobId,
 analysis_revision_id:revision,extraction_revision_id:extraction,
 state:'ready_for_hse_screening',checklist_ready:true,
 allowed_file_ids:[checklist,pdf],withheld_file_ids:[],
 manual_review_file_ids:[],issuance_allowed:false
});
const packet=()=>({
 schema_version:'colligo-duvri-review-packet/1.0',job_id:jobId,
 analysis_revision_id:revision,state:'needs_review',human_review_required:true,
 issuance_allowed:false,required_agents:['documentale','normativa','coordinamento'],
 pending_agents:[],blocking_reasons:[],screening_required:[],
 screening_confirmation_required:[],findings:[],missing_information:[],
 conflicts:[]
});
const run=(p=packet(),s=scope(),options={})=>buildClarificationRegister({
 packet:p,sourceScope:s,expectedJobId:jobId,
 expectedAnalysisRevisionId:revision,
 expectedExtractionRevisionId:extraction,...options
});
test('clean synthetic packet yields no requests but never a DUVRI approval',()=>{
 const r=run();
 assert.equal(r.state,'no_open_requests');
 assert.equal(r.item_count,0);
 assert.equal(r.issuance_allowed,false);
 assert.equal(r.ready_for_technical_preflight,false);
 assert.equal(r.client_dispatch_allowed,false);
 assert.equal(r.human_review_required,true);
});
test('blocking missing information becomes a technician-only suggested question',()=>{
 const p=packet();
 p.state='awaiting_input';
 p.missing_information.push({
  agent_id:'documentale',question:'Quale orario è previsto?',
  why_needed:'Rischio di sovrapposizione delle attività',blocking:true
 });
 const r=run(p);
 assert.equal(r.state,'needs_technical_triage');
 assert.equal(r.blocking_count,1);
 assert.equal(r.blocks_document_draft,true);
 assert.equal(r.items[0].suggested_question,'Quale orario è previsto?');
 assert.equal(r.items[0].client_dispatch_allowed,false);
});
test('nonblocking information is visible but not falsely marked as a DUVRI approval',()=>{
 const p=packet();
 p.missing_information=[{
  agent_id:'normativa',question:'Confermare il riferimento interno',
  why_needed:'Completare la verifica',blocking:false
 }];
 const r=run(p);
 assert.equal(r.blocking_count,0);
 assert.equal(r.blocks_document_draft,false);
 assert.equal(r.issuance_allowed,false);
});
test('conflict carries locators without revealing excerpts',()=>{
 const p=packet();p.state='awaiting_input';
 p.conflicts=[{
  agent_id:'documentale',description:'Orari incoerenti nelle fonti sintetiche',
  resolution_question:'Quali orari devono essere confermati?',
  evidence:[ev(),ev(pdf,'current_job_document')]
 }];
 const r=run(p);
 assert.equal(r.items[0].kind,'conflicting_sources');
 assert.equal(r.items[0].source_references.length,2);
 assert.equal(r.items[0].blocking,true);
 assert.equal(JSON.stringify(r).includes('Informazione di prova da non copiare'),false);
});
test('foreign conflict attachment is blocked and question text withheld',()=>{
 const p=packet();p.state='awaiting_input';
 p.conflicts=[{
  agent_id:'documentale',description:'test',
  resolution_question:'Non esporre questa domanda',
  evidence:[ev(),ev('FILE_ALTRO_CLIENTE','current_job_document')]
 }];
 const r=run(p);
 assert.equal(r.state,'blocked');
 assert.deepEqual(r.items,[]);
 assert.equal(JSON.stringify(r).includes('Non esporre questa domanda'),false);
});
test('incomplete or stale source scope cannot produce questions',()=>{
 const cases=[
  {state:'awaiting_extraction'},
  {analysis_revision_id:'ANALYSIS_OLDER_SYNTH_001'},
  {extraction_revision_id:'EXTRACTION_OLDER_SYNTH_001'},
  {job_id:'OTHER_JOB_SYNTH_001'},
  {allowed_file_ids:[checklist,checklist]},
  {manual_review_file_ids:[pdf]},
  {withheld_file_ids:[pdf]},
  {checklist_ready:false}
 ];
 cases.forEach(m=>assert.equal(run(packet(),{...scope(),...m}).state,'blocked'));
});
test('expected revisions must be obtained from trusted current backend',()=>{
 assert.equal(run(packet(),scope(),{expectedAnalysisRevisionId:'OLD_ANALYSIS'}).state,'blocked');
 assert.equal(run(packet(),scope(),{expectedExtractionRevisionId:'OLD_EXTRACT'}).state,'blocked');
 assert.equal(run(packet(),scope(),{expectedJobId:'OTHER_JOB_SYNTH_001'}).state,'blocked');
 assert.equal(buildClarificationRegister().state,'blocked');
});
test('screening and confirmation are deduplicated and never interpreted as NO',()=>{
 const p=packet();p.state='awaiting_input';
 p.screening_required=['impianti_elettrici'];
 p.screening_confirmation_required=['impianti_elettrici','lavori_in_quota'];
 const r=run(p);
 assert.equal(r.item_count,2);
 assert.equal(r.blocking_count,2);
 assert.match(r.items[0].suggested_question,/Verificare/);
 assert.equal(r.items[0].source_index,'impianti_elettrici');
});
test('unknown screening signal cannot be injected',()=>{
 const p=packet();p.screening_required=['inventato'];
 assert.equal(run(p).state,'blocked');
});
test('finding requires clarification with current verified provenance',()=>{
 const p=packet();p.state='awaiting_input';
 p.findings=[{agent_id:'documentale',finding_id:'FINDING_SYNTH_001',
   validation_status:'requires_clarification',source_evidence:[ev()]}];
 const r=run(p);
 assert.equal(r.item_count,1);
 assert.equal(r.items[0].kind,'finding_clarification');
 assert.equal(r.items[0].source_references[0].file_id,checklist);
 assert.equal(r.blocking_count,1);
});
test('a historical example alone is never accepted as current finding evidence',()=>{
 const p=packet();p.state='awaiting_input';
 p.findings=[{agent_id:'documentale',finding_id:'FINDING_SYNTH_001',
  validation_status:'requires_clarification',
  source_evidence:[historical()]}];
 assert.equal(run(p).state,'blocked');
});
test('historical examples are not copied into current source references',()=>{
 const p=packet();p.state='awaiting_input';
 p.findings=[{agent_id:'documentale',finding_id:'FINDING_SYNTH_001',
   validation_status:'requires_clarification',
   source_evidence:[ev(),historical()]}];
 const r=run(p);
 assert.equal(r.state,'needs_technical_triage');
 assert.deepEqual(r.items[0].source_references.map(x=>x.file_id),[checklist]);
});
test('duplicate finding and invalid agent are rejected',()=>{
 const p=packet();p.state='awaiting_input';
 const f={agent_id:'documentale',finding_id:'FINDING_SYNTH_001',
   validation_status:'requires_clarification',source_evidence:[ev()]};
 p.findings=[f,clone(f)];
 assert.equal(run(p).state,'blocked');
 p.findings=[{...f,agent_id:'not_an_agent'}];
 assert.equal(run(p).state,'blocked');
});
test('pending agents or blocked review packet must not be treated as complete',()=>{
 const p=packet();p.pending_agents=['documentale'];
 assert.equal(run(p).state,'blocked');
 p.pending_agents=[];p.blocking_reasons=['unknown'];
 assert.equal(run(p).state,'blocked');
 p.blocking_reasons=[];p.state='blocked';
 assert.equal(run(p).state,'blocked');
});
test('awaiting_input without an explicit traceable question is blocked',()=>{
 const p=packet();p.state='awaiting_input';
 assert.equal(run(p).state,'blocked');
});
test('source arrays and input objects are never mutated',()=>{
 const p=packet(),s=scope();
 p.state='awaiting_input';
 p.conflicts=[{agent_id:'documentale',description:'Differenza sintetica',
  resolution_question:'Chiarire quale dato prevale?',
  evidence:[ev(),ev(pdf,'current_job_document')]}];
 const beforeP=clone(p),beforeS=clone(s);
 const r=run(p,s);
 r.items[0].source_references[0].file_id='CHANGED';
 assert.deepEqual(p,beforeP);
 assert.deepEqual(s,beforeS);
});

test('historical evidence mislabeled as current is rejected before questions',()=>{
 const p=packet();p.state='awaiting_input';
 p.findings=[{agent_id:'documentale',finding_id:'FINDING_SYNTH_001',
  validation_status:'requires_clarification',
  source_evidence:[ev(),ev('HISTORICAL_EXAMPLE','historical_2026_reference')]}];
 assert.equal(run(p).state,'blocked');
});
test('unknown evidence categories fail closed instead of being silently dropped',()=>{
 const p=packet();p.state='awaiting_input';
 p.findings=[{agent_id:'documentale',finding_id:'FINDING_SYNTH_001',
  validation_status:'requires_clarification',
  source_evidence:[ev(),ev('OTHER_SCOPE','fake_source')]}];
 assert.equal(run(p).state,'blocked');
});
test('blocked packets explicitly prevent drafting',()=>{
 const p=packet();p.state='blocked';
 const r=run(p);
 assert.equal(r.state,'blocked');
 assert.equal(r.blocks_document_draft,true);
 assert.equal(r.client_dispatch_allowed,false);
});
