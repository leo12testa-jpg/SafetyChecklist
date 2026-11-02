'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {assessReviewSession}=require('../js/duvri-hse-review-session.js');
const job='FASCICOLO_SYNTH_REVIEW_001';
const analysis='ANALYSIS_SYNTH_REVIEW_001';
const extract='EXTRACT_SYNTH_REVIEW_001';
const doc='DOCX_SYNTH_REVIEW_001';
const packetRevision='PACKET_SYNTH_REVIEW_001';
const checksum='a'.repeat(64);
const sourceIds=['CHECKLIST_SYNTH_REVIEW_001','PDF_SYNTH_REVIEW_001'];
const clone=x=>structuredClone(x);
const accepted={agent_id:'lavori_quota',finding_id:'F-001',action:'accept_for_draft'};
function packet(){
 return {
  schema_version:'colligo-duvri-review-packet/1.0',
  job_id:job,analysis_revision_id:analysis,packet_revision_id:packetRevision,
  packet_sha256:checksum,state:'needs_review',
  human_review_required:true,issuance_allowed:false,
  required_agents:['lavori_quota'],pending_agents:[],
  screening_required:[],missing_information:[],conflicts:[],
  blocking_reasons:[],possible_overlaps:[],
  findings:[{
   agent_id:'lavori_quota',finding_id:'F-001',validation_status:'to_be_reviewed',
   source_evidence:[
    {source_type:'current_job_checklist',file_id:sourceIds[0],
     verification_status:'confirmed',locator:'Sezione fittizia 1'}
   ]
  }]
 };
}
function scope(){
 return {
  schema_version:'colligo-duvri-hse-evidence-scope/1.0',
  job_id:job,analysis_revision_id:analysis,extraction_revision_id:extract,
  state:'ready_for_hse_screening',allowed_file_ids:[...sourceIds],
  withheld_file_ids:[],manual_review_file_ids:[],checklist_ready:true,
  issuance_allowed:false,evidence_verified:false,human_review_required:true
 };
}
function ctx(){
 return {
  job_id:job,analysis_revision_id:analysis,
  current_analysis_revision_id:analysis,
  current_packet_revision_id:packetRevision,
  current_packet_sha256:checksum,
  packet_sha256_verified:true,
  document_revision_id:doc,current_document_revision_id:doc,
  current_extraction_revision_id:extract,
  reviewer_id:'REVIEWER_SYNTH_001',role:'tecnico',
  authenticated:true,can_review:true,
  allowed_historical_reference_ids:[],
  allowed_internal_rule_ids:[]
 };
}
const run=(p=packet(),s=scope(),d=[accepted],c=ctx())=>
 assessReviewSession({packet:p,sourceScope:s,decisions:d,reviewerContext:c});
