'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {assessTechnicalPreflight}=require('../js/duvri-readiness-bridge.js');
const {validateMapping}=require('../js/duvri-yellow-field-map.js');
const {prepareReviewDecisions}=require('../js/duvri-hse-review.js');
const {OFFICIAL_SHA256_PREFIX}=require('../js/duvri-document-readiness.js');

const jobId='FASCICOLO_SYNTH_BRIDGE_001';
const analysisRevisionId='ANALYSIS_SYNTH_BRIDGE_001';
const documentRevisionId='DOCUMENT_SYNTH_BRIDGE_001';
const version='DUVRI_BASE_GENERALE_2026';
const sha=OFFICIAL_SHA256_PREFIX+'0'.repeat(64-OFFICIAL_SHA256_PREFIX.length);
const clone=x=>structuredClone(x);
const mapRows=()=>Array.from({length:22},(_,i)=>({
 segment_id:i+1, mode:'field',field_key:'job.field_'+(i+1),
 reviewer_id:'REVIEWER_SYNTH_001',review_reference:'MAPPING_SYNTH_001',
 reviewed:true
}));
function decisions(action='accept_for_draft') {
 const packet={
  schema_version:'colligo-duvri-review-packet/1.0',
  job_id:jobId, analysis_revision_id:analysisRevisionId,state:'needs_review',
  issuance_allowed:false,human_review_required:true,
  findings:[{agent_id:'lavori_quota',finding_id:'F_SYNTH_001',
    validation_status:'to_be_reviewed'}],
  pending_agents:[],blocking_reasons:[],conflicts:[],
  screening_required:[],missing_information:[]
 };
 const decision={agent_id:'lavori_quota',finding_id:'F_SYNTH_001',action,
  ...(action==='reject'?{note:'Non è presente la compresenza, dato sintetico'}:{})};
 return prepareReviewDecisions({packet,decisions:[decision],
  reviewerContext:{job_id:jobId,analysis_revision_id:analysisRevisionId,
    document_revision_id:documentRevisionId,reviewer_id:'REVIEWER_SYNTH_001',
    authenticated:true,can_review:true,role:'tecnico'}});
}
function complete(){
 return {
  jobId,analysisRevisionId,documentRevisionId,
  template:{
    approved:true,manifest_verified:true,approval_record_id:'APPROVAL_SYNTH_001',
    template_version:version,source_sha256:sha,expected_sha256:sha
  },
  mapping:validateMapping({templateVersion:version,segments:mapRows()}),
  population:{
    document_revision_id:documentRevisionId,template_version:version,
    actual_populated:22,actual_not_applicable:0,human_verified:22,
    unresolved:0,mapping_approved_by_backend:true
  },
  editorial:{expected:27,reviewed:27,unresolved:0,content_rules_verified:true},
  risk:{
    method_approved:true,method_approval_id:'RISK_APPROVAL_SYNTH_001',
    method_version:'RISK_METHOD_SYNTH_001',tables_reviewed:true,
    rows_source_mapped:true,indices_validated_under_approved_method:true
  },
  docx:{
    document_revision_id:documentRevisionId,
    qa_document_revision_id:documentRevisionId,
    output_sha256_verified:true,source_unchanged:true,
    generated_with_populated_fields:true,structural_qa_passed:true,
    visual_qa_after_population_passed:true,
    editorial_comments_removed_or_approved:true,
    signature_fields_identified:true,signatures_verified_blank:true,
    fixed_content_unchanged:true,sections_tables_headers_verified:true
  },
  review:decisions(),hseOpenBlockers:0,sourcesRechecked:true,
  rejectedFindingsResolved:false
 };
}
const reasons=r=>r.blockers.map(x=>x.code);

