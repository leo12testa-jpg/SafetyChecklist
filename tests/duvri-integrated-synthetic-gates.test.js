'use strict';
/*
 * INTEGRAZIONE SINTETICA — non testa il backend privato, non genera DUVRI.
 * Le attestazioni con backend_verified e i digest sono soltanto fittizi.
 * Nessun IO documentale, chiamata AI, costo, email o autorizzazione.
 */
const test=require('node:test');
const assert=require('node:assert/strict');
const {SIGNAL_TO_AGENT}=require('../js/duvri-agent-contract.js');
const {buildHseEvidenceScope}=require('../js/duvri-hse-evidence-scope.js');
const {aggregateEvidenceGated}=require('../js/duvri-hse-pipeline.js');
const {verify}=require('../js/duvri-hse-fact-match.js');
const {buildClarificationRegister}=require('../js/duvri-clarification-register.js');
const {prepareRouting}=require('../js/duvri-clarification-triage.js');
const {assessReviewSession}=require('../js/duvri-hse-review-session.js');
const {assess:aiPreflight}=require('../js/duvri-ai-execution-preflight.js');
const {normalize:wordQa}=require('../js/duvri-word-qa-handoff.js');

const job='CASE_SYNTH_SYSTEM_001',analysis='ANALYSIS_SYNTH_SYSTEM_001';
const extraction='EXTRACT_SYNTH_SYSTEM_001',packetRev='PACKET_SYNTH_SYSTEM_001';
const wordRevision='DOCX_SYNTH_SYSTEM_001',regRev='REGISTER_SYNTH_SYSTEM_001';
const checklist='CHECKLIST_SYNTH_SYSTEM_001',pdf='PDF_SYNTH_SYSTEM_001';
const packetDigest='a'.repeat(64),registerDigest='b'.repeat(64);
const quotation='Passaggio sintetico sotto lavorazione in quota';
const locator='page:1:line:7';
const ev=()=>({source_type:'current_job_checklist',file_id:checklist,
  locator,excerpt_or_fact:quotation,verification_status:'confirmed'});
