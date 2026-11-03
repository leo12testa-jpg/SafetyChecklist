'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {assess,VERSION,PAGE_VERSION,CHECKS}=require('../js/duvri-word-human-review-ledger.js');
const job='JOB_SYNTH_HUMAN_VISUAL_001';
const docRev='DOCX_SYNTH_REV_001',renderRun='RENDER_SYNTH_RUN_001';
const ledgerRev='LEDGER_SYNTH_REV_001',gen='GENERATOR_SYNTH_001',reviewer='REVIEWER_SYNTH_002';
const hash=x=>x.repeat(64);
const ctx=(n=30)=>({
 job_id:job,draft_revision_id:docRev,current_draft_revision_id:docRev,
 draft_sha256:hash('a'),current_draft_sha256:hash('a'),
 render_run_id:renderRun,current_render_run_id:renderRun,
 review_ledger_revision_id:ledgerRev,current_review_ledger_revision_id:ledgerRev,
 generator_id:gen,reviewer_id:reviewer,reviewer_role:'tecnico',
 authenticated:true,can_review_visual:true,
 backend_loaded_verified_manifest:true,rendered_page_integrity_verified:true,
 render_provenance_verified:true,page_count_independently_verified:true,
 render_version_matches_docx:true,page_count:n,
 pages:Array.from({length:n},(_,i)=>({page_number:i+1,sha256:hash(String((i%10)))}))
});
const mk=(context,decision='pass')=>context.pages.map((p,i)=>({
 schema_version:PAGE_VERSION,job_id:job,draft_revision_id:docRev,
 render_run_id:renderRun,review_ledger_revision_id:ledgerRev,
 page_number:i+1,page_sha256:p.sha256,
 reviewer_id:reviewer,reviewer_role:'tecnico',decision,
 checks:Object.fromEntries(CHECKS.map(k=>[k,decision==='pass'?true:decision==='pending'?null:false])),
 issue_codes:decision==='fail'?['OTHER_VISUAL_ISSUE']:[]
}));
const run=(patchContext={},patchReviews)=>{const c=Object.assign(ctx(),patchContext);return assess({
 trustedContext:c,pageReviews:patchReviews===undefined?mk(c):patchReviews});};
