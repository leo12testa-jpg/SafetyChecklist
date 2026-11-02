/*
 * COLLIGO DUVRI AI — exact evidence-to-extraction text check.
 * Pure, isolated, NO AI/network/Word/storage/issuance.
 *
 * Source facts MUST come from authenticated immutable private backend records,
 * with file integrity, permissions and revision established independently.
 * Exact text equality is a necessary consistency check, NOT proof of truth,
 * professional assessment or authority to act on a finding.
 */
const duvriHseFactMatch = (() => {
  'use strict';
  const VERSION='colligo-duvri-hse-fact-match/1.0';
  const record=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
  const id=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{6,128}$/.test(x);
  const text=(x,max)=>typeof x==='string'&&x.length>0&&x.length<=max&&x.trim().length>0;
  const current=new Set(['current_job_document','current_job_checklist']);
  const types=new Set([...current,'historical_2026_reference','approved_internal_rule']);
  const statuses=new Set(['confirmed','extracted_unconfirmed','requires_verification','historical_example_only']);
  const factKeys=['job_id','analysis_revision_id','extraction_revision_id','source_type',
    'file_id','locator','text','verification_status','backend_verified'];
  const denied=(job,reason)=>({
    schema_version:VERSION,job_id:id(job)?job:null,state:'blocked',
    citations_checked:0,unconfirmed_current_citations:0,has_confirmed_current_citation:false,
    usable_for_hse_review:false,duvri_approved:false,issuance_allowed:false,
    blockers:[reason]
  });
  const authorized=(v)=>Array.isArray(v)&&v.length<=200&&v.every(id)&&new Set(v).size===v.length;
  const key=(e)=>JSON.stringify([e.source_type,e.file_id,e.locator,e.excerpt_or_fact||e.text,e.verification_status]);

  function verify({
    packet,sourceScope,sourceFacts,expectedJobId,
    expectedAnalysisRevisionId,expectedExtractionRevisionId,
    allowedHistoricalReferenceIds=[],allowedInternalRuleIds=[]
  }={}){
    const job=expectedJobId;
    if(!id(job)||!id(expectedAnalysisRevisionId)||!id(expectedExtractionRevisionId)||
      !record(packet)||!record(sourceScope)||
      packet.schema_version!=='colligo-duvri-review-packet/1.0'||
      packet.job_id!==job||packet.analysis_revision_id!==expectedAnalysisRevisionId||
      !['needs_review','awaiting_input'].includes(packet.state)||
      packet.issuance_allowed!==false||packet.human_review_required!==true||
      sourceScope.schema_version!=='colligo-duvri-hse-evidence-scope/1.0'||
      sourceScope.job_id!==job||
      sourceScope.analysis_revision_id!==expectedAnalysisRevisionId||
      sourceScope.extraction_revision_id!==expectedExtractionRevisionId||
      sourceScope.state!=='ready_for_hse_screening'||
      sourceScope.checklist_ready!==true||
      sourceScope.issuance_allowed!==false||
      !authorized(sourceScope.allowed_file_ids)||
      sourceScope.allowed_file_ids.length===0||
      !Array.isArray(sourceScope.withheld_file_ids)||sourceScope.withheld_file_ids.length!==0||
      !Array.isArray(sourceScope.manual_review_file_ids)||sourceScope.manual_review_file_ids.length!==0||
      !authorized(allowedHistoricalReferenceIds)||!authorized(allowedInternalRuleIds)||
      !Array.isArray(packet.findings)||packet.findings.length>300||
      !Array.isArray(packet.conflicts)||packet.conflicts.length>300||
      !Array.isArray(packet.blocking_reasons)||packet.blocking_reasons.length||
      !Array.isArray(packet.pending_agents)||packet.pending_agents.length||
      !Array.isArray(sourceFacts)||sourceFacts.length>3000)
      return denied(job,'STALE_OR_INCOMPLETE_EVIDENCE_CONTEXT');

    const allowed={
      current:new Set(sourceScope.allowed_file_ids),
      historical:new Set(allowedHistoricalReferenceIds),
      rules:new Set(allowedInternalRuleIds)
    };
    if([...allowed.current].some(x=>allowed.historical.has(x)||allowed.rules.has(x))||
       [...allowed.historical].some(x=>allowed.rules.has(x)))
      return denied(job,'OVERLAPPING_SOURCE_AUTHORITIES');

    const group=t=>current.has(t)?allowed.current:
      t==='historical_2026_reference'?allowed.historical:allowed.rules;

    const facts=new Map();
    for(const f of sourceFacts){
      if(!record(f)||Object.keys(f).length!==factKeys.length||
         !Object.keys(f).every(x=>factKeys.includes(x))||
         f.job_id!==job||
         f.analysis_revision_id!==expectedAnalysisRevisionId||
         f.extraction_revision_id!==expectedExtractionRevisionId||
         !types.has(f.source_type)||!id(f.file_id)||
         !group(f.source_type).has(f.file_id)||
         !text(f.locator,1000)||!text(f.text,2000)||
         !statuses.has(f.verification_status)||
         (f.source_type==='historical_2026_reference')!==
           (f.verification_status==='historical_example_only')||
         f.backend_verified!==true)
        return denied(job,'INVALID_OR_UNAUTHORIZED_SOURCE_FACT');
      const k=key(f);
      if(facts.has(k))return denied(job,'DUPLICATE_SOURCE_FACT');
      facts.set(k,f);
    }

    const refs=[];
    const collect=items=>{
      for(const item of items){
        if(!record(item)||!Array.isArray(item.source_evidence)||
           item.source_evidence.length===0||item.source_evidence.length>50)
          return false;
        refs.push(...item.source_evidence);
      }
      return true;
    };
    const conflicts=[];
    for(const c of packet.conflicts){
      if(!record(c)||!Array.isArray(c.evidence)||c.evidence.length<2||
         c.evidence.length>50)
        return denied(job,'INVALID_CONFLICT_REFERENCES');
      conflicts.push(...c.evidence);
    }
    if(!collect(packet.findings))return denied(job,'INVALID_FINDING_REFERENCES');
    refs.push(...conflicts);
    if(refs.length===0)return {
      ...denied(job,'NO_CITATIONS_TO_VERIFY'),state:'awaiting_evidence'
    };
    if(refs.length>3000)return denied(job,'TOO_MANY_CITATIONS');

    const unanchoredFindings=packet.findings.filter(f=>!f.source_evidence.some(e=>
      record(e)&&current.has(e.source_type)&&e.verification_status==='confirmed')).length;
    const unanchoredConflicts=packet.conflicts.filter(c=>
      c.evidence.filter(e=>record(e)&&current.has(e.source_type)&&e.verification_status==='confirmed').length<2).length;
    let unconfirmed=0,confirmedCurrent=0;
    for(const e of refs){
      if(!record(e)||!types.has(e.source_type)||!id(e.file_id)||
         !group(e.source_type).has(e.file_id)||
         !text(e.locator,1000)||!text(e.excerpt_or_fact,2000)||
         !statuses.has(e.verification_status)||
         (e.source_type==='historical_2026_reference')!==
           (e.verification_status==='historical_example_only'))
        return denied(job,'INVALID_CITATION');
      if(!facts.has(key(e)))return denied(job,'CITATION_TEXT_NOT_IN_TRUSTED_EXTRACTION');
      if(current.has(e.source_type)){
        if(e.verification_status==='confirmed')confirmedCurrent++;
        else unconfirmed++;
      }
    }
    if(confirmedCurrent===0||unconfirmed>0||unanchoredFindings>0||unanchoredConflicts>0)return {
      schema_version:VERSION,job_id:job,state:'citations_need_confirmation',
      citations_checked:refs.length,unconfirmed_current_citations:unconfirmed,
      has_confirmed_current_citation:confirmedCurrent>0,
      usable_for_hse_review:false,duvri_approved:false,issuance_allowed:false,
      blockers:[confirmedCurrent===0?'NO_CONFIRMED_CURRENT_EVIDENCE':
        unanchoredFindings>0?'FINDING_NOT_GROUNDED_IN_CONFIRMED_CURRENT_SOURCE':
        unanchoredConflicts>0?'CONFLICT_NOT_GROUNDED_IN_TWO_CURRENT_SOURCES':
        'CURRENT_EVIDENCE_UNCONFIRMED']
    };
    const reviewReady=packet.state==='needs_review' &&
      packet.conflicts.length===0 &&
      Array.isArray(packet.missing_information) &&
      !packet.missing_information.some(x=>record(x)&&x.blocking===true) &&
      Array.isArray(packet.screening_required) &&
      packet.screening_required.length===0;
    return {
      schema_version:VERSION,job_id:job,
      state:reviewReady?'exact_citations_matched_for_review':
        'citations_matched_awaiting_hse_resolution',
      citations_checked:refs.length,unconfirmed_current_citations:0,
      has_confirmed_current_citation:true,
      usable_for_hse_review:reviewReady,duvri_approved:false,
      issuance_allowed:false,
      blockers:reviewReady?[]:['OPEN_HSE_REVIEW_INPUT']
    };
  }
  return Object.freeze({VERSION,verify});
})();
if(typeof module!=='undefined'&&module.exports)module.exports=duvriHseFactMatch;
