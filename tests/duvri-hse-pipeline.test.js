'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {aggregateEvidenceGated}=require('../js/duvri-hse-pipeline.js');
const {SIGNAL_TO_AGENT}=require('../js/duvri-agent-contract.js');
const jobId='FASCICOLO_SYNTH_GATE_001';
const analysisRevisionId='ANALYSIS_SYNTH_GATE_001';
const fileId='CHECKLIST_SYNTH_GATE_001';
const ev=(verification_status='confirmed',file_id=fileId)=>({
  source_type:'current_job_checklist',file_id,locator:'campo sintetico 1',
  verification_status
});
const answer=(signal,value,verification_status='confirmed')=>({
  signal,answer:value,evidence:[ev(verification_status)]
});
const screening=(overrides={})=>
  Object.keys(SIGNAL_TO_AGENT).map(key=>key==='lavori_in_quota'
    ? answer(key,'yes',overrides.quotaSource||'confirmed')
    : answer(key,'no',overrides[key]||'confirmed'));
const finding={
  finding_id:'F-SYNTH-GATE_1',category:'caduta_materiali',
  work_phase:'attività sintetica in copertura',scenario:'materiale su percorso sottostante',
  interference_explanation:'compresenza attività del committente',
  exposed_parties:['dipendenti del committente'],
  source_evidence:[{
    source_type:'current_job_checklist',file_id:fileId,locator:'sezione 1',
    excerpt_or_fact:'dato sintetico',verification_status:'confirmed'
  }],
  proposed_measures:[{
    proposal:'Valutare la segregazione del percorso sottostante',
    implementation_owner_status:'to_assign',needs_human_validation:true
  }],
  validation_status:'to_be_reviewed'
};
const result=(agent_id,findings=[])=>({
  schema_version:'colligo-duvri-agent-analysis/1.0',
  job_id:jobId,agent_id,status:'completed',findings,
  missing_information:[],conflicts:[],requires_human_review:true
});
const agents=()=>[result('documentale'),result('normativa'),
  result('coordinamento'),result('lavori_quota',[structuredClone(finding)])];
const run=(params={})=>aggregateEvidenceGated({
  jobId,analysisRevisionId,screeningAnswers:screening(),
  allowedFileIds:[fileId],agentResults:agents(),...params
});

test('confirmed evidence with all agents produces a packet eligible for technical review',()=>{
  const r=run();
  assert.equal(r.state,'needs_review');
  assert.deepEqual(r.screening_confirmation_required,[]);
  assert.equal(r.analysis_revision_id,analysisRevisionId);
  assert.equal(r.issuance_allowed,false);
});
test('uncertain positive keeps specialist active but blocks review-readiness',()=>{
  const r=run({screeningAnswers:screening({quotaSource:'extracted_unconfirmed'})});
  assert.equal(r.state,'awaiting_input');
  assert.equal(r.findings.length,1);
  assert.ok(r.required_agents.includes('lavori_quota'));
  assert.ok(r.screening_confirmation_required.includes('lavori_in_quota'));
  assert.equal(r.issuance_allowed,false);
});
test('uncertain negative cannot be silently treated as an absent electrical risk',()=>{
  const r=run({screeningAnswers:screening({impianti_elettrici:'extracted_unconfirmed'})});
  assert.equal(r.state,'awaiting_input');
  assert.ok(r.screening_confirmation_required.includes('impianti_elettrici'));
  assert.ok(r.screening_required.includes('impianti_elettrici'));
});
test('foreign screening file blocks and leaks no findings',()=>{
  const inputs=screening();
  inputs[0].evidence[0].file_id='FOREIGN_FILE_ID';
  const r=run({screeningAnswers:inputs});
  assert.equal(r.state,'blocked');
  assert.deepEqual(r.findings,[]);
});
test('absent required specialist blocks after grounded screening',()=>{
  const r=run({agentResults:agents().slice(0,3)});
  assert.equal(r.state,'blocked');
  assert.deepEqual(r.pending_agents,['lavori_quota']);
});
test('invalid specialist claim blocks entire case with no findings',()=>{
  const a=agents();
  a[3].findings[0].source_evidence[0].file_id='FOREIGN_FILE_ID';
  const r=run({agentResults:a});
  assert.equal(r.state,'blocked');
  assert.deepEqual(r.findings,[]);
});
test('unknown screening category cannot bypass normalization',()=>{
  const a=screening();a.push(answer('cliente_coin','yes'));
  assert.equal(run({screeningAnswers:a}).state,'blocked');
});
test('missing backend ACL and analysis revision fail closed',()=>{
  assert.equal(run({allowedFileIds:[]}).state,'blocked');
  assert.equal(run({analysisRevisionId:''}).state,'blocked');
  assert.equal(run({allowedFileIds:null}).state,'blocked');
});
test('missing screening input is not silently equivalent to no risks',()=>{
  const r=run({screeningAnswers:[]});
  assert.equal(r.state,'blocked');
  assert.equal(r.findings.length,0);
});
test('review packet does not mutate either specialist results or original screening',()=>{
  const a=agents(), s=screening(), origA=structuredClone(a),origS=structuredClone(s);
  const r=run({agentResults:a,screeningAnswers:s});
  r.findings[0].scenario='changed';
  assert.deepEqual(a,origA);
  assert.deepEqual(s,origS);
});
