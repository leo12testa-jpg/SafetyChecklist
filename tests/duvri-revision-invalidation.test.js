'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {plan,FIELDS,ORDER,VERSION}=require('../js/duvri-revision-invalidation.js');
const job='FASCICOLO_SYNTH_REV_001';
const previous=()=>({
 job_id:job,snapshot_revision_id:'SNAPSHOT_SYNTH_001',
 manifest_sha256:'a'.repeat(64),client_response_revision_id:'CLIENT_REPLY_SYNTH_001',
 extraction_revision_id:'EXTRACT_SYNTH_001',
 ocr_confirmation_revision_id:'OCR_CONF_SYNTH_001',
 source_scope_revision_id:'SCOPE_SYNTH_001',
 screening_revision_id:'SCREEN_SYNTH_001',
 analysis_revision_id:'ANALYSIS_SYNTH_001',packet_sha256:'b'.repeat(64),
 clarification_register_sha256:'c'.repeat(64),
 clarification_routing_revision_id:'TRIAGE_SYNTH_001',
 hse_review_revision_id:'REVIEW_SYNTH_001',
 template_sha256:'d'.repeat(64),mapping_revision_id:'MAPPING_SYNTH_001',
 risk_method_revision_id:'METHOD_SYNTH_001',
 provider_config_revision_id:'PROVIDER_SYNTH_001'
});
const context=(from,to)=>({
 job_id:job,expected_previous_revision_id:from.snapshot_revision_id,
 current_snapshot_revision_id:to.snapshot_revision_id,
 authenticated:true,can_update_fascicolo:true,
 previous_snapshot_server_verified:true,current_snapshot_server_verified:true
});
const update=(patch={})=>{
 const before=previous();
 const after={...before,snapshot_revision_id:'SNAPSHOT_SYNTH_002',...patch};
 return {previous:before,current:after,trustedContext:context(before,after)};
};
const check=(patch)=>plan(update(patch));
const denied=(value,code)=>{
 assert.equal(value.state,'blocked');assert.deepEqual(value.blockers,[code]);
 assert.deepEqual(value.invalidate_artifacts,[]);
 assert.equal(value.persist_allowed,false);assert.equal(value.issuance_allowed,false);
};
test('public dependency registry fixed, no execution or DUVRI issuance',()=>{
 assert.equal(VERSION,'colligo-duvri-invalidation-plan/1.0');
 assert.equal(FIELDS.length,15);assert.equal(ORDER.length,14);
 assert.equal(Object.isFrozen(FIELDS),true);assert.equal(Object.isFrozen(ORDER),true);
});
test('changed checklist/attachments invalidates every dependent stage',()=>{
 const x=check({manifest_sha256:'f'.repeat(64)});
 assert.equal(x.state,'invalidation_required');
 assert.deepEqual(x.changed_fields,['manifest_sha256']);
 assert.equal(x.invalidate_count,13);
 assert.ok(x.invalidate_artifacts.includes('ocr_confirmation'));
 assert.ok(x.invalidate_artifacts.includes('specialist_analysis'));
 assert.ok(x.invalidate_artifacts.includes('word_qa'));
 assert.equal(x.persist_allowed,false);
 assert.equal(x.plan_applied,false);
 assert.equal(x.issuance_allowed,false);
});
test('new extraction invalidates previous OCR, HSE and Word downstream',()=>{
 const x=check({extraction_revision_id:'EXTRACT_SYNTH_002'});
 for(const s of ['ocr_confirmation','source_scope','fact_match','hse_review','word_draft'])assert.ok(x.invalidate_artifacts.includes(s));
 assert.equal(x.invalidate_artifacts.includes('extraction'),false);
});
test('OCR confirmation revision change requires fresh HSE screening',()=>{
 const x=check({ocr_confirmation_revision_id:'OCR_CONF_SYNTH_002'});
 assert.ok(x.invalidate_artifacts.includes('source_scope'));
 assert.ok(x.invalidate_artifacts.includes('specialist_analysis'));
 assert.ok(x.invalidate_artifacts.includes('clarification_routing'));
 assert.ok(x.invalidate_artifacts.includes('technical_preflight'));
});
test('evidence scope changes invalidate analysis review even with same PDF hash',()=>{
 const x=check({source_scope_revision_id:'SCOPE_SYNTH_002'});
 assert.ok(x.invalidate_artifacts.includes('ai_preflight'));
 assert.ok(x.invalidate_artifacts.includes('word_qa'));
 assert.equal(x.invalidate_artifacts.includes('extraction'),false);
});
test('screening changes invalidate specialists but not initial extraction',()=>{
 const x=check({screening_revision_id:'SCREEN_SYNTH_002'});
 assert.ok(x.invalidate_artifacts.includes('specialist_analysis'));
 assert.equal(x.invalidate_artifacts.includes('extraction'),false);
});
test('new HSE packet invalidates fact match and technician decisions',()=>{
 const x=check({packet_sha256:'e'.repeat(64)});
 for(const s of ['fact_match','clarification_register','clarification_routing','hse_review','word_draft'])
  assert.ok(x.invalidate_artifacts.includes(s));
 assert.equal(x.invalidate_artifacts.includes('screening'),false);
});
test('new clarification register invalidates routing and prior review',()=>{
 const x=check({clarification_register_sha256:'e'.repeat(64)});
 for(const s of ['clarification_routing','hse_review','word_qa'])assert.ok(x.invalidate_artifacts.includes(s));
 assert.equal(x.invalidate_artifacts.includes('fact_match'),false);
});
test('technician changing routing requires HSE review again, never auto-closes a question',()=>{
 const x=check({clarification_routing_revision_id:'TRIAGE_SYNTH_002'});
 assert.ok(x.invalidate_artifacts.includes('hse_review'));
 assert.ok(x.invalidate_artifacts.includes('technical_preflight'));
 assert.equal(x.reanalysis_completed,false);
});
test('HSE decision revision change invalidates draft and Word QA',()=>{
 const x=check({hse_review_revision_id:'REVIEW_SYNTH_002'});
 assert.deepEqual(x.invalidate_artifacts,['word_draft','word_qa','technical_preflight']);
});
test('Word template changes do not reuse generated document or QA',()=>{
 const x=check({template_sha256:'1'.repeat(64)});
 assert.deepEqual(x.invalidate_artifacts,['word_draft','word_qa','technical_preflight']);
});
test('D2 mapping change always invalidates Word draft and QA',()=>{
 const x=check({mapping_revision_id:'MAPPING_SYNTH_002'});
 assert.deepEqual(x.invalidate_artifacts,['word_draft','word_qa','technical_preflight']);
});
test('D1 methodology change invalidates risk review and Word',()=>{
 const x=check({risk_method_revision_id:'METHOD_SYNTH_002'});
 assert.deepEqual(x.invalidate_artifacts,['risk_review','word_draft','word_qa','technical_preflight']);
});
test('provider configuration change invalidates old agent results, not only budgets',()=>{
 const x=check({provider_config_revision_id:'PROVIDER_SYNTH_002'});
 for(const s of ['ai_preflight','specialist_analysis','fact_match','hse_review','word_qa'])
  assert.ok(x.invalidate_artifacts.includes(s));
});
test('multiple simultaneous changes create stable union without duplicates',()=>{
 const x=check({manifest_sha256:'f'.repeat(64),template_sha256:'f'.repeat(64)});
 assert.deepEqual(x.changed_fields,['manifest_sha256','template_sha256']);
 assert.equal(x.invalidate_artifacts.length,new Set(x.invalidate_artifacts).size);
 assert.equal(x.invalidate_artifacts[0],'extraction');
 assert.equal(x.invalidate_artifacts.at(-1),'technical_preflight');
});
test('all-unchanged snapshot remains no-change only if revision is unchanged',()=>{
 const before=previous(),after=structuredClone(before);
 const x=plan({previous:before,current:after,trustedContext:context(before,after)});
 assert.equal(x.state,'no_dependency_change');
 assert.deepEqual(x.invalidate_artifacts,[]);
 assert.equal(x.plan_applied,false);assert.equal(x.persist_allowed,false);
});
test('new snapshot ID without any tracked dependency change is denied',()=>{
 denied(plan(update()),'REVISION_ADVANCED_WITHOUT_DECLARED_DEPENDENCY_CHANGE');
});
test('modified document without snapshot revision advance is denied',()=>{
 const x=update({manifest_sha256:'f'.repeat(64)});
 x.current.snapshot_revision_id=x.previous.snapshot_revision_id;
 x.trustedContext=context(x.previous,x.current);
 denied(plan(x),'CHANGES_WITHOUT_NEW_SNAPSHOT_REVISION');
});
test('different customer, malformed SHA and missing field are denied',()=>{
 let x=update({manifest_sha256:'f'.repeat(64)});
 x.current.job_id='OTHER_JOB_001';
 denied(plan(x),'INVALID_OR_CROSS_JOB_SNAPSHOTS');
 x=update({manifest_sha256:'f'.repeat(64)});x.current.manifest_sha256='truncated';
 denied(plan(x),'INVALID_OR_CROSS_JOB_SNAPSHOTS');
 x=update({manifest_sha256:'f'.repeat(64)});delete x.current.mapping_revision_id;
 denied(plan(x),'INVALID_OR_CROSS_JOB_SNAPSHOTS');
});
test('malformed metadata cannot smuggle private document information',()=>{
 const x=update({manifest_sha256:'f'.repeat(64)});
 x.current.customer_text='PRIVATE_SYNTHETIC_TEXT';
 const out=plan(x);denied(out,'INVALID_OR_CROSS_JOB_SNAPSHOTS');
 assert.equal(JSON.stringify(out).includes('PRIVATE_SYNTHETIC_TEXT'),false);
});
test('server identity and CAS snapshot must match precisely',()=>{
 for(const [key,value] of [
  ['job_id','OTHER_JOB_001'],
  ['expected_previous_revision_id','SNAPSHOT_OLD_001'],
  ['current_snapshot_revision_id','SNAPSHOT_OLD_001'],
  ['authenticated',false],['can_update_fascicolo',false],
  ['previous_snapshot_server_verified',false],['current_snapshot_server_verified',false]
 ]) {
  const x=update({manifest_sha256:'f'.repeat(64)});
  x.trustedContext[key]=value;
  denied(plan(x),'UNTRUSTED_OR_STALE_CAS_CONTEXT');
 }
});
test('do not trust extra authorization fields or browser claims',()=>{
 const x=update({manifest_sha256:'f'.repeat(64)});
 x.trustedContext.client_force_approve=true;
 denied(plan(x),'UNTRUSTED_OR_STALE_CAS_CONTEXT');
});
test('optional uncreated artifacts may change null -> valid revision',()=>{
 const x=update({analysis_revision_id:'ANALYSIS_SYNTH_002'});
 x.previous.packet_sha256=null;
 x.current.packet_sha256='f'.repeat(64);
 const result=plan(x);
 assert.equal(result.state,'invalidation_required');
 assert.ok(result.invalidate_artifacts.includes('hse_review'));
});
test('trusted input objects stay untouched, output carries no document bytes',()=>{
 const x=update({manifest_sha256:'f'.repeat(64)});
 const before=structuredClone(x),out=plan(x);
 out.changed_fields.push('FAKE');
 assert.deepEqual(x,before);
 assert.equal(JSON.stringify(out).includes('FASCICOLO_SYNTH_REV_001'),true);
 assert.equal(Object.prototype.hasOwnProperty.call(out,'documents'),false);
});
test('no input always fails closed without throwing',()=>{
 denied(plan(),'INVALID_OR_CROSS_JOB_SNAPSHOTS');
 denied(plan({previous:null,current:null}),'INVALID_OR_CROSS_JOB_SNAPSHOTS');
});