test('valid synthetic review binds exact packet and Word revision but never issues a DUVRI',()=>{
 const r=run();
 assert.equal(r.state,'draft_findings_reviewed');
 assert.equal(r.packet_revision_id,packetRevision);
 assert.equal(r.document_revision_id,doc);
 assert.equal(r.review.draft_findings_reviewed,true);
 assert.equal(r.review.issuance_allowed,false);
 assert.equal(r.duvri_approved,false);
 assert.equal(r.issuance_allowed,false);
});
test('changing packet revision without renewed reviewer context blocks decisions',()=>{
 const p=packet();p.packet_revision_id='PACKET_REPLACED_002';
 assert.equal(run(p).state,'blocked');
});
test('mismatched packet checksum blocks reuse of old review',()=>{
 const p=packet();p.packet_sha256='b'.repeat(64);
 assert.deepEqual(run(p).blockers,['STALE_OR_UNVERIFIED_REVIEW_SNAPSHOT']);
});
test('partial or missing packet checksum is rejected',()=>{
 const p=packet();p.packet_sha256='aabb';
 assert.equal(run(p).state,'blocked');
});
test('backend verification of the current packet is mandatory',()=>{
 const c=ctx();c.packet_sha256_verified=false;
 assert.equal(run(packet(),scope(),[accepted],c).state,'blocked');
});
test('old Word revision invalidates an earlier HSE review',()=>{
 const c=ctx();c.current_document_revision_id='DOCX_NEW_REV_002';
 assert.equal(run(packet(),scope(),[accepted],c).state,'blocked');
});
test('old analysis revision cannot be reused',()=>{
 const c=ctx();c.current_analysis_revision_id='ANALYSIS_NEW_REV_002';
 assert.equal(run(packet(),scope(),[accepted],c).state,'blocked');
});
test('old extraction revision cannot be reused',()=>{
 const c=ctx();c.current_extraction_revision_id='EXTRACT_NEW_REV_002';
 assert.deepEqual(run(packet(),scope(),[accepted],c).blockers,['INCOMPLETE_OR_STALE_SOURCES']);
});
test('a partially scanned dossier cannot enter review',()=>{
 const s=scope();s.state='awaiting_extraction';s.withheld_file_ids=['PDF_SYNTH_REVIEW_001'];
 const r=run(packet(),s);
 assert.equal(r.state,'blocked');assert.equal(r.review,null);
});
test('manual-review-only documents cannot silently be skipped',()=>{
 const s=scope();s.manual_review_file_ids=['HEIC_UNREADABLE_001'];
 assert.equal(run(packet(),s).state,'blocked');
});
test('empty source authorization fails shut',()=>{
 const s=scope();s.allowed_file_ids=[];
 assert.equal(run(packet(),s).state,'blocked');
});
test('foreign case sources cannot support an accepted finding',()=>{
 const p=packet();p.findings[0].source_evidence[0].file_id='FILE_OTHER_CLIENT_001';
 const r=run(p);assert.deepEqual(r.blockers,['UNAUTHORIZED_FINDING_SOURCE']);
});
test('unconfirmed current-job sources cannot be accepted for the draft',()=>{
 const p=packet();p.findings[0].source_evidence[0].verification_status='extracted_unconfirmed';
 const r=run(p);assert.deepEqual(r.blockers,['ACCEPTED_FINDING_UNCONFIRMED']);
});
test('uncertain sources may be rejected with rationale, without authorizing the DUVRI',()=>{
 const p=packet();p.findings[0].source_evidence[0].verification_status='extracted_unconfirmed';
 const r=run(p,scope(),[{...accepted,action:'reject',note:'Fonte non confermata'}]);
 assert.equal(r.state,'draft_findings_reviewed');
 assert.equal(r.review.has_rejected_findings,true);
 assert.equal(r.issuance_allowed,false);
});
test('requesting changes blocks completed review and needs an explanation',()=>{
 const r=run(packet(),scope(),[{...accepted,action:'request_changes',note:'Ricontrollare misura'}]);
 assert.equal(r.state,'changes_requested');
 assert.equal(r.review.draft_findings_reviewed,false);
});
test('requesting changes with no justification is rejected',()=>{
 const r=run(packet(),scope(),[{...accepted,action:'request_changes'}]);
 assert.deepEqual(r.blockers,['REVIEW_DECISIONS_INVALID']);
});
test('no decisions produces a pending queue, not implicit acceptance',()=>{
 const r=run(packet(),scope(),[]);
 assert.equal(r.state,'awaiting_decisions');
 assert.deepEqual(r.review.pending,[{agent_id:'lavori_quota',finding_id:'F-001'}]);
});
test('duplicate review decisions are rejected',()=>{
 const r=run(packet(),scope(),[accepted,accepted]);
 assert.equal(r.state,'blocked');assert.equal(r.review,null);
});
test('duplicate findings in packet rejected before review',()=>{
 const p=packet();p.findings.push({...p.findings[0]});
 assert.deepEqual(run(p).blockers,['DUPLICATE_FINDING']);
});
test('historical DUVRI cannot impersonate the current checklist',()=>{
 const p=packet();p.findings[0].source_evidence[0]={source_type:'historical_2026_reference',
 file_id:sourceIds[0],verification_status:'historical_example_only'};
 assert.equal(run(p).state,'blocked');
});
test('historical precedent remains an example and cannot alone justify acceptance',()=>{
 const p=packet();
 p.findings[0].source_evidence=[{source_type:'historical_2026_reference',
  file_id:'HISTORY_SYNTH_001',verification_status:'historical_example_only'}];
 const c=ctx();c.allowed_historical_reference_ids=['HISTORY_SYNTH_001'];
 const r=run(p,scope(),[accepted],c);
 assert.deepEqual(r.blockers,['ACCEPTED_FINDING_UNCONFIRMED']);
});
test('approved historical reference may supplement confirmed current evidence',()=>{
 const p=packet();
 p.findings[0].source_evidence.push({source_type:'historical_2026_reference',
  file_id:'HISTORY_SYNTH_001',verification_status:'historical_example_only'});
 const c=ctx();c.allowed_historical_reference_ids=['HISTORY_SYNTH_001'];
 assert.equal(run(p,scope(),[accepted],c).state,'draft_findings_reviewed');
});
test('historical precedent with verified rather than example-only status is blocked',()=>{
 const p=packet();
 p.findings[0].source_evidence.push({source_type:'historical_2026_reference',
  file_id:'HISTORY_SYNTH_001',verification_status:'confirmed'});
 const c=ctx();c.allowed_historical_reference_ids=['HISTORY_SYNTH_001'];
 assert.deepEqual(run(p,scope(),[accepted],c).blockers,['HISTORICAL_SOURCE_MISLABELED']);
});
test('an internal rule requires separate server allowlist',()=>{
 const p=packet();p.findings[0].source_evidence.push({
  source_type:'approved_internal_rule',file_id:'RULE_SYNTH_001',
  verification_status:'confirmed'});
 assert.deepEqual(run(p).blockers,['UNAUTHORIZED_FINDING_SOURCE']);
 const c=ctx();c.allowed_internal_rule_ids=['RULE_SYNTH_001'];
 assert.equal(run(p,scope(),[accepted],c).state,'draft_findings_reviewed');
});
test('overlapping IDs across current, historical and internal authorizations are forbidden',()=>{
 const c=ctx();c.allowed_historical_reference_ids=[sourceIds[0]];
 assert.deepEqual(run(packet(),scope(),[accepted],c).blockers,['OVERLAPPING_SOURCE_AUTHORITIES']);
});
test('untrusted or malformed allowlists fail closed',()=>{
 const c=ctx();c.allowed_internal_rule_ids='RULE_SYNTH_001';
 assert.deepEqual(run(packet(),scope(),[accepted],c).blockers,['INVALID_SOURCE_AUTHORITIES']);
});
test('reviewer must be authenticated, authorized and a technician or admin',()=>{
 for (const patch of [{authenticated:false},{can_review:false},{role:'cliente'},{role:'direzione'}]){
  const c={...ctx(),...patch};
  assert.equal(run(packet(),scope(),[accepted],c).state,'blocked');
 }
});
test('incomplete findings, pending agents and conflicts cannot enter final review',()=>{
 const p=packet();p.pending_agents=['elettrico'];
 assert.equal(run(p).state,'blocked');
 p.pending_agents=[];p.conflicts=[{description:'Contraddizione sintetica'}];
 assert.equal(run(p).state,'blocked');
});
test('no findings require a separate professional determination',()=>{
 const p=packet();p.findings=[];
 assert.equal(run(p,scope(),[]).state,'blocked');
});
test('existing five-character finding IDs remain supported',()=>{
 assert.equal(run().review.decisions[0].finding_id,'F-001');
});
test('results never mutate trusted snapshots, even when caller modifies result',()=>{
 const p=packet(),s=scope(),c=ctx(),d=[accepted];
 const before=[clone(p),clone(s),clone(c),clone(d)];
 const result=run(p,s,d,c);
 result.review.decisions[0].action='reject';
 assert.deepEqual([p,s,c,d],before);
});
test('missing or incomplete context cannot be interpreted as approved review',()=>{
 assert.equal(assessReviewSession().state,'blocked');
 assert.equal(run(packet(),null).issuance_allowed,false);
 assert.equal(run(packet(),scope(),[accepted],{}).state,'blocked');
});
