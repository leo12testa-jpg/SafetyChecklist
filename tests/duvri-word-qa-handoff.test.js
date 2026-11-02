'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {normalize,SOURCE_VERSION,TARGET_VERSION}=require('../js/duvri-word-qa-handoff.js');
const jobId='FASCICOLO_SYNTH_001',templateVersion='DUVRI_BASE_GENERALE_2026';
const mappingRevisionId='MAPPING_SYNTH_001',documentRevisionId='DOCX_REV_SYNTH_001';
const hash='a'.repeat(64),outputHash='b'.repeat(64);
function complete(){
  return {
    schema_version:SOURCE_VERSION,job_id:jobId,template_version:templateVersion,
    mapping_revision_id:mappingRevisionId,document_revision_id:documentRevisionId,
    qa_document_revision_id:documentRevisionId,
    source_sha256:hash,output_sha256:outputHash,qa_output_sha256:outputHash,
    yellow_segments_total:22,yellow_segments_populated:22,
    yellow_segments_not_applicable:0,yellow_segments_human_verified:22,
    yellow_segments_unresolved:0,editorial_comments_total:27,
    editorial_comments_reviewed:27,editorial_comments_unresolved:0,
    source_unchanged:true,populated_output_created:true,
    structural_qa_passed:true,visual_qa_after_population_passed:true,
    fixed_content_unchanged:true,sections_tables_headers_verified:true,
    editorial_rules_verified:true,editorial_comments_removed_or_approved:true,
    signature_fields_identified:true,signatures_verified_blank:true,
    risk_tables_reviewed:true,risk_rows_source_mapped:true
  };
}
const run=(report=complete(),other={})=>normalize({
  jobId,templateVersion,mappingRevisionId,documentRevisionId,report,...other
});
test('fully synthetic report is complete but cannot approve or issue a DUVRI',()=>{
  const r=run();assert.equal(r.schema_version,TARGET_VERSION);
  assert.equal(r.state,'qa_report_complete');
  assert.equal(r.ready_for_technical_preflight,false);
  assert.equal(r.issuance_allowed,false);assert.equal(r.duvri_approved,false);
  assert.equal(r.risk_table_layout.method_D1_approved,false);
});
test('actual Claude 0 of 22 and 27 open comments correctly remains unready',()=>{
 const report=complete();
 Object.assign(report,{
  yellow_segments_populated:0,yellow_segments_human_verified:0,
  yellow_segments_unresolved:22,editorial_comments_reviewed:0,
  editorial_comments_unresolved:27,populated_output_created:false,
  editorial_rules_verified:false,
  editorial_comments_removed_or_approved:false,
  signature_fields_identified:false,visual_qa_after_population_passed:false,
  risk_tables_reviewed:false,risk_rows_source_mapped:false,
  output_sha256:null,qa_output_sha256:null
 });
 const r=run(report);
 assert.equal(r.state,'needs_claude_review');assert.equal(r.population.unresolved,22);
 assert.equal(r.editorial.unresolved,27);
 assert.equal(r.docx.visual_qa_after_population_passed,false);
});
test('historical empty Word render does not substitute for populated visual QA',()=>{
 const r=complete();r.populated_output_created=false;
 assert.equal(run(r).state,'needs_claude_review');
});
test('N/A fields require follow-on mapping approval, not false readiness grant',()=>{
 const r=complete();r.yellow_segments_populated=19;r.yellow_segments_not_applicable=3;
 const out=run(r);
 assert.equal(out.state,'qa_report_complete');
 assert.equal(out.ready_for_technical_preflight,false);
 assert.equal(out.population.actual_not_applicable,3);
});
test('unresolved comments prevent complete report even with perfect layout',()=>{
 const r=complete();r.editorial_comments_reviewed=26;r.editorial_comments_unresolved=1;
 assert.equal(run(r).state,'needs_claude_review');
});
test('signature still unknown blocks completed QA',()=>{
 const r=complete();r.signature_fields_identified=false;
 assert.equal(run(r).state,'needs_claude_review');
});
test('risks table columns unverified block report even when all yellow fields mapped',()=>{
 const r=complete();r.risk_rows_source_mapped=false;
 assert.equal(run(r).state,'needs_claude_review');
});
test('output mismatch between generator and QA file cannot pass',()=>{
 const r=complete();r.qa_output_sha256='c'.repeat(64);
 assert.equal(run(r).state,'needs_claude_review');
 assert.notEqual(run(r).docx.output_sha256,run(r).docx.qa_output_sha256);
});
test('output hashes are complete SHA-256 values',()=>{
 const r=complete();r.output_sha256='abc';
 assert.equal(run(r).state,'needs_claude_review');
 assert.equal(run(r).docx.output_sha256,null);
});
test('wrong job, mapping revision, or DOCX revision rejected completely',()=>{
 for(const key of ['job_id','mapping_revision_id','document_revision_id','qa_document_revision_id']){
  const r=complete();r[key]='OTHER_SYNTH_001';
  assert.equal(run(r).state,'blocked',key);
 }
});
test('template version mismatch must block, not fall back to a generic Word',()=>{
 const r=complete();r.template_version='OTHER_TEMPLATE_001';
 assert.equal(run(r).state,'blocked');
});
test('unexpected customer data or paths cannot be included in structured handoff',()=>{
 const r=complete();r.client_name='PRIVATE_CLIENT';
 const out=run(r);
 assert.equal(out.state,'blocked');
 assert.equal(JSON.stringify(out).includes('PRIVATE_CLIENT'),false);
});
test('invalid counts and false booleans block or defer but never pass silently',()=>{
 const a=complete();a.yellow_segments_total=23;
 assert.equal(run(a).state,'blocked');
 const b=complete();b.yellow_segments_populated=-1;
 assert.equal(run(b).state,'blocked');
 const c=complete();c.structural_qa_passed='yes';
 assert.equal(run(c).state,'blocked');
});
test('missing exact document source checksum is not acceptable',()=>{
 const r=complete();r.source_sha256='69B2F63C';
 assert.equal(run(r).state,'blocked');
});
test('report metadata is not mutated and no confidential text appears in the output',()=>{
 const r=complete();const before=structuredClone(r);
 const out=run(r);
 out.population.actual_populated=0;
 assert.deepEqual(r,before);
 const s=JSON.stringify(out);
 assert.equal(s.includes('C:/'),false);
 assert.equal(s.includes('CLIENTE'),false);
});
test('entire missing report and malformed root fail closed',()=>{
 assert.equal(normalize().state,'blocked');
 assert.equal(run(null).state,'blocked');
 assert.equal(run(complete(),{mappingRevisionId:'WRONG_REV'}).state,'blocked');
});
