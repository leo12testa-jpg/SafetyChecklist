'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {verify,VERSION}=require('../js/duvri-hse-fact-match.js');
const job='FASCICOLO_SYNTH_FACT_001',analysis='ANALYSIS_SYNTH_FACT_001',
 extraction='EXTRACTION_SYNTH_FACT_001';
const file='CHECKLIST_SYNTH_FACT_001',pdf='PDF_SYNTH_FACT_001',histId='HISTORICAL_SYNTH_FACT_001';
const quote=(id=file,type='current_job_checklist',locator='page:1:line:1',
 excerpt='Testo sintetico esatto',status='confirmed')=>({
 source_type:type,file_id:id,locator,excerpt_or_fact:excerpt,verification_status:status
});
const history=()=>quote(histId,'historical_2026_reference','page:3:line:2','Esempio storico fittizio','historical_example_only');
const fact=e=>({
 job_id:job,analysis_revision_id:analysis,extraction_revision_id:extraction,
 source_type:e.source_type,file_id:e.file_id,locator:e.locator,text:e.excerpt_or_fact,
 verification_status:e.verification_status,backend_verified:true
});
const reviewPacket=()=>({
 schema_version:'colligo-duvri-review-packet/1.0',
 job_id:job,analysis_revision_id:analysis,state:'needs_review',
 human_review_required:true,issuance_allowed:false,
 findings:[{agent_id:'documentale',finding_id:'FIND_SYNTH_FACT_001',
  source_evidence:[quote()]}],conflicts:[],blocking_reasons:[],pending_agents:[]
});
const sourceScope=()=>({
 schema_version:'colligo-duvri-hse-evidence-scope/1.0',job_id:job,
 analysis_revision_id:analysis,extraction_revision_id:extraction,
 state:'ready_for_hse_screening',checklist_ready:true,issuance_allowed:false,
 allowed_file_ids:[file,pdf],withheld_file_ids:[],manual_review_file_ids:[]
});
const input=()=>({
 packet:reviewPacket(),sourceScope:sourceScope(),sourceFacts:[fact(quote())],
 expectedJobId:job,expectedAnalysisRevisionId:analysis,
 expectedExtractionRevisionId:extraction,
 allowedHistoricalReferenceIds:[],allowedInternalRuleIds:[]
});
const deny=(result,code)=>{
 assert.equal(result.state,'blocked');
 assert.equal(result.usable_for_hse_review,false);
 assert.equal(result.issuance_allowed,false);
 assert.deepEqual(result.blockers,[code]);
};
test('exact citation is only eligible for HSE review, never issuance',()=>{
 const r=verify(input());assert.equal(r.schema_version,VERSION);
 assert.equal(r.state,'exact_citations_matched_for_review');
 assert.equal(r.citations_checked,1);assert.equal(r.usable_for_hse_review,true);
 assert.equal(r.duvri_approved,false);assert.equal(r.issuance_allowed,false);
});
test('no context denies',()=>deny(verify(),'STALE_OR_INCOMPLETE_EVIDENCE_CONTEXT'));
test('fabricated text is blocked despite correct file ID',()=>{
 const x=input();x.packet.findings[0].source_evidence[0].excerpt_or_fact='Dato inventato';
 deny(verify(x),'CITATION_TEXT_NOT_IN_TRUSTED_EXTRACTION');
});
test('fabricated page locator is blocked',()=>{
 const x=input();x.packet.findings[0].source_evidence[0].locator='page:99:line:99';
 deny(verify(x),'CITATION_TEXT_NOT_IN_TRUSTED_EXTRACTION');
});
test('citations cannot be moved to another authorized file',()=>{
 const x=input();x.packet.findings[0].source_evidence[0].file_id=pdf;
 deny(verify(x),'CITATION_TEXT_NOT_IN_TRUSTED_EXTRACTION');
});
test('foreign file is rejected',()=>{
 const x=input();x.packet.findings[0].source_evidence[0].file_id='FOREIGN_FILE_001';
 deny(verify(x),'INVALID_CITATION');
});
test('stale or cross-job source facts reject all citations',()=>{
 for(const [k,v] of [['job_id','OTHER_JOB_001'],
  ['analysis_revision_id','OLD_ANALYSIS_001'],['extraction_revision_id','OLD_EXTRACT_001']]){
  const x=input();x.sourceFacts[0][k]=v;
  deny(verify(x),'INVALID_OR_UNAUTHORIZED_SOURCE_FACT');
 }
});
test('source facts require server-side verified context',()=>{
 const x=input();x.sourceFacts[0].backend_verified=false;
 deny(verify(x),'INVALID_OR_UNAUTHORIZED_SOURCE_FACT');
});
test('extraneous private data is never reflected',()=>{
 const x=input();x.sourceFacts[0].client_email='SECRET_SYNTH';
 const r=verify(x);deny(r,'INVALID_OR_UNAUTHORIZED_SOURCE_FACT');
 assert.equal(JSON.stringify(r).includes('SECRET_SYNTH'),false);
});
test('duplicate source fact is not trusted',()=>{
 const x=input();x.sourceFacts.push(structuredClone(x.sourceFacts[0]));
 deny(verify(x),'DUPLICATE_SOURCE_FACT');
});
test('unconfirmed OCR or extracted text stays in human review',()=>{
 for(const status of ['extracted_unconfirmed','requires_verification']){
  const x=input();x.sourceFacts[0].verification_status=status;
  x.packet.findings[0].source_evidence[0].verification_status=status;
  const r=verify(x);assert.equal(r.state,'citations_need_confirmation');
  assert.equal(r.usable_for_hse_review,false);assert.equal(r.issuance_allowed,false);
 }
});
test('agent may not upgrade an unverified fact to confirmed',()=>{
 const x=input();x.sourceFacts[0].verification_status='extracted_unconfirmed';
 deny(verify(x),'CITATION_TEXT_NOT_IN_TRUSTED_EXTRACTION');
});
test('historical example cannot anchor current case finding',()=>{
 const x=input();x.packet.findings[0].source_evidence=[history()];
 x.sourceFacts=[fact(history())];x.allowedHistoricalReferenceIds=[histId];
 const r=verify(x);assert.equal(r.state,'citations_need_confirmation');
 assert.equal(r.usable_for_hse_review,false);
});
test('historical example may supplement confirmed current case evidence',()=>{
 const x=input();x.packet.findings[0].source_evidence.push(history());
 x.sourceFacts.push(fact(history()));x.allowedHistoricalReferenceIds=[histId];
 const r=verify(x);assert.equal(r.state,'exact_citations_matched_for_review');
 assert.equal(r.citations_checked,2);assert.equal(r.issuance_allowed,false);
});
test('historical source presented as confirmed current is invalid',()=>{
 const x=input();x.packet.findings[0].source_evidence.push({...history(),verification_status:'confirmed'});
 x.sourceFacts.push(fact(history()));x.allowedHistoricalReferenceIds=[histId];
 deny(verify(x),'INVALID_CITATION');
});
test('historical file not approved in this case is invalid',()=>{
 const x=input();x.packet.findings[0].source_evidence.push(history());
 deny(verify(x),'INVALID_CITATION');
});
test('every finding must have confirmed current evidence independently',()=>{
 const x=input();x.packet.findings.push({
  agent_id:'normativa',finding_id:'SECOND_SYNTH_FACT_001',source_evidence:[history()]});
 x.sourceFacts.push(fact(history()));x.allowedHistoricalReferenceIds=[histId];
 const r=verify(x);assert.equal(r.state,'citations_need_confirmation');
 assert.deepEqual(r.blockers,['FINDING_NOT_GROUNDED_IN_CONFIRMED_CURRENT_SOURCE']);
});
test('conflict requires two confirmed current facts',()=>{
 const x=input(),q=quote(pdf,'current_job_document','page:2:line:3','Altro fatto sintetico');
 x.packet.conflicts=[{agent_id:'documentale',evidence:[quote(),q]}];
 x.sourceFacts.push(fact(q));
 assert.equal(verify(x).state,'exact_citations_matched_for_review');
 x.packet.conflicts[0].evidence[1].verification_status='extracted_unconfirmed';
 x.sourceFacts[1].verification_status='extracted_unconfirmed';
 const r=verify(x);assert.equal(r.state,'citations_need_confirmation');
 assert.deepEqual(r.blockers,['CONFLICT_NOT_GROUNDED_IN_TWO_CURRENT_SOURCES']);
});
test('scope stale or partially unreadable stays blocked',()=>{
 for(const [k,v] of [
  ['analysis_revision_id','OLD_ANALYSIS_001'],['withheld_file_ids',[pdf]],
  ['manual_review_file_ids',[pdf]],['state','awaiting_extraction']]){
  const x=input();x.sourceScope[k]=v;
  deny(verify(x),'STALE_OR_INCOMPLETE_EVIDENCE_CONTEXT');
 }
});
test('historical/current overlapping source authorities reject',()=>{
 const x=input();x.allowedHistoricalReferenceIds=[file];
 deny(verify(x),'OVERLAPPING_SOURCE_AUTHORITIES');
});
test('no citation never equals proven risk-free case',()=>{
 const x=input();x.packet.findings=[];x.sourceFacts=[];
 const r=verify(x);assert.equal(r.state,'awaiting_evidence');
 assert.equal(r.usable_for_hse_review,false);assert.equal(r.issuance_allowed,false);
});
test('malformed fact source type is rejected',()=>{
 const x=input();x.sourceFacts[0].source_type='other';
 deny(verify(x),'INVALID_OR_UNAUTHORIZED_SOURCE_FACT');
});
test('cannot mutate inputs or return source text',()=>{
 const x=input(),original=structuredClone(x);
 const r=verify(x);r.blockers.push('OTHER');
 assert.deepEqual(x,original);
 assert.equal(JSON.stringify(r).includes('Testo sintetico esatto'),false);
});
