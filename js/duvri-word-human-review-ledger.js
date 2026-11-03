/*
 * Colligo DUVRI — pure validator for INDEPENDENT HUMAN visual review records.
 *
 * The caller MUST fetch trustedContext and page-review records from a PRIVATE
 * authenticated backend, independently verify manifest PNG hashes/provenance
 * using the private Word render-evidence check, and enforce a transactional
 * revision lease / append-only audit when persisting human decisions.
 *
 * This is NOT a visual inspection, identity provider, signature validator,
 * approval service, Word renderer, HSE risk evaluator or issuance gateway.
 * No side effects; never returns a DUVRI approval or client document text.
 */
const duvriWordHumanReviewLedger=(()=>{
  'use strict';
  const VERSION='colligo-duvri-word-human-review-ledger/1.0';
  const PAGE_VERSION='colligo-duvri-word-human-page-review/1.0';
  const ids=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{6,128}$/.test(x);
  const digest=x=>typeof x==='string'&&/^[a-f0-9]{64}$/i.test(x);
  const obj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
  const owns=(x,k)=>Object.prototype.hasOwnProperty.call(x,k);
  const checks=Object.freeze([
    'page_legible','header_footer_correct','tables_unclipped',
    'no_text_overflow','non_emittable_label_visible',
    'content_and_order_checked'
  ]);
  const issueCodes=Object.freeze(new Set([
    'LABEL_MISSING','LABEL_CLIPPED','CONTENT_OVERLAP','TEXT_UNREADABLE',
    'TABLE_CLIPPED','HEADER_FOOTER','PAGE_ORDER','MISSING_CONTENT',
    'MARGINS','OTHER_VISUAL_ISSUE'
  ]));
  function denied(job,reason){
    return {
      schema_version:VERSION,
      job_id:ids(job)?job:null,
      state:'blocked',
      page_count_expected:0,pages_recorded:0,
      passed_pages:0,failed_pages:0,pending_pages:0,
      next_action:'repair_private_review_context',
      blocker_codes:[reason],
      visual_qa_approved:false,
      d1_approved:false,d2_approved:false,
      ready_for_issuance:false,issuance_allowed:false
    };
  }
  function formatReview(entry,index,context,pages){
    if(!obj(entry)||Object.keys(entry).some(k=>![
      'schema_version','job_id','draft_revision_id','render_run_id',
      'review_ledger_revision_id','page_number','page_sha256',
      'reviewer_id','reviewer_role','decision','checks','issue_codes'
    ].includes(k))||
    entry.schema_version!==PAGE_VERSION||
    entry.job_id!==context.job_id||
    entry.draft_revision_id!==context.draft_revision_id||
    entry.render_run_id!==context.render_run_id||
    entry.review_ledger_revision_id!==context.review_ledger_revision_id||
    entry.page_number!==index+1||
    entry.page_sha256!==pages[index].sha256||
    entry.reviewer_id!==context.reviewer_id||
    entry.reviewer_role!==context.reviewer_role||
    !['pass','fail','pending'].includes(entry.decision)||
    !obj(entry.checks)||
    Object.keys(entry.checks).length!==checks.length||
    checks.some(k=>!owns(entry.checks,k))||
    !Array.isArray(entry.issue_codes)||
    entry.issue_codes.some(x=>!issueCodes.has(x))||
    new Set(entry.issue_codes).size!==entry.issue_codes.length)
       return false;
    const values=checks.map(k=>entry.checks[k]);
    if(values.some(v=>v!==true&&v!==false&&v!==null))return false;
    if(entry.decision==='pass')return values.every(v=>v===true)&&entry.issue_codes.length===0;
    if(entry.decision==='pending')return values.every(v=>v===null)&&entry.issue_codes.length===0;
    return values.some(v=>v===false)&&entry.issue_codes.length>0;
  }
  function assess(input){
    const {trustedContext,pageReviews}=obj(input)?input:{};
    const c=trustedContext;
    if(!obj(c)||!ids(c.job_id)||!ids(c.draft_revision_id)||
       !ids(c.current_draft_revision_id)||
       !digest(c.draft_sha256)||!digest(c.current_draft_sha256)||
       !ids(c.render_run_id)||!ids(c.current_render_run_id)||
       !ids(c.review_ledger_revision_id)||
       !ids(c.current_review_ledger_revision_id)||
       !ids(c.generator_id)||!ids(c.reviewer_id)||
       c.generator_id===c.reviewer_id||
       c.reviewer_role!=='tecnico'&&c.reviewer_role!=='admin'||
       c.authenticated!==true||c.can_review_visual!==true||
       c.backend_loaded_verified_manifest!==true||
       c.rendered_page_integrity_verified!==true||
       c.render_provenance_verified!==true||
       c.page_count_independently_verified!==true||
       c.render_version_matches_docx!==true||
       c.draft_revision_id!==c.current_draft_revision_id||
       c.draft_sha256.toLowerCase()!==c.current_draft_sha256.toLowerCase()||
       c.render_run_id!==c.current_render_run_id||
       c.review_ledger_revision_id!==c.current_review_ledger_revision_id||
       !Number.isInteger(c.page_count)||c.page_count<1||c.page_count>150||
       !Array.isArray(c.pages)||c.pages.length!==c.page_count||
       c.pages.some((page,i)=>!obj(page)||Object.keys(page).some(k=>!['page_number','sha256'].includes(k))||
         page.page_number!==i+1||!digest(page.sha256))||
       !Array.isArray(pageReviews)||pageReviews.length!==c.page_count)
       return denied(obj(c)?c.job_id:null,'INVALID_OR_STALE_REVIEW_SNAPSHOT');
    for(let i=0;i<pageReviews.length;i++){
      if(!formatReview(pageReviews[i],i,c,c.pages))
        return denied(c.job_id,'INVALID_PAGE_REVIEW_OR_SOURCE');
    }
    const count=x=>pageReviews.filter(r=>r.decision===x).length;
    const passed=count('pass'),failed=count('fail'),pending=count('pending');
    const state=failed?'needs_visual_correction':
      pending?'awaiting_human_page_review':'all_page_reviews_recorded_for_private_qa';
    const blockers=failed?['VISUAL_CORRECTION_REQUIRED']:
      pending?['HUMAN_PAGE_REVIEW_INCOMPLETE']:
      ['PRIVATE_QA_SIGNOFF_REQUIRED'];
    // NEVER accept even perfect page records as D1/D2, official QA or release.
    return {
      schema_version:VERSION,
      job_id:c.job_id,state,
      page_count_expected:c.page_count,
      pages_recorded:pageReviews.length,
      passed_pages:passed,failed_pages:failed,pending_pages:pending,
      next_action:failed?'correct_draft_and_invalidate_review':
        pending?'complete_independent_page_inspection':
        'verify_signed_private_qa_record_and_D1_D2',
      blocker_codes:blockers,
      visual_qa_approved:false,d1_approved:false,d2_approved:false,
      ready_for_issuance:false,issuance_allowed:false
    };
  }
  return Object.freeze({VERSION,PAGE_VERSION,CHECKS:checks,assess});
})();
if(typeof module!=='undefined'&&module.exports)module.exports=duvriWordHumanReviewLedger;
