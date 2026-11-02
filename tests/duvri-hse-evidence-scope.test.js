'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {buildHseEvidenceScope}=require('../js/duvri-hse-evidence-scope.js');
const {normalizeSpecialtyScreening}=require('../js/duvri-hse-screening.js');
const {validateAgentResult}=require('../js/duvri-agent-contract.js');
const jobId='FASCICOLO_SYNTH_001';
const revision='ANALYSIS_SYNTH_001';
const extractionRevision='EXTRACTION_SYNTH_001';
const DOCX='application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const copy=x=>structuredClone(x);
const files=()=>[
 {file_id:'CHECKLIST_SYNTH_001',job_id:jobId,role:'client_checklist',
  mime_type:DOCX,size_bytes:1000,sha256:'a'.repeat(64),parse_status:'parsed'},
 {file_id:'PDF_SYNTH_001',job_id:jobId,role:'supporting_document',
  mime_type:'application/pdf',size_bytes:2000,sha256:'b'.repeat(64),parse_status:'parsed'},
 {file_id:'PHOTO_SYNTH_001',job_id:jobId,role:'photograph',
  mime_type:'image/jpeg',size_bytes:3000,sha256:'c'.repeat(64),parse_status:'parsed'}
];
const attest=(file)=>({
 schema_version:'colligo-duvri-extraction-attestation/1.0',
 job_id:jobId,analysis_revision_id:revision,
 extraction_revision_id:extractionRevision,
 file_id:file.file_id,source_sha256:file.sha256,
 evidence_kind:file.mime_type.startsWith('image/')?'human_verified_image':'extracted_text',
 source_locator_verified:true,backend_verified:true
});
const run=(f=files(),e=f.map(attest),other={})=>
 buildHseEvidenceScope({jobId,analysisRevisionId:revision,extractionRevisionId:extractionRevision,files:f,extractions:e,...other});
