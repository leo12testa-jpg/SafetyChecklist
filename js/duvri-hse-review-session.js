/*
 * COLLIGO DUVRI AI — independent review session integrity gate.
 * The current job, files and review records MUST be loaded from authenticated,
 * immutable backend storage. No browser/LLM claim is proof of approval, digest,
 * extraction, document version, identity or permission.
 *
 * This module only performs a deterministic preflight before recording HSE
 * decisions; it cannot authorize or issue any DUVRI.
 */
const duvriHseReviewSession = (() => {
  'use strict';
  const review = typeof require === 'function'
    ? require('./duvri-hse-review.js')
    : (typeof duvriHseReview !== 'undefined' ? duvriHseReview : null);
  const object = x => !!x && typeof x==='object' && !Array.isArray(x);
  const identifier = x => typeof x==='string' && /^[A-Za-z0-9_-]{6,128}$/.test(x);
  const sha256 = x => typeof x==='string' && /^[a-f0-9]{64}$/i.test(x);
  const findingId = x => typeof x==='string' && /^[A-Za-z0-9_-]{1,128}$/.test(x);
  const sourcesCurrent = new Set(['current_job_document','current_job_checklist']);
  const sourcesHistory = 'historical_2026_reference';
  const sourcesRule = 'approved_internal_rule';
  const denied = (jobId,code) => ({
    schema_version:'colligo-duvri-hse-review-session/1.0',
    job_id:identifier(jobId)?jobId:null,
    state:'blocked',review:null,blockers:[code],
    duvri_approved:false,issuance_allowed:false
  });
  const wellFormedSet = value => Array.isArray(value) &&
    value.every(identifier) && new Set(value).size === value.length;

  function assessReviewSession({packet,sourceScope,decisions,reviewerContext}={}) {
    const jobId=object(packet)?packet.job_id:null;
    if (!review || !object(packet) || !object(sourceScope) || !object(reviewerContext))
      return denied(jobId,'MISSING_TRUSTED_CONTEXT');
    const c=reviewerContext;
    if (!identifier(jobId) || !identifier(packet.analysis_revision_id) ||
        !identifier(packet.packet_revision_id) || !sha256(packet.packet_sha256) ||
        !identifier(c.document_revision_id) ||
        !identifier(c.current_document_revision_id) ||
        c.document_revision_id !== c.current_document_revision_id ||
        c.job_id !== jobId ||
        c.analysis_revision_id !== packet.analysis_revision_id ||
        c.current_analysis_revision_id !== packet.analysis_revision_id ||
        c.current_packet_revision_id !== packet.packet_revision_id ||
        !sha256(c.current_packet_sha256) ||
        c.current_packet_sha256.toLowerCase() !== packet.packet_sha256.toLowerCase() ||
        c.packet_sha256_verified !== true ||
        c.authenticated !== true || c.can_review !== true ||
        !identifier(c.reviewer_id) ||
        !['tecnico','admin'].includes(c.role)) {
      return denied(jobId,'STALE_OR_UNVERIFIED_REVIEW_SNAPSHOT');
    }
    if (sourceScope.schema_version !== 'colligo-duvri-hse-evidence-scope/1.0' ||
        sourceScope.state !== 'ready_for_hse_screening' ||
        sourceScope.job_id !== jobId ||
        sourceScope.analysis_revision_id !== packet.analysis_revision_id ||
        !identifier(sourceScope.extraction_revision_id) ||
        sourceScope.extraction_revision_id !== c.current_extraction_revision_id ||
        !Array.isArray(sourceScope.withheld_file_ids) ||
        sourceScope.withheld_file_ids.length !== 0 ||
        !Array.isArray(sourceScope.manual_review_file_ids) ||
        sourceScope.manual_review_file_ids.length !== 0 ||
        sourceScope.checklist_ready !== true ||
        sourceScope.issuance_allowed !== false ||
        !wellFormedSet(sourceScope.allowed_file_ids) ||
        sourceScope.allowed_file_ids.length===0) {
      return denied(jobId,'INCOMPLETE_OR_STALE_SOURCES');
    }
    const historical=c.allowed_historical_reference_ids || [];
    const internal=c.allowed_internal_rule_ids || [];
    if (!wellFormedSet(historical) || !wellFormedSet(internal)) {
      return denied(jobId,'INVALID_SOURCE_AUTHORITIES');
    }
    const current=new Set(sourceScope.allowed_file_ids);
    const history=new Set(historical);
    const rules=new Set(internal);
    if ([...current].some(x=>history.has(x)||rules.has(x)) ||
        [...history].some(x=>rules.has(x))) {
      return denied(jobId,'OVERLAPPING_SOURCE_AUTHORITIES');
    }
    if (!Array.isArray(packet.findings) || !Array.isArray(decisions))
      return denied(jobId,'MISSING_FINDINGS_OR_DECISIONS');
    const keys=new Map();
    for(const f of packet.findings){
      if (!object(f) || !identifier(f.agent_id) || !findingId(f.finding_id) ||
          !Array.isArray(f.source_evidence)) {
        return denied(jobId,'INVALID_FINDING_PROVENANCE');
      }
      const key=f.agent_id+'\u0000'+f.finding_id;
      if(keys.has(key)) return denied(jobId,'DUPLICATE_FINDING');
      const records=f.source_evidence;
      if (records.length===0 || records.some(x=>!object(x) ||
        !identifier(x.file_id) ||
        typeof x.locator !== 'string' || !x.locator.trim() ||
        x.locator.length > 1000 ||
        !['confirmed','extracted_unconfirmed','historical_example_only',
          'requires_verification'].includes(x.verification_status) ||
        !(sourcesCurrent.has(x.source_type) || x.source_type===sourcesHistory ||
          x.source_type===sourcesRule))) {
        return denied(jobId,'INVALID_FINDING_PROVENANCE');
      }
      for (const e of records){
        const group=sourcesCurrent.has(e.source_type)?current:
          e.source_type===sourcesHistory?history:rules;
        if(!group.has(e.file_id)) return denied(jobId,'UNAUTHORIZED_FINDING_SOURCE');
        if(e.source_type===sourcesHistory &&
           e.verification_status!=='historical_example_only')
          return denied(jobId,'HISTORICAL_SOURCE_MISLABELED');
        if(e.source_type!==sourcesHistory &&
           e.verification_status==='historical_example_only')
          return denied(jobId,'CURRENT_SOURCE_MISLABELED');
      }
      keys.set(key,records);
    }
    for(const d of decisions){
      if (!object(d)) return denied(jobId,'INVALID_DECISION');
      if(d.action!=='accept_for_draft') continue;
      const refs=keys.get(d.agent_id+'\u0000'+d.finding_id);
      // The specialist must show confirmed, case-local evidence before
      // its finding can enter a draft. Histories or internal rules alone fail.
      if(!refs || !refs.some(e=>sourcesCurrent.has(e.source_type) &&
        e.verification_status==='confirmed'))
        return denied(jobId,'ACCEPTED_FINDING_UNCONFIRMED');
    }
    const result=review.prepareReviewDecisions({
      packet,decisions,
      reviewerContext:{
        job_id:jobId,analysis_revision_id:packet.analysis_revision_id,
        document_revision_id:c.document_revision_id,
        reviewer_id:c.reviewer_id,
        role:c.role,authenticated:true,can_review:true
      }
    });
    if(result.state==='blocked')
      return denied(jobId,'REVIEW_DECISIONS_INVALID');
    return {
      schema_version:'colligo-duvri-hse-review-session/1.0',
      job_id:jobId,state:result.state,
      packet_revision_id:packet.packet_revision_id,
      packet_sha256:packet.packet_sha256.toLowerCase(),
      analysis_revision_id:packet.analysis_revision_id,
      extraction_revision_id:sourceScope.extraction_revision_id,
      document_revision_id:c.document_revision_id,
      review:result,blockers:[],
      duvri_approved:false,issuance_allowed:false
    };
  }
  return Object.freeze({assessReviewSession});
})();
if(typeof module!=='undefined'&&module.exports)module.exports=duvriHseReviewSession;