const sourceFacts=()=>[{
  job_id:job,analysis_revision_id:analysis,extraction_revision_id:extraction,
  source_type:'current_job_checklist',file_id:checklist,locator,
  text:quotation,verification_status:'confirmed',backend_verified:true
}];
const files=()=>[
 {file_id:checklist,job_id:job,role:'client_checklist',
  mime_type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  size_bytes:1200,sha256:'c'.repeat(64),parse_status:'parsed'},
 {file_id:pdf,job_id:job,role:'supporting_document',
  mime_type:'application/pdf',size_bytes:2200,
  sha256:'d'.repeat(64),parse_status:'parsed'}
];
const extractAttests=f=>f.map(x=>({
 schema_version:'colligo-duvri-extraction-attestation/1.0',
 job_id:job,analysis_revision_id:analysis,extraction_revision_id:extraction,
 file_id:x.file_id,source_sha256:x.sha256,evidence_kind:'extracted_text',
 source_locator_verified:true,backend_verified:true
}));
function scope(f=files(),e=extractAttests(f)){
 return buildHseEvidenceScope({
  jobId:job,analysisRevisionId:analysis,extractionRevisionId:extraction,
  files:f,extractions:e
 });
}
const screening=(mode='ready')=>Object.keys(SIGNAL_TO_AGENT).map(signal=>({
 signal,answer:mode==='unknown'&&signal==='lavori_in_quota'?'unknown':
  signal==='lavori_in_quota'?'yes':'no',
 evidence: mode==='unknown'&&signal==='lavori_in_quota'?[]:[{
  source_type:'current_job_checklist',file_id:checklist,
  locator:'page:1:line:2',verification_status:'confirmed'
 }]
}));
const finding=()=>({
 finding_id:'F_SYNTH_SYSTEM_001',category:'interferenza',
 work_phase:'Manutenzione sintetica',scenario:'Lavori in quota sintetici',
 interference_explanation:'Contemporaneità fittizia con accesso pedonale',
 exposed_parties:['addetti sintetici'],
 source_evidence:[ev()],
 proposed_measures:[{
  proposal:'Sottoporre a verifica tecnica la separazione dei percorsi',
  implementation_owner_status:'to_assign',needs_human_validation:true
 }],
 validation_status:'to_be_reviewed'
});
const agent=(name,findings=[])=>({
 schema_version:'colligo-duvri-agent-analysis/1.0',
 job_id:job,agent_id:name,status:'completed',findings,
 missing_information:[],conflicts:[],requires_human_review:true
});
const agents=()=>[
 agent('documentale'),agent('normativa'),agent('coordinamento'),
 agent('lavori_quota',[finding()])
];
const packet=(s=scope(),mode='ready',agentItems=agents())=>aggregateEvidenceGated({
 jobId:job,analysisRevisionId:analysis,screeningAnswers:screening(mode),
 allowedFileIds:s.allowed_file_ids,agentResults:agentItems
});
function checkCitations(p,s=scope(),facts=sourceFacts()){
 return verify({
  packet:p,sourceScope:s,sourceFacts:facts,
  expectedJobId:job,expectedAnalysisRevisionId:analysis,
  expectedExtractionRevisionId:extraction
 });
}
const register=(p,s=scope())=>buildClarificationRegister({
 packet:p,sourceScope:s,expectedJobId:job,
 expectedAnalysisRevisionId:analysis,expectedExtractionRevisionId:extraction
});
const reviewContext=()=>({
 job_id:job,analysis_revision_id:analysis,
 current_analysis_revision_id:analysis,
 current_packet_revision_id:packetRev,current_packet_sha256:packetDigest,
 packet_sha256_verified:true,
 document_revision_id:wordRevision,current_document_revision_id:wordRevision,
 current_extraction_revision_id:extraction,
 reviewer_id:'TECHNICIAN_SYNTH_001',role:'tecnico',
 authenticated:true,can_review:true,
 allowed_historical_reference_ids:[],allowed_internal_rule_ids:[]
});
function triage(r,decisions=[]){
 return prepareRouting({
  register:r,decisions,reviewerContext:{
   job_id:job,analysis_revision_id:analysis,extraction_revision_id:extraction,
   register_revision_id:regRev,current_register_revision_id:regRev,
   register_sha256:registerDigest,current_register_sha256:registerDigest,
   register_sha256_verified:true,
   reviewer_id:'TECHNICIAN_SYNTH_001',role:'tecnico',
   authenticated:true,can_triage:true
  },
  expectedJobId:job,expectedAnalysisRevisionId:analysis,
  expectedExtractionRevisionId:extraction,expectedRegisterRevisionId:regRev
 });
}
const stamped=p=>({...p,packet_revision_id:packetRev,packet_sha256:packetDigest});
const decision=()=>[{agent_id:'lavori_quota',finding_id:'F_SYNTH_SYSTEM_001',
 action:'accept_for_draft'}];

