'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {assess, OFFICIAL_SHA256_PREFIX, OFFICIAL_BASELINE} =
  require('../js/duvri-document-readiness.js');
const clone = obj => structuredClone(obj);
const syntheticComplete = () => ({
  jobId:'FASCICOLO_SYNTH_001',
  template:{
    approved:true,manifest_verified:true,approval_record_id:'APPROVAL_SYNTH_WORD_001',
    source_sha256:OFFICIAL_SHA256_PREFIX+'0'.repeat(64-OFFICIAL_SHA256_PREFIX.length),
    expected_sha256:OFFICIAL_SHA256_PREFIX+'0'.repeat(64-OFFICIAL_SHA256_PREFIX.length),
    template_version:'DUVRI_BASE_GENERALE_2026'
  },
  fields:{
    expected:22,mapped:22,populated:22,not_applicable:0,
    human_verified:22,mapping_approved:true,unresolved_yellow_segments:0
  },
  editorial:{
    expected:27,reviewed:27,unresolved:0,content_rules_verified:true
  },
  risk:{
    method_approved:true,method_approval_id:'APPROVAL_SYNTH_001',
    method_version:'METHOD_SYNTH_001',tables_reviewed:true,
    rows_source_mapped:true,indices_validated_under_approved_method:true
  },
  docx:{
    source_unchanged:true,generated_with_populated_fields:true,
    structural_qa_passed:true,visual_qa_after_population_passed:true,
    editorial_comments_removed_or_approved:true,
    signature_fields_identified:true,signatures_verified_blank:true,
    fixed_content_unchanged:true,sections_tables_headers_verified:true
  },
  hse:{
    job_id:'FASCICOLO_SYNTH_001',
    analysis_revision_id:'ANALYSIS_SYNTH_001',
    document_revision_id:'DOCUMENT_SYNTH_001',
    findings_decision_state:'draft_findings_reviewed',
    open_blockers:0,sources_rechecked:true,professional_review_required:true
  }
});
const codes = r => r.blockers.map(x=>x.code);
test('official template baseline counts are explicit and immutable',()=>{
  assert.deepEqual(OFFICIAL_BASELINE,{
    yellow_segments:22,yellow_runs:62,editorial_comments:27,
    sections:19,tables:13,text_boxes:16
  });
  assert.equal(Object.isFrozen(OFFICIAL_BASELINE),true);
});
test('fully synthetic attestations permit final review but NEVER issue the DUVRI',()=>{
  const r=assess(syntheticComplete());
  assert.equal(r.state,'eligible_for_final_technical_review');
  assert.equal(r.readiness_checks_passed,true);
  assert.equal(r.duvri_approved,false);
  assert.equal(r.issuance_allowed,false);
});
test('the actual reported Claude state is correctly blocked',()=>{
  const d=syntheticComplete();
  d.fields.mapped=0;d.fields.populated=0;d.fields.human_verified=0;
  d.editorial.reviewed=0;d.editorial.unresolved=27;
  d.risk.method_approved=false;
  d.docx.generated_with_populated_fields=false;
  d.docx.visual_qa_after_population_passed=false;
  d.docx.signature_fields_identified=false;
  d.hse.findings_decision_state='blocked';
  const r=assess(d);
  assert.equal(r.state,'blocked');
  assert.ok(codes(r).includes('YELLOW_FIELDS'));
  assert.ok(codes(r).includes('EDITORIAL'));
  assert.ok(codes(r).includes('RISK_METHOD'));
  assert.ok(codes(r).includes('DOCX_QUALITY'));
  assert.ok(codes(r).includes('HSE_REVIEW'));
});
test('different Word hash cannot enter readiness even with 22 yellow fields',()=>{
  const d=syntheticComplete();
  d.template.source_sha256='0'.repeat(64);
  assert.ok(codes(assess(d)).includes('TEMPLATE'));
});
test('template approval and expected fingerprint are mandatory',()=>{
  const d=syntheticComplete();
  d.template.approved=false;
  assert.equal(assess(d).state,'blocked');
  d.template.approved=true;
  d.template.expected_sha256='0'.repeat(64);
  assert.equal(assess(d).state,'blocked');
});
test('mapping alone is insufficient: 22 fields must also be populated and reviewed',()=>{
  const d=syntheticComplete();
  d.fields.populated=0;
  assert.ok(codes(assess(d)).includes('YELLOW_FIELDS'));
  d.fields.populated=22;
  d.fields.human_verified=21;
  assert.ok(codes(assess(d)).includes('YELLOW_FIELDS'));
});
test('no-field document with perfect pixel match is still blocked',()=>{
  const d=syntheticComplete();
  d.fields.mapped=0;d.fields.populated=0;d.fields.human_verified=0;
  d.docx.visual_qa_after_population_passed=true;
  assert.equal(assess(d).state,'blocked');
});
test('unresolved yellow segments block regardless of verified count',()=>{
  const d=syntheticComplete();
  d.fields.unresolved_yellow_segments=1;
  assert.ok(codes(assess(d)).includes('YELLOW_FIELDS'));
});
test('all 27 editorial comments must be reviewed',()=>{
  const d=syntheticComplete();
  d.editorial.reviewed=26;
  assert.ok(codes(assess(d)).includes('EDITORIAL'));
  d.editorial.reviewed=27;
  d.editorial.content_rules_verified=false;
  assert.ok(codes(assess(d)).includes('EDITORIAL'));
});
test('unresolved editorial comment remains a blocker even when 27 marked reviewed',()=>{
  const d=syntheticComplete();
  d.editorial.unresolved=1;
  assert.ok(codes(assess(d)).includes('EDITORIAL'));
});
test('risk method must carry an actual approval reference and version',()=>{
  const d=syntheticComplete();
  d.risk.method_approval_id='';
  assert.ok(codes(assess(d)).includes('RISK_METHOD'));
  d.risk.method_approval_id='APPROVAL_SYNTH_001';
  d.risk.method_approved=false;
  assert.ok(codes(assess(d)).includes('RISK_METHOD'));
});
test('risk rows without explicit mapping to original template are blocked',()=>{
  const d=syntheticComplete();
  d.risk.rows_source_mapped=false;
  assert.ok(codes(assess(d)).includes('RISK_METHOD'));
});
test('rendering prior to filling fields is not evidence of final visual QA',()=>{
  const d=syntheticComplete();
  d.docx.visual_qa_after_population_passed=false;
  assert.ok(codes(assess(d)).includes('DOCX_QUALITY'));
});
test('signature field must be identified and blank',()=>{
  const d=syntheticComplete();
  d.docx.signature_fields_identified=false;
  assert.ok(codes(assess(d)).includes('DOCX_QUALITY'));
  d.docx.signature_fields_identified=true;
  d.docx.signatures_verified_blank=false;
  assert.ok(codes(assess(d)).includes('DOCX_QUALITY'));
});
test('original source must remain unchanged, even with a completed draft',()=>{
  const d=syntheticComplete();
  d.docx.source_unchanged=false;
  assert.ok(codes(assess(d)).includes('DOCX_QUALITY'));
});
test('rejected/unreviewed HSE findings keep pre-release gate blocked',()=>{
  const d=syntheticComplete();
  d.hse.findings_decision_state='changes_requested';
  assert.ok(codes(assess(d)).includes('HSE_REVIEW'));
});
test('other case HSE revision cannot be reused',()=>{
  const d=syntheticComplete();
  d.hse.job_id='ANOTHER_CASE';
  assert.ok(codes(assess(d)).includes('HSE_REVIEW'));
});
test('missing HSE revision IDs or unreviewed evidence block',()=>{
  const d=syntheticComplete();
  d.hse.analysis_revision_id='';
  assert.ok(codes(assess(d)).includes('HSE_REVIEW'));
  d.hse.analysis_revision_id='ANALYSIS_SYNTH_001';
  d.hse.sources_rechecked=false;
  assert.ok(codes(assess(d)).includes('HSE_REVIEW'));
});
test('malformed, missing, or unsupported input fails closed',()=>{
  assert.equal(assess().state,'blocked');
  assert.equal(assess({jobId:'BAD_JOB'}).state,'blocked');
  assert.equal(assess({...syntheticComplete(),fields:null}).state,'blocked');
});
test('does not mutate the trusted input attestations',()=>{
  const d=syntheticComplete(), copy=clone(d);
  const r=assess(d);
  r.blockers.push({code:'FAKE',description:'no'});
  assert.deepEqual(d,copy);
});

