'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {buildHseEvidenceScope}=require('../js/duvri-hse-evidence-scope.js');
const {aggregateEvidenceGated}=require('../js/duvri-hse-pipeline.js');
const {prepareReviewDecisions}=require('../js/duvri-hse-review.js');
const {SIGNAL_TO_AGENT}=require('../js/duvri-agent-contract.js');

const jobId='FASCICOLO_SYNTH_CHAIN_001';
const analysisRevisionId='ANALYSIS_SYNTH_CHAIN_001';
const extractionRevisionId='EXTRACT_SYNTH_CHAIN_001';
const docRevisionId='DOCUMENT_SYNTH_CHAIN_001';
const files=()=>[
 {file_id:'CHECKLIST_SYNTH_CHAIN_001',job_id:jobId,role:'client_checklist',
  mime_type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  size_bytes:1000,sha256:'a'.repeat(64),parse_status:'parsed'},
 {file_id:'PDF_SYNTH_CHAIN_001',job_id:jobId,role:'supporting_document',
  mime_type:'application/pdf',size_bytes:1500,sha256:'b'.repeat(64),parse_status:'parsed'}
];
const attest=files=>files.map(f=>({
 schema_version:'colligo-duvri-extraction-attestation/1.0',
 job_id:jobId,analysis_revision_id:analysisRevisionId,
 extraction_revision_id:extractionRevisionId,file_id:f.file_id,
 source_sha256:f.sha256,evidence_kind:'extracted_text',
 source_locator_verified:true,backend_verified:true
}));
const scope=(f=files(),e=attest(f))=>buildHseEvidenceScope({
 jobId,analysisRevisionId,extractionRevisionId,files:f,extractions:e
});
const screening=()=>Object.keys(SIGNAL_TO_AGENT).map(signal=>({
 signal,answer:signal==='lavori_in_quota'?'yes':'no',
 evidence:[{
  source_type:'current_job_checklist',file_id:'CHECKLIST_SYNTH_CHAIN_001',
  locator:'Risposta sintetica verificata',verification_status:'confirmed'
 }]
}));
const agent=(agent_id,findings=[])=>({
 schema_version:'colligo-duvri-agent-analysis/1.0',
 job_id,agent_id,status:'completed',findings,
 missing_information:[],conflicts:[],requires_human_review:true
});
const finding=()=>({
 finding_id:'F_SYNTH_CHAIN_001',category:'caduta_materiali',
 work_phase:'Manutenzione sintetica',
 scenario:'Possibile interferenza tra lavorazione in quota e passaggio',
 interference_explanation:'Transito sintetico sotto area lavori',
 exposed_parties:['personale committente'],
 source_evidence:[{
  source_type:'current_job_checklist',
  file_id:'CHECKLIST_SYNTH_CHAIN_001',
  locator:'Risposta sintetica verificata',
  excerpt_or_fact:'Lavorazione in quota sopra un percorso (fittizio)',
  verification_status:'confirmed'
 }],
 proposed_measures:[{
  proposal:'Valutare misure di segregazione del percorso',
  implementation_owner_status:'to_assign',needs_human_validation:true
 }],
 validation_status:'to_be_reviewed'
});
const agents=()=>[
 agent('documentale'),agent('normativa'),agent('coordinamento'),
 agent('lavori_quota',[finding()])
];
const reviewer={
 job_id:jobId,analysis_revision_id:analysisRevisionId,
 document_revision_id:docRevisionId,reviewer_id:'REVIEWER_SYNTH_CHAIN_001',
 authenticated:true,can_review:true,role:'tecnico'
};
const decision={agent_id:'lavori_quota',finding_id:'F_SYNTH_CHAIN_001',
 action:'accept_for_draft'};
test('case-scoped extraction -> screening -> specialists -> human review, never issuance',()=>{
 const x=scope();
 assert.equal(x.state,'ready_for_hse_screening');
 const packet=aggregateEvidenceGated({
  jobId,analysisRevisionId,screeningAnswers:screening(),
  allowedFileIds:x.allowed_file_ids,agentResults:agents()
 });
 assert.equal(packet.state,'needs_review');
 assert.equal(packet.findings.length,1);
 const review=prepareReviewDecisions({packet,decisions:[decision],reviewerContext:reviewer});
 assert.equal(review.state,'draft_findings_reviewed');
 assert.equal(review.issuance_allowed,false);
 assert.equal(review.duvri_approved,false);
});
test('unknown source cannot be used to pass the HSE pipeline',()=>{
 const x=scope(),incorrect=agents();
 incorrect[3].findings[0].source_evidence[0].file_id='OTHER_CLIENT_FILE_001';
 const packet=aggregateEvidenceGated({
  jobId,analysisRevisionId,screeningAnswers:screening(),
  allowedFileIds:x.allowed_file_ids,agentResults:incorrect
 });
 assert.equal(packet.state,'blocked');
 assert.equal(packet.findings.length,0);
});
test('a changed file invalidates the attestation and stops review',()=>{
 const f=files(),e=attest(f);
 f[1].sha256='c'.repeat(64);
 const x=scope(f,e);
 assert.equal(x.state,'blocked');
 assert.deepEqual(x.allowed_file_ids,[]);
});
test('incomplete extraction is not ready for screening or review',()=>{
 const f=files();f[1].parse_status='pending';
 const x=scope(f,[attest(f)[0]]);
 assert.equal(x.state,'awaiting_extraction');
 assert.equal(x.allowed_file_ids.includes('PDF_SYNTH_CHAIN_001'),false);
 assert.equal(x.issuance_allowed,false);
});
test('stale reviewer decision is rejected after regeneration of the document',()=>{
 const x=scope(),packet=aggregateEvidenceGated({
  jobId,analysisRevisionId,screeningAnswers:screening(),
  allowedFileIds:x.allowed_file_ids,agentResults:agents()
 });
 const result=prepareReviewDecisions({packet,decisions:[decision],
  reviewerContext:{...reviewer,analysis_revision_id:'ANALYSIS_OLD_CHAIN_001'}
 });
 assert.equal(result.state,'blocked');
});