test('synthetic end-to-end metadata chain reaches HSE review, never issuance',()=>{
 const s=scope();assert.equal(s.state,'ready_for_hse_screening');
 const p=packet(s);assert.equal(p.state,'needs_review');
 const match=checkCitations(p,s);
 assert.equal(match.state,'exact_citations_matched_for_review');
 const r=register(p,s);assert.equal(r.state,'no_open_requests');
 const route=triage(r);
 assert.equal(route.state,'no_open_requests');
 const reviewed=assessReviewSession({
  packet:stamped(p),sourceScope:s,decisions:decision(),
  reviewerContext:reviewContext()
 });
 assert.equal(reviewed.state,'draft_findings_reviewed');
 assert.equal(reviewed.review.draft_findings_reviewed,true);
 assert.equal(reviewed.issuance_allowed,false);
 assert.equal(route.issuance_allowed,false);
 assert.equal(match.issuance_allowed,false);
 const word=wordQa();assert.equal(word.state,'blocked');
 assert.equal(word.issuance_allowed,false);
 const preflight=aiPreflight({jobId:job,analysisRevisionId:analysis,
  extractionRevisionId:extraction,sourceScope:s});
 assert.equal(preflight.state,'blocked');
 assert.equal(preflight.external_data_transfer_allowed,false);
 assert.equal(preflight.provider_dispatch_allowed,false);
});
test('unconfirmed screening produces technician-only clarifications and prevents HSE review',()=>{
 const s=scope(),p=packet(s,'unknown');
 assert.equal(p.state,'awaiting_input');
 const r=register(p,s);
 assert.equal(r.state,'needs_technical_triage');
 assert.ok(r.items.some(x=>x.kind==='screening_confirmation'));
 const drafted=triage(r,r.items.map(x=>({
  request_id:x.request_id,route:'ask_client'
 })));
 assert.equal(drafted.state,'routing_reviewed');
 assert.equal(drafted.client_dispatch_allowed,false);
 assert.equal(drafted.clarifications_resolved,false);
 assert.equal(drafted.issuance_allowed,false);
 const decisionResult=assessReviewSession({
  packet:stamped(p),sourceScope:s,decisions:[],reviewerContext:reviewContext()
 });
 assert.equal(decisionResult.state,'blocked');
});
test('a changed PDF hash blocks dossier extraction and all subsequent HSE processing',()=>{
 const f=files(),e=extractAttests(f);f[1].sha256='e'.repeat(64);
 const s=scope(f,e);
 assert.equal(s.state,'blocked');
 assert.deepEqual(s.allowed_file_ids,[]);
 const p=packet(s);
 assert.equal(p.state,'blocked');
 const match=checkCitations(p,s);
 assert.equal(match.state,'blocked');
 assert.equal(match.issuance_allowed,false);
});
test('invented specialist evidence is rejected by the source matcher',()=>{
 const s=scope(),p=packet(s);
 assert.equal(p.state,'needs_review');
 p.findings[0].source_evidence[0].excerpt_or_fact='TESTO_NON_PRESENTE';
 const match=checkCitations(p,s);
 assert.equal(match.state,'blocked');
 assert.deepEqual(match.blockers,['CITATION_TEXT_NOT_IN_TRUSTED_EXTRACTION']);
});
test('changed OCR status cannot impersonate confirmed source',()=>{
 const s=scope(),p=packet(s);
 const facts=sourceFacts();
 facts[0].verification_status='extracted_unconfirmed';
 const match=checkCitations(p,s,facts);
 assert.equal(match.state,'blocked');
 assert.equal(match.issuance_allowed,false);
});
test('old packet digest cannot be used for a technician review',()=>{
 const s=scope(),p=stamped(packet(s)),ctx=reviewContext();
 ctx.current_packet_sha256='f'.repeat(64);
 const result=assessReviewSession({
  packet:p,sourceScope:s,decisions:decision(),reviewerContext:ctx
 });
 assert.equal(result.state,'blocked');
 assert.deepEqual(result.blockers,['STALE_OR_UNVERIFIED_REVIEW_SNAPSHOT']);
});
test('missing AI provider approval never results in transfer even after review',()=>{
 const s=scope(),p=stamped(packet(s));
 const reviewer=assessReviewSession({
  packet:p,sourceScope:s,decisions:decision(),reviewerContext:reviewContext()
 });
 assert.equal(reviewer.state,'draft_findings_reviewed');
 const preflight=aiPreflight({jobId:job,analysisRevisionId:analysis,
  extractionRevisionId:extraction,sourceScope:s,
  screeningSignals:Object.fromEntries(Object.keys(SIGNAL_TO_AGENT).map(x=>
   [x,x==='lavori_in_quota'?'yes':'no'])),
  selectedAgentIds:['documentale','normativa','coordinamento','lavori_quota']
 });
 assert.equal(preflight.state,'blocked');
 assert.equal(preflight.external_data_transfer_allowed,false);
 assert.equal(preflight.provider_dispatch_allowed,false);
 assert.equal(reviewer.issuance_allowed,false);
});