test('only the SHA prefix is published; a complete verified checksum must come from approved manifest',()=>{
  assert.equal(OFFICIAL_SHA256_PREFIX,'69b2f63c');
  const d=syntheticComplete();
  d.template.expected_sha256=OFFICIAL_SHA256_PREFIX;
  d.template.source_sha256=OFFICIAL_SHA256_PREFIX;
  assert.ok(codes(assess(d)).includes('TEMPLATE'));
  d.template=syntheticComplete().template;
  d.template.manifest_verified=false;
  assert.ok(codes(assess(d)).includes('TEMPLATE'));
  d.template.manifest_verified=true;
  d.template.approval_record_id='';
  assert.ok(codes(assess(d)).includes('TEMPLATE'));
});
test('unapproved wrong full hash with same prefix is blocked',()=>{
  const d=syntheticComplete();
  d.template.source_sha256=OFFICIAL_SHA256_PREFIX+'1'.repeat(56);
  assert.ok(codes(assess(d)).includes('TEMPLATE'));
});
test('approved conditional field can remain not applicable if all 22 segments resolved',()=>{
  const d=syntheticComplete();
  d.fields.populated=19;
  d.fields.not_applicable=3;
  d.fields.not_applicable_approved=true;
  assert.equal(assess(d).state,'eligible_for_final_technical_review');
  assert.equal(assess(d).issuance_allowed,false);
  d.fields.not_applicable_approved=false;
  assert.ok(codes(assess(d)).includes('YELLOW_FIELDS'));
});
test('incomplete or inconsistent conditional field counts cannot pass',()=>{
  const d=syntheticComplete();
  d.fields.not_applicable=4;
  assert.ok(codes(assess(d)).includes('YELLOW_FIELDS'));
  d.fields.populated=-4;
  assert.ok(codes(assess(d)).includes('YELLOW_FIELDS'));
});
