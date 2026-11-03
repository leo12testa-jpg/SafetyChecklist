'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');

const ROOT=path.join(__dirname,'..');
const cases=JSON.parse(fs.readFileSync(
 path.join(ROOT,'fixtures','duvri-realistic-synthetic-cases.v1.json'),'utf8'));
const manifest=require('../js/duvri-case-manifest.js');

test('four realistic dossiers have a clean independent DOCX intake contract',()=>{
 assert.equal(cases.synthetic_only,true);
 assert.equal(cases.cases.length,4);
 assert.equal(cases.output_contract.prohibit_auto_issuance,true);
 assert.match(cases.generator_input_contract,/does NOT import PWA checklist app data/);
 assert.equal(new Set(cases.cases.map(x=>x.id)).size,4);
 for(const c of cases.cases){
  assert.match(c.id,/^SIM-\d{2}-[A-Z-]+$/);
  assert.match(c.committente,/Sintetic|Prove/);
  assert.ok(c.appaltatori.length>0);
  assert.ok(c.checklist.length>=10);
  assert.ok(c.pdf_lines.length>=3);
  assert.ok(c.acceptance.must_consider.length>0);
  assert.ok(c.acceptance.mandatory_questions.length>0);
  assert.ok(c.acceptance.unknown_must_not_be_asserted.length>0);
  assert.ok(c.acceptance.specialists.includes('documentale'));
  assert.ok(c.acceptance.specialists.includes('normativa'));
  assert.ok(c.acceptance.specialists.includes('coordinamento'));
  assert.equal(c.acceptance.require_technical_review,true);
 }
});
test('source contract requires exactly one DOCX client checklist; not the PWA checklist database',()=>{
 const files=[
  {file_id:'FILE_SINT_00001',job_id:'JOB_SINT_0001',
   role:'client_checklist',mime_type:manifest.CHECKLIST_MIME,
   size_bytes:1200,sha256:'a'.repeat(64),parse_status:'pending'},
  {file_id:'FILE_SINT_00002',job_id:'JOB_SINT_0001',
   role:'supporting_document',mime_type:'application/pdf',
   size_bytes:1700,sha256:'b'.repeat(64),parse_status:'pending'}
 ];
 const ok=manifest.assessManifest({jobId:'JOB_SINT_0001',documents:files});
 assert.equal(ok.state,'ready_for_extraction');
 assert.equal(ok.requires_extraction,true);
 assert.equal(ok.evidence_verified,false);
 assert.equal(ok.issuance_allowed,false);
 const noDoc=manifest.assessManifest({jobId:'JOB_SINT_0001',documents:files.slice(1)});
 assert.equal(noDoc.state,'blocked');
 assert.equal(noDoc.issuance_allowed,false);
});
test('synthetic cases explicitly make no HSE scoring or DUVRI issuance decisions',()=>{
 for(const term of ['HSE_TECHNICIAN_REVIEW','D1_APPROVAL','D2_APPROVAL',
  'WORD_VISUAL_QA','INDEPENDENT_REVIEWER']){
  assert.ok(cases.output_contract.must_require.includes(term));
 }
 assert.equal(cases.approval_status,'NOT_APPROVED');
 assert.ok(cases.cases.some(x=>x.expected_result==='blocked_missing_critical_documents'));
 assert.ok(cases.cases.some(x=>x.expected_result==='draft_with_blocking_clarifications'));
});
test('create real document inputs offline with Python; no network or external AI',()=>{
 const py=process.platform==='win32'?'py':'python3';
 const args=process.platform==='win32'
  ?['-3','-m','unittest','discover','-s','tests/python',
    '-p','test_duvri_realistic_synthetic_bundle.py','-v']
  :['-m','unittest','discover','-s','tests/python',
    '-p','test_duvri_realistic_synthetic_bundle.py','-v'];
 const run=spawnSync(py,args,{cwd:ROOT,encoding:'utf8',timeout:45000,
  maxBuffer:2*1024*1024,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
 assert.ifError(run.error);
 assert.equal(run.status,0,[run.stderr||'',run.stdout||''].join('\n').slice(-3500));
});
test('the generator script does not touch existing audit/DVR app or private template',()=>{
 const source=fs.readFileSync(path.join(ROOT,'tools',
  'duvri_realistic_synthetic_bundle.py'),'utf8');
 assert.doesNotMatch(source,/https?:\/\/|openai|anthropic|ollama|subprocess/);
 assert.doesNotMatch(source,/js\/app\.js|service-worker\.js|src\/checklists/);
 assert.match(source,/issuance_allowed.*False/);
});