test('integration: changed PDF hash invalidates extraction attestation and all downstream stages',()=>{
 const {buildHseEvidenceScope}=require('../js/duvri-hse-evidence-scope.js');
 const files=[
  {file_id:'CHECKLIST_SYNTH_REV_001',job_id:job,role:'client_checklist',
   mime_type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
   size_bytes:1024,sha256:'a'.repeat(64),parse_status:'parsed'},
  {file_id:'PDF_SYNTH_REV_001',job_id:job,role:'supporting_document',
   mime_type:'application/pdf',size_bytes:2048,sha256:'b'.repeat(64),
   parse_status:'parsed'}
 ];
 const attest=files.map(f=>({
  schema_version:'colligo-duvri-extraction-attestation/1.0',
  job_id:job,analysis_revision_id:'ANALYSIS_SYNTH_001',
  extraction_revision_id:'EXTRACT_SYNTH_001',
  file_id:f.file_id,source_sha256:f.sha256,
  evidence_kind:'extracted_text',source_locator_verified:true,backend_verified:true
 }));
 const scope1=buildHseEvidenceScope({
  jobId:job,analysisRevisionId:'ANALYSIS_SYNTH_001',
  extractionRevisionId:'EXTRACT_SYNTH_001',files,extractions:attest
 });
 assert.equal(scope1.state,'ready_for_hse_screening');
 const changedFiles=structuredClone(files);changedFiles[1].sha256='f'.repeat(64);
 const scope2=buildHseEvidenceScope({
  jobId:job,analysisRevisionId:'ANALYSIS_SYNTH_001',
  extractionRevisionId:'EXTRACT_SYNTH_001',files:changedFiles,extractions:attest
 });
 assert.equal(scope2.state,'blocked');
 const result=check({manifest_sha256:'f'.repeat(64)});
 assert.ok(result.invalidate_artifacts.includes('source_scope'));
 assert.ok(result.invalidate_artifacts.includes('hse_review'));
 assert.ok(result.invalidate_artifacts.includes('word_qa'));
 assert.equal(result.issuance_allowed,false);
});

test('new client answer or integration cannot reuse HSE analysis or Word',()=>{
 const r=check({client_response_revision_id:'CLIENT_REPLY_SYNTH_002'});
 assert.equal(r.state,'invalidation_required');
 for(const stage of ['source_scope','screening','specialist_analysis',
  'fact_match','clarification_register','hse_review','word_draft','word_qa'])
  assert.ok(r.invalidate_artifacts.includes(stage),stage);
 assert.equal(r.issuance_allowed,false);
});
test('client response without new dossier snapshot revision is refused',()=>{
 const x=update({client_response_revision_id:'CLIENT_REPLY_SYNTH_002'});
 x.current.snapshot_revision_id=x.previous.snapshot_revision_id;
 x.trustedContext=context(x.previous,x.current);
 denied(plan(x),'CHANGES_WITHOUT_NEW_SNAPSHOT_REVISION');
});