test('synthetic consistent mapping, DOCX and HSE decisions only permit final technical review',()=>{
 const r=assessTechnicalPreflight(complete());
 assert.equal(r.state,'eligible_for_final_technical_review');
 assert.equal(r.technical_review_eligible,true);
 assert.equal(r.duvri_approved,false);
 assert.equal(r.issuance_allowed,false);
});
test('empty parameters never pass',()=>{
 const r=assessTechnicalPreflight();
 assert.equal(r.state,'blocked');
 assert.deepEqual(reasons(r),['REVISION']);
});
test('mapping must come from validated 22-segment manifest and match template',()=>{
 const x=complete();x.mapping.state='needs_review';
 assert.deepEqual(reasons(assessTechnicalPreflight(x)),['MAPPING']);
 x.mapping=complete().mapping;x.mapping.template_version='ANOTHER_TEMPLATE';
 assert.deepEqual(reasons(assessTechnicalPreflight(x)),['MAPPING']);
});
test('not-applicable field requires matching real DOCX counts',()=>{
 const x=complete();
 const rows=mapRows();
 rows[1]={segment_id:2,mode:'not_applicable',reason:'Sede priva del campo (sintetico)',
  reviewer_id:'REVIEWER_SYNTH_001',review_reference:'MAPPING_SYNTH_002',reviewed:true};
 x.mapping=validateMapping({templateVersion:version,segments:rows});
 assert.equal(x.mapping.state,'mapping_ready');
 assert.deepEqual(reasons(assessTechnicalPreflight(x)),['POPULATION']);
 x.population.actual_populated=21;
 x.population.actual_not_applicable=1;
 x.population.not_applicable_approved=true;
 assert.equal(assessTechnicalPreflight(x).state,'eligible_for_final_technical_review');
});
test('population report for an earlier document revision is rejected',()=>{
 const x=complete();x.population.document_revision_id='DOCUMENT_OLD_REVISION';
 assert.deepEqual(reasons(assessTechnicalPreflight(x)),['POPULATION']);
});
test('word layout QA must belong to this specific document revision',()=>{
 const x=complete();x.docx.qa_document_revision_id='DOCUMENT_OLD_REVISION';
 assert.deepEqual(reasons(assessTechnicalPreflight(x)),['DOCX_REVISION']);
});
test('false output checksum verification always blocks',()=>{
 const x=complete();x.docx.output_sha256_verified=false;
 assert.deepEqual(reasons(assessTechnicalPreflight(x)),['DOCX_REVISION']);
});
test('old HSE analysis revision cannot approve a newer analysis',()=>{
 const x=complete();x.analysisRevisionId='ANALYSIS_CHANGED_AFTER_REVIEW';
 assert.deepEqual(reasons(assessTechnicalPreflight(x)),['REVIEW_REVISION']);
});
test('old HSE document revision cannot approve regenerated DOCX',()=>{
 const x=complete();x.review.document_revision_id='DOCUMENT_OLD_REVISION';
 assert.deepEqual(reasons(assessTechnicalPreflight(x)),['REVIEW_REVISION']);
});
test('unreviewed HSE finding is blocked even when Word is perfect',()=>{
 const x=complete();x.review.state='changes_requested';
 assert.deepEqual(reasons(assessTechnicalPreflight(x)),['REVIEW_REVISION']);
});
test('rejected finding requires distinct technical resolution before final review',()=>{
 const x=complete();x.review=decisions('reject');
 assert.equal(x.review.state,'draft_findings_reviewed');
 assert.equal(x.review.has_rejected_findings,true);
 assert.deepEqual(reasons(assessTechnicalPreflight(x)),['REJECTED_FINDINGS']);
 x.rejectedFindingsResolved=true;
 assert.equal(assessTechnicalPreflight(x).state,'eligible_for_final_technical_review');
});
test('cannot silently bypass unresolved HSE blockers',()=>{
 const x=complete();x.hseOpenBlockers=1;
 assert.deepEqual(reasons(assessTechnicalPreflight(x)),['EVIDENCE_QA']);
 x.hseOpenBlockers=0;x.sourcesRechecked=false;
 assert.deepEqual(reasons(assessTechnicalPreflight(x)),['EVIDENCE_QA']);
});
test('D1 unapproved methodology remains blocking',()=>{
 const x=complete();x.risk.method_approved=false;
 assert.ok(reasons(assessTechnicalPreflight(x)).includes('RISK_METHOD'));
});
test('perfect structural Word without post-population visual test still blocks',()=>{
 const x=complete();x.docx.visual_qa_after_population_passed=false;
 assert.ok(reasons(assessTechnicalPreflight(x)).includes('DOCX_QUALITY'));
});
test('unreviewed editorial comments remain blocking',()=>{
 const x=complete();x.editorial.unresolved=27;x.editorial.reviewed=0;
 assert.ok(reasons(assessTechnicalPreflight(x)).includes('EDITORIAL'));
});
test('mapping approved on wrong original checksum does not bypass official manifest',()=>{
 const x=complete();x.template.expected_sha256=OFFICIAL_SHA256_PREFIX+'1'.repeat(56);
 assert.ok(reasons(assessTechnicalPreflight(x)).includes('TEMPLATE'));
});
test('malformed review with no actual decisions cannot bypass gate',()=>{
 const x=complete();x.review.decisions=[];
 assert.deepEqual(reasons(assessTechnicalPreflight(x)),['REVIEW_REVISION']);
});
test('does not mutate any of the trusted input objects',()=>{
 const x=complete(),copy=clone(x);
 const r=assessTechnicalPreflight(x);
 r.blockers.push({code:'FAKE',description:'No'});
 assert.deepEqual(x,copy);
});
