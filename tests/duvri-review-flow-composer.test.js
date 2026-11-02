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
 signal,answer:mode==='unknown'&&signal==='impianti_elettrici'?'unknown':
  signal==='lavori_in_quota'?'yes':'no',
 evidence: mode==='unknown'&&signal==='impianti_elettrici'?[]:[{
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

const {assemble}=require('../js/duvri-review-flow-composer.js');
const packetIdentity=()=>({packet_revision_id:packetRev,
 packet_sha256:packetDigest,backend_verified:true});
const flowInput=()=>({
 jobId:job,analysisRevisionId:analysis,extractionRevisionId:extraction,
 files:files(),extractions:extractAttests(files()),
 screeningAnswers:screening(),agentResults:agents(),
 sourceFacts:sourceFacts()
});
const runFlow=patch=>assemble({...flowInput(),...patch});
const noIssue=x=>{
 assert.equal(x.issuance_allowed,false);
 assert.equal(x.document_draft_allowed,false);
 assert.equal(x.provider_dispatch_allowed,false);
 assert.equal(x.client_dispatch_allowed,false);
 assert.equal(x.duvri_approved,false);
};
test('one runtime flow composes all HSE stages but never issues a real DUVRI',()=>{
 const result=runFlow({
  reviewDecisions:decision(),reviewerContext:reviewContext(),
  packetIdentity:packetIdentity()
 });
 assert.equal(result.schema_version,'colligo-duvri-review-flow/1.0');
 assert.equal(result.state,'reviewed_for_synthetic_draft');
 assert.equal(result.stages.extraction,'ready_for_hse_screening');
 assert.equal(result.stages.hse_analysis,'needs_review');
 assert.equal(result.stages.citation_match,'exact_citations_matched_for_review');
 assert.equal(result.stages.clarification_register,'no_open_requests');
 assert.equal(result.stages.technical_review,'draft_findings_reviewed');
 assert.equal(result.finding_count,1);
 assert.equal(result.question_count,0);
 assert.deepEqual(result.blocker_codes,['D1_D2_WORD_QA_REQUIRED']);
 noIssue(result);
});
test('ready HSE evidence but missing reviewer must wait, not approve silently',()=>{
 const result=runFlow();
 assert.equal(result.state,'awaiting_technician_review');
 assert.equal(result.next_action,'technician_review_required');
 assert.deepEqual(result.blocker_codes,['TECHNICIAN_REVIEW_REQUIRED']);
 noIssue(result);
});
test('changed PDF after extraction prevents all subsequent stages',()=>{
 const input=flowInput();input.files[1].sha256='e'.repeat(64);
 const result=assemble(input);
 assert.equal(result.state,'awaiting_documents');
 assert.equal(result.stages.hse_analysis,'not_started');
 assert.deepEqual(result.blocker_codes,['DOCUMENT_SCOPE_NOT_READY']);
 noIssue(result);
});
test('invented source text refuses HSE claims before any reviewer decision',()=>{
 const fake=agents();fake[3].findings[0].source_evidence[0].excerpt_or_fact='FABRICATED_SAFETY_FACT';
 const result=runFlow({agentResults:fake});
 assert.equal(result.state,'blocked');
 assert.deepEqual(result.blocker_codes,['UNTRUSTED_HSE_CITATIONS']);
 assert.equal(JSON.stringify(result).includes('FABRICATED_SAFETY_FACT'),false);
 noIssue(result);
});
test('screening uncertainty remains human clarification, never Word-ready',()=>{
 const result=runFlow({screeningAnswers:screening('unknown')});
 assert.equal(result.state,'awaiting_clarifications');
 assert.equal(result.stages.clarification_register,'needs_technical_triage');
 assert.ok(result.question_count>0);
 noIssue(result);
});
test('tampered digest blocks valid-looking technician approval',()=>{
 const ctx=reviewContext();ctx.current_packet_sha256='e'.repeat(64);
 const result=runFlow({reviewDecisions:decision(),reviewerContext:ctx,
  packetIdentity:packetIdentity()});
 assert.equal(result.state,'blocked');
 assert.deepEqual(result.blocker_codes,['STALE_OR_INVALID_HSE_REVIEW']);
 noIssue(result);
});
test('review without backend packet revision/digest cannot advance',()=>{
 const result=runFlow({reviewDecisions:decision(),reviewerContext:reviewContext()});
 assert.equal(result.state,'blocked');
 assert.deepEqual(result.blocker_codes,['PACKET_DIGEST_ATTESTATION_REQUIRED']);
 noIssue(result);
});
test('missing specialists never produces a successful HSE review',()=>{
 const result=runFlow({agentResults:[],reviewDecisions:decision(),
 reviewerContext:reviewContext(),packetIdentity:packetIdentity()});
 assert.notEqual(result.state,'reviewed_for_synthetic_draft');
 assert.notEqual(result.stages.technical_review,'draft_findings_reviewed');
 noIssue(result);
});
test('router context without reviewed decisions must fail shut',()=>{
 const r=register(packet(),scope());
 const result=runFlow({routerContext:{
  job_id:job,analysis_revision_id:analysis,extraction_revision_id:extraction,
  register_revision_id:regRev,current_register_revision_id:regRev,
  register_sha256:registerDigest,current_register_sha256:registerDigest,
  register_sha256_verified:true,reviewer_id:'TECHNICIAN_SYNTH_001',
  role:'tecnico',authenticated:true,can_triage:true
 }});
 assert.equal(r.state,'no_open_requests');
 assert.equal(result.state,'blocked');
 assert.deepEqual(result.blocker_codes,['CLARIFICATION_ROUTING_BLOCKED']);
 noIssue(result);
});
test('invalid context or malformed request fails without leaking source text',()=>{
 const result=assemble();
 assert.equal(result.state,'blocked');
 assert.deepEqual(result.blocker_codes,['INVALID_FLOW_INPUT']);
 noIssue(result);
 const another=runFlow({files:null});
 assert.equal(another.state,'blocked');
 noIssue(another);
});
test('extra client flags never trigger AI requests, emails or Word generation',()=>{
 const params=flowInput();params.auto_issue=true;params.providerDispatchAllowed=true;
 const result=assemble(params);
 noIssue(result);
 assert.equal(result.state,'awaiting_technician_review');
});
