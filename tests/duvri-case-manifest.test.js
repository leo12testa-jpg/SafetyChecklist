'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {assessManifest,CHECKLIST_MIME}=require('../js/duvri-case-manifest.js');

const jobId='FASCICOLO_SYNTH_001';
const doc=(id,role,mime,hashdigit,extras={})=>({
 file_id:id,job_id:jobId,role,mime_type:mime,size_bytes:2000,
 sha256:hashdigit.repeat(64),parse_status:'pending',...extras
});
const checklist=()=>doc('CHECKLIST_SYNTH_001','client_checklist',CHECKLIST_MIME,'a');
const pdf=()=>doc('PDF_SYNTH_001','supporting_document','application/pdf','b');
const photo=()=>doc('PHOTO_SYNTH_001','photograph','image/jpeg','c');
const run=(documents=[checklist(),pdf(),photo()],more={})=>
 assessManifest({jobId,documents,...more});
const clone=x=>structuredClone(x);
test('one Word checklist with PDF and photo forms valid case manifest',()=>{
 const r=run();
 assert.equal(r.state,'ready_for_extraction');
 assert.equal(r.files_count,3);
 assert.equal(r.attachment_count,2);
 assert.equal(r.evidence_verified,false);
 assert.equal(r.issuance_allowed,false);
});
test('must not substitute a PDF for the client Word checklist',()=>{
 const files=[{...checklist(),mime_type:'application/pdf'}];
 assert.equal(run(files).state,'blocked');
});
test('missing checklist blocks dossier, even with many attachments',()=>{
 assert.equal(run([pdf(),photo()]).state,'blocked');
 assert.equal(run([]).state,'blocked');
});
test('two primary checklists are rejected to avoid ambiguous revisions',()=>{
 const second=doc('CHECKLIST_SYNTH_002','client_checklist',CHECKLIST_MIME,'d');
 assert.equal(run([checklist(),second]).state,'blocked');
});
test('file belonging to another case blocks whole manifest',()=>{
 const files=[checklist(),{...pdf(),job_id:'OTHER_CASE_001'}];
 const r=run(files);
 assert.equal(r.state,'blocked');
 assert.deepEqual(r.files_for_authorization_review,[]);
});
test('duplicate file IDs block whole manifest',()=>{
 const files=[checklist(),{...pdf(),file_id:'CHECKLIST_SYNTH_001'}];
 assert.equal(run(files).state,'blocked');
});
test('byte-identical duplicate files are flagged, not silently processed twice',()=>{
 const files=[checklist(),{...pdf(),sha256:'a'.repeat(64)}];
 assert.equal(run(files).state,'blocked');
});
test('invalid media type and unsupported executable are rejected',()=>{
 const files=[checklist(),{...pdf(),mime_type:'application/x-msdownload'}];
 assert.equal(run(files).state,'blocked');
});
test('photo role requires actual image media type',()=>{
 const files=[checklist(),{...photo(),mime_type:'application/pdf'}];
 assert.equal(run(files).state,'blocked');
});
test('drawing role supports PDF and PNG, not XLSX',()=>{
 const drawing=doc('DRAWING_SYNTH_001','drawing','application/pdf','d');
 assert.equal(run([checklist(),drawing]).state,'ready_for_extraction');
 drawing.mime_type='image/png';
 assert.equal(run([checklist(),drawing]).state,'ready_for_extraction');
 drawing.mime_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
 assert.equal(run([checklist(),drawing]).state,'blocked');
});
test('unreadable attachment is visible as needs_attention',()=>{
 const r=run([checklist(),{...pdf(),parse_status:'unreadable'}]);
 assert.equal(r.state,'needs_attention');
 assert.equal(r.evidence_verified,false);
});
test('malformed hashes, file sizes and parser states block intake',()=>{
 assert.equal(run([checklist(),{...pdf(),sha256:'invalid'}]).state,'blocked');
 assert.equal(run([checklist(),{...pdf(),size_bytes:-1}]).state,'blocked');
 assert.equal(run([checklist(),{...pdf(),parse_status:'fully_verified_hse'}]).state,'blocked');
});
test('unapproved fields such as client names or local paths cannot leak',()=>{
 const files=[checklist(),{...pdf(),client_name:'CLIENTE_PRIVATO',path:'C:/DATI'}];
 const r=run(files);
 assert.equal(r.state,'blocked');
 assert.equal(JSON.stringify(r).includes('CLIENTE_PRIVATO'),false);
});
test('file IDs are candidates only, not authorized evidence',()=>{
 const r=run();
 assert.equal(r.evidence_verified,false);
 assert.equal(r.requires_extraction,true);
 assert.deepEqual(r.files_for_authorization_review,
   ['CHECKLIST_SYNTH_001','PDF_SYNTH_001','PHOTO_SYNTH_001']);
});
test('original manifest is not modified or converted into an HSE conclusion',()=>{
 const files=[checklist(),pdf(),photo()],original=clone(files);
 const r=run(files);
 r.files_for_authorization_review[0]='changed';
 assert.deepEqual(files,original);
 assert.equal(r.issuance_allowed,false);
});
test('missing job ID or malformed root is blocked',()=>{
 assert.equal(assessManifest().state,'blocked');
 assert.equal(run([checklist()],{jobId:''}).state,'blocked');
 assert.equal(run(null).state,'blocked');
});

test('ZIP attachment is retained but quarantined for manual review',()=>{
 const zip=doc('ZIP_SYNTH_001','supporting_document','application/zip','d');
 const r=run([checklist(),zip]);
 assert.equal(r.state,'needs_attention');
 assert.equal(r.files_count,2);
 assert.deepEqual(r.manual_review_file_ids,['ZIP_SYNTH_001']);
 assert.deepEqual(r.files_for_authorization_review,['CHECKLIST_SYNTH_001']);
 assert.equal(r.evidence_verified,false);
});
test('HEIC photograph is listed for manual review rather than silently discarded',()=>{
 const heic=doc('HEIC_SYNTH_001','photograph','image/heic','d');
 const r=run([checklist(),heic]);
 assert.equal(r.state,'needs_attention');
 assert.deepEqual(r.manual_review_file_ids,['HEIC_SYNTH_001']);
 assert.equal(r.issuance_allowed,false);
});
test('unreadable PDF never becomes candidate evidence for agents',()=>{
 const r=run([checklist(),{...pdf(),parse_status:'unreadable'}]);
 assert.deepEqual(r.manual_review_file_ids,['PDF_SYNTH_001']);
 assert.deepEqual(r.files_for_authorization_review,['CHECKLIST_SYNTH_001']);
});
test('blocked manifest never returns even partial authorized file IDs',()=>{
 const bad=doc('DUPLICATE_SYNTH_001','supporting_document','application/pdf','a');
 const r=run([checklist(),bad]);
 assert.equal(r.state,'blocked');
 assert.deepEqual(r.manual_review_file_ids,[]);
 assert.deepEqual(r.files_for_authorization_review,[]);
});
test('no uploaded metadata alone can confirm the evidence or authorize issuance',()=>{
 const r=run([checklist(),pdf()],{});
 assert.equal(r.requires_extraction,true);
 assert.equal(r.evidence_verified,false);
 assert.equal(r.issuance_allowed,false);
});