const neverIssues=x=>{
 assert.equal(x.issuance_allowed,false);
 assert.equal(x.ready_for_issuance,false);
 assert.equal(x.visual_qa_approved,false);
 assert.equal(x.d1_approved,false);
 assert.equal(x.d2_approved,false);
 assert.equal(JSON.stringify(x).includes('SHA'),false);
};
test('complete synthetic 30-page human ledger still cannot certify QA or issue DUVRI',()=>{
 const r=run();assert.equal(r.schema_version,VERSION);
 assert.equal(r.state,'all_page_reviews_recorded_for_private_qa');
 assert.equal(r.page_count_expected,30);assert.equal(r.passed_pages,30);
 assert.equal(r.failed_pages,0);assert.equal(r.pending_pages,0);
 assert.deepEqual(r.blocker_codes,['PRIVATE_QA_SIGNOFF_REQUIRED']);neverIssues(r);
});
test('30 pages in pending state are not visually reviewed',()=>{
 const c=ctx(),r=assess({trustedContext:c,pageReviews:mk(c,'pending')});
 assert.equal(r.state,'awaiting_human_page_review');assert.equal(r.pending_pages,30);
 assert.equal(r.passed_pages,0);neverIssues(r);
});
test('one failed page prevents a QA pass even if other 29 pass',()=>{
 const c=ctx(),entries=mk(c);entries[7].decision='fail';
 entries[7].checks.page_legible=false;entries[7].issue_codes=['TEXT_UNREADABLE'];
 const r=assess({trustedContext:c,pageReviews:entries});
 assert.equal(r.state,'needs_visual_correction');assert.equal(r.failed_pages,1);
 assert.deepEqual(r.blocker_codes,['VISUAL_CORRECTION_REQUIRED']);neverIssues(r);
});
test('a mix of pass and pending never qualifies as complete',()=>{
 const c=ctx(),entries=mk(c);
 entries[29]=mk(c,'pending')[29];
 const r=assess({trustedContext:c,pageReviews:entries});
 assert.equal(r.state,'awaiting_human_page_review');assert.equal(r.pending_pages,1);neverIssues(r);
});
test('missing last page fails closed without partial review counts',()=>{
 const c=ctx(),r=assess({trustedContext:c,pageReviews:mk(c).slice(0,29)});
 assert.equal(r.state,'blocked');assert.equal(r.pages_recorded,0);neverIssues(r);
});
test('duplicate or swapped pages are rejected',()=>{
 const c=ctx(),entries=mk(c);entries[20]=entries[19];
 const r=assess({trustedContext:c,pageReviews:entries});
 assert.equal(r.state,'blocked');neverIssues(r);
});
test('forged page image SHA does not pass',()=>{
 const c=ctx(),entries=mk(c);entries[1].page_sha256=hash('e');
 assert.equal(assess({trustedContext:c,pageReviews:entries}).state,'blocked');
});
test('changed draft digest invalidates even perfect manual review',()=>{
 const c=ctx(),entries=mk(c);c.current_draft_sha256=hash('b');
 assert.equal(assess({trustedContext:c,pageReviews:entries}).state,'blocked');
});
test('changed draft revision invalidates all review records',()=>{
 const c=ctx(),entries=mk(c);c.current_draft_revision_id='NEW_REV_SYNTH_002';
 assert.equal(assess({trustedContext:c,pageReviews:entries}).state,'blocked');
});
test('new rendering invalidates old human review',()=>{
 const c=ctx(),entries=mk(c);c.current_render_run_id='RENDER_NEW_SYNTH_002';
 assert.equal(assess({trustedContext:c,pageReviews:entries}).state,'blocked');
});
test('new ledger revision invalidates stale reviewer decisions',()=>{
 const c=ctx(),entries=mk(c);c.current_review_ledger_revision_id='LEDGER_NEW_SYNTH_002';
 assert.equal(assess({trustedContext:c,pageReviews:entries}).state,'blocked');
});
test('generator may not review their own output',()=>{
 const c=ctx(),entries=mk(c);c.generator_id=reviewer;
 assert.equal(assess({trustedContext:c,pageReviews:entries}).state,'blocked');
});
test('a not authorized reviewer or unsupported role is rejected',()=>{
 for(const key of ['authenticated','can_review_visual']){
  const c=ctx(),entries=mk(c);c[key]=false;
  assert.equal(assess({trustedContext:c,pageReviews:entries}).state,'blocked',key);
 }
 const c=ctx(),entries=mk(c);c.reviewer_role='guest';
 assert.equal(assess({trustedContext:c,pageReviews:entries}).state,'blocked');
});
test('a forged browser flag cannot substitute for backend verified manifest',()=>{
 for(const key of [
  'backend_loaded_verified_manifest','rendered_page_integrity_verified',
  'render_provenance_verified','page_count_independently_verified',
  'render_version_matches_docx']){
  const c=ctx(),entries=mk(c);c[key]=false;
  assert.equal(assess({trustedContext:c,pageReviews:entries}).state,'blocked',key);
 }
});
test('a pass with unchecked page fields is invalid',()=>{
 const c=ctx(),entries=mk(c);entries[2].checks.tables_unclipped=null;
 assert.equal(assess({trustedContext:c,pageReviews:entries}).state,'blocked');
});
test('a pass with an issue code is invalid',()=>{
 const c=ctx(),entries=mk(c);entries[2].issue_codes=['LABEL_CLIPPED'];
 assert.equal(assess({trustedContext:c,pageReviews:entries}).state,'blocked');
});
test('a fail requires a specific issue and at least one false check',()=>{
 const c=ctx(),entries=mk(c);
 entries[3].decision='fail';entries[3].checks.page_legible=false;
 assert.equal(assess({trustedContext:c,pageReviews:entries}).state,'blocked');
 entries[3].issue_codes=['TEXT_UNREADABLE'];
 assert.equal(assess({trustedContext:c,pageReviews:entries}).state,'needs_visual_correction');
 entries[3].checks.page_legible=true;
 assert.equal(assess({trustedContext:c,pageReviews:entries}).state,'blocked');
});
test('pending cannot pretend checks were performed',()=>{
 const c=ctx(),entries=mk(c,'pending');entries[0].checks.page_legible=true;
 assert.equal(assess({trustedContext:c,pageReviews:entries}).state,'blocked');
});
test('human notes and customer names cannot enter report via extra fields',()=>{
 const c=ctx(),entries=mk(c);entries[0].client_name='PRIVATE_CLIENT_NAME';
 const r=assess({trustedContext:c,pageReviews:entries});
 assert.equal(r.state,'blocked');
 assert.equal(JSON.stringify(r).includes('PRIVATE_CLIENT_NAME'),false);neverIssues(r);
});
test('invalid issue codes and duplicate codes fail without leaking values',()=>{
 const c=ctx(),entries=mk(c,'fail');
 entries[0].issue_codes=['UNKNOWN_FROM_CLIENT'];
 let r=assess({trustedContext:c,pageReviews:entries});
 assert.equal(r.state,'blocked');assert.equal(JSON.stringify(r).includes('UNKNOWN_FROM_CLIENT'),false);
 entries[0].issue_codes=['TEXT_UNREADABLE','TEXT_UNREADABLE'];
 r=assess({trustedContext:c,pageReviews:entries});assert.equal(r.state,'blocked');
});
test('wrong job, reviewer, or schema prevents passing',()=>{
 for(const [key,value] of [
  ['job_id','FOREIGN_JOB_SYNTH_003'],
  ['reviewer_id','FOREIGN_REVIEWER_SYNTH_003'],
  ['schema_version','BAD_SCHEMA']]){
  const c=ctx(),entries=mk(c);entries[0][key]=value;
  assert.equal(assess({trustedContext:c,pageReviews:entries}).state,'blocked',key);
 }
});
test('review supports any bound positive page count, not hardcoded 30',()=>{
 for(const n of [1,2,47,150]){
  const c=ctx(n),r=assess({trustedContext:c,pageReviews:mk(c)});
  assert.equal(r.passed_pages,n);assert.equal(r.state,'all_page_reviews_recorded_for_private_qa');
  neverIssues(r);
 }
});
test('zero and excessive page count cannot pass',()=>{
 for(const n of [0,151]){
  const c=ctx(n),r=assess({trustedContext:c,pageReviews:mk(c)});
  assert.equal(r.state,'blocked');neverIssues(r);
 }
});
test('malformed or empty inputs fail without exceptions or side effects',()=>{
 for(const args of [undefined,{},null,{trustedContext:{},pageReviews:[]}]){
  const r=assess(args);assert.equal(r.state,'blocked');neverIssues(r);
 }
});
test('source context and reviewer ledger never mutated',()=>{
 const c=ctx(),entries=mk(c),snapshot=structuredClone({c,entries});
 const r=assess({trustedContext:c,pageReviews:entries});
 assert.deepEqual({c,entries},snapshot);
 assert.equal(r.state,'all_page_reviews_recorded_for_private_qa');
});