test('three verified sources ready only for screening, never approve evidence or DUVRI',()=>{
 const x=run();
 assert.equal(x.state,'ready_for_hse_screening');
 assert.deepEqual(x.allowed_file_ids,files().map(f=>f.file_id));
 assert.equal(x.checklist_ready,true);
 assert.equal(x.evidence_verified,false);
 assert.equal(x.issuance_allowed,false);
 assert.equal(x.human_review_required,true);
});
test('Word-only dossier cannot silently stand for verified job attachments',()=>{
 const f=files().slice(0,1);
 const x=run(f,f.map(attest));
 assert.equal(x.state,'awaiting_extraction');
 assert.ok(x.reasons.some(s=>s.includes('Nessun allegato')));
});
test('pending PDF is withheld even when checklist is already verified',()=>{
 const f=files();f[1].parse_status='pending';
 const x=run(f,[attest(f[0]),attest(f[2])]);
 assert.equal(x.state,'awaiting_extraction');
 assert.deepEqual(x.withheld_file_ids,['PDF_SYNTH_001']);
 assert.equal(x.allowed_file_ids.includes('PDF_SYNTH_001'),false);
});
test('unreadable PDF is withheld and appears in manual-review list',()=>{
 const f=files();f[1].parse_status='unreadable';
 const x=run(f,[attest(f[0]),attest(f[2])]);
 assert.equal(x.state,'awaiting_extraction');
 assert.deepEqual(x.manual_review_file_ids,['PDF_SYNTH_001']);
 assert.equal(x.allowed_file_ids.includes('PDF_SYNTH_001'),false);
});
test('unreadable files cannot appear as backend-verified extracted evidence',()=>{
 const f=files();f[1].parse_status='unreadable';
 const x=run(f,f.map(attest));
 assert.equal(x.state,'blocked');
 assert.deepEqual(x.allowed_file_ids,[]);
});
test('ZIP is kept for review but cannot claim to be extracted evidence',()=>{
 const f=files();
 f.push({file_id:'ZIP_SYNTH_001',job_id:jobId,role:'supporting_document',
 mime_type:'application/zip',size_bytes:4000,sha256:'d'.repeat(64),parse_status:'pending'});
 const x=run(f,f.slice(0,3).map(attest));
 assert.equal(x.state,'awaiting_extraction');
 assert.deepEqual(x.manual_review_file_ids,['ZIP_SYNTH_001']);
 assert.equal(x.withheld_file_ids.includes('ZIP_SYNTH_001'),true);
 assert.equal(x.issuance_allowed,false);
});
test('attempt to attest a ZIP as text is rejected',()=>{
 const f=files();
 f.push({file_id:'ZIP_SYNTH_001',job_id:jobId,role:'supporting_document',
 mime_type:'application/zip',size_bytes:4000,sha256:'d'.repeat(64),parse_status:'parsed'});
 const x=run(f,f.map(file=>({...attest(file),evidence_kind:'extracted_text'})));
 assert.equal(x.state,'blocked');
});
test('image extraction needs human-verified visual attestation, not text-only OCR flag',()=>{
 const f=files(),e=f.map(attest);
 e[2].evidence_kind='extracted_text';
 const x=run(f,e);
 assert.equal(x.state,'blocked');
});
test('cross-client file id cannot be attested into this job',()=>{
 const f=files(),e=f.map(attest);
 e[2].file_id='OTHER_CLIENT_FILE_001';
 const x=run(f,e);
 assert.equal(x.state,'blocked');
});
test('cross-job file metadata invalidates entire dossier and all permissions',()=>{
 const f=files();f[2].job_id='OTHER_JOB_001';
 const x=run(f,f.map(attest));
 assert.equal(x.state,'blocked');
 assert.deepEqual(x.allowed_file_ids,[]);
});
test('stale analysis revision cannot reuse the extraction attestation',()=>{
 const f=files(),e=f.map(attest);e[1].analysis_revision_id='OLD_ANALYSIS_REV_001';
 const x=run(f,e);assert.equal(x.state,'blocked');
});
test('modified attachment SHA-256 cannot reuse an old extraction',()=>{
 const f=files(),e=f.map(attest);
 f[1].sha256='e'.repeat(64);
 const x=run(f,e);assert.equal(x.state,'blocked');
});
test('duplicate extraction attestation is blocked with no partial file authorization',()=>{
 const f=files(),e=f.map(attest);
 const x=run(f,[...e,e[0]]);
 assert.equal(x.state,'blocked');
 assert.deepEqual(x.allowed_file_ids,[]);
});
test('missing extraction attestation is withheld even if parse_status says parsed',()=>{
 const f=files();
 const x=run(f,[attest(f[0])]);
 assert.equal(x.state,'awaiting_extraction');
 assert.deepEqual(x.withheld_file_ids,['PDF_SYNTH_001','PHOTO_SYNTH_001']);
});
test('client-produced extra keys and names are never propagated to output',()=>{
 const f=files(),e=f.map(attest);
 e[0].client_name='CLIENTE_PRIVATO';
 const x=run(f,e);
 assert.equal(x.state,'blocked');
 assert.equal(JSON.stringify(x).includes('CLIENTE_PRIVATO'),false);
});
test('a client flag can never replace backend_verified attestation',()=>{
 const f=files(),e=f.map(attest);e[2].backend_verified=false;
 assert.equal(run(f,e).state,'blocked');
});
test('different extraction batch revisions cannot silently share a HSE scope',()=>{
 const f=files(),e=f.map(attest);
 e[1].extraction_revision_id='EXTRACTION_OLD_001';
 assert.equal(run(f,e).state,'blocked');
});
test('missing extraction revision makes HSE scope unavailable',()=>{
 const f=files(),e=f.map(attest);
 assert.equal(run(f,e,{extractionRevisionId:''}).state,'blocked');
});
test('valid scope explicitly exposes its extraction revision',()=>{
 const result=run();
 assert.equal(result.extraction_revision_id,extractionRevision);
});
test('missing locator integrity stops evidence scope even if file exists',()=>{
 const f=files(),e=f.map(attest);e[2].source_locator_verified=false;
 assert.equal(run(f,e).state,'blocked');
});
test('nonnumeric or incomplete file hashes never pass dossier validation',()=>{
 const f=files();f[1].sha256='abcd';
 assert.equal(run(f,f.map(attest)).state,'blocked');
});
test('no checklist Word or multiple checklists are blocked',()=>{
 const f=files();
 assert.equal(run(f.slice(1),f.slice(1).map(attest)).state,'blocked');
 const extra={...f[0],file_id:'CHECKLIST_SYNTH_002',sha256:'f'.repeat(64)};
 assert.equal(run([...f,extra],[...f,extra].map(attest)).state,'blocked');
});
test('all inputs are immutable and result contains only sanitized IDs',()=>{
 const f=files(),e=f.map(attest),beforeF=copy(f),beforeE=copy(e);
 const x=run(f,e);x.allowed_file_ids.push('FAKE_ID_001');
 assert.deepEqual(f,beforeF);assert.deepEqual(e,beforeE);
 assert.equal(JSON.stringify(x).includes('application/pdf'),false);
 assert.equal(JSON.stringify(x).includes('a'.repeat(64)),false);
});
test('returned file scope works with specialist screening without overriding source claims',()=>{
 const f=files(),scope=run(f,f.map(attest));
 const result=normalizeSpecialtyScreening({
  jobId,
  allowedFileIds:scope.allowed_file_ids,
  answers:[{signal:'lavori_in_quota',answer:'yes',evidence:[
   {source_type:'current_job_checklist',file_id:'CHECKLIST_SYNTH_001',
    locator:'Paragrafo sintetico 2',verification_status:'confirmed'}]}]
 });
 assert.equal(result.state,'needs_confirmation');
 assert.equal(result.signals.lavori_in_quota,'yes');
});
test('unknown file in screening is not magically authorized by evidence scope',()=>{
 const f=files(),scope=run(f,f.map(attest));
 const x=normalizeSpecialtyScreening({
  jobId,allowedFileIds:scope.allowed_file_ids,
  answers:[{signal:'lavori_in_quota',answer:'yes',evidence:[
   {source_type:'current_job_checklist',file_id:'UNRELATED_SOURCE_001',
    locator:'Paragraph 1',verification_status:'confirmed'}]}]
 });
 assert.equal(x.state,'blocked');
});
test('bad or absent input fails closed',()=>{
 assert.equal(buildHseEvidenceScope().state,'blocked');
 assert.equal(run(files(),null).state,'blocked');
 assert.equal(run(files(),[],{analysisRevisionId:'WRONG_REV_001'}).state,'awaiting_extraction');
});
