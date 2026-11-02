/*
 * COLLIGO DUVRI AI — downstream invalidation planner (isolated v1).
 * NO database, AI, file manipulation, Word generation, network or issuance.
 *
 * Trust boundary: previous/current snapshots and trustedContext must come
 * from authenticated immutable backend storage. This function does not
 * authenticate, verify SHA contents, commit invalidations, or lock records.
 * The backend MUST apply all affected invalidations atomically via CAS.
 */
const duvriRevisionInvalidation=(()=>{
  'use strict';
  const VERSION='colligo-duvri-invalidation-plan/1.0';
  const id=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{6,128}$/.test(x);
  const sha=x=>typeof x==='string'&&/^[0-9a-f]{64}$/i.test(x);
  const record=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
  const FIELDS=Object.freeze([
    'manifest_sha256',
    'extraction_revision_id',
    'ocr_confirmation_revision_id',
    'source_scope_revision_id',
    'screening_revision_id',
    'analysis_revision_id',
    'packet_sha256',
    'clarification_register_sha256',
    'clarification_routing_revision_id',
    'hse_review_revision_id',
    'template_sha256',
    'mapping_revision_id',
    'risk_method_revision_id',
    'provider_config_revision_id'
  ]);
  const HASHES=new Set(['manifest_sha256','packet_sha256',
    'clarification_register_sha256','template_sha256']);
  // Dependency graph, with intentionally conservative invalidation.
  // A changed source/approval never silently carries an older analysis forward.
  const DEPS=Object.freeze({
    manifest_sha256:['extraction','ocr_confirmation','source_scope','screening',
      'ai_preflight','specialist_analysis','fact_match','clarification_register',
      'clarification_routing','hse_review','word_draft','word_qa','technical_preflight'],
    extraction_revision_id:['ocr_confirmation','source_scope','screening',
      'ai_preflight','specialist_analysis','fact_match','clarification_register',
      'clarification_routing','hse_review','word_draft','word_qa','technical_preflight'],
    ocr_confirmation_revision_id:['source_scope','screening',
      'ai_preflight','specialist_analysis','fact_match','clarification_register',
      'clarification_routing','hse_review','word_draft','word_qa','technical_preflight'],
    source_scope_revision_id:['screening','ai_preflight','specialist_analysis',
      'fact_match','clarification_register','clarification_routing',
      'hse_review','word_draft','word_qa','technical_preflight'],
    screening_revision_id:['ai_preflight','specialist_analysis',
      'fact_match','clarification_register','clarification_routing',
      'hse_review','word_draft','word_qa','technical_preflight'],
    analysis_revision_id:['ai_preflight','specialist_analysis',
      'fact_match','clarification_register','clarification_routing',
      'hse_review','word_draft','word_qa','technical_preflight'],
    packet_sha256:['fact_match','clarification_register',
      'clarification_routing','hse_review','word_draft','word_qa','technical_preflight'],
    clarification_register_sha256:['clarification_routing',
      'hse_review','word_draft','word_qa','technical_preflight'],
    clarification_routing_revision_id:['hse_review','word_draft',
      'word_qa','technical_preflight'],
    hse_review_revision_id:['word_draft','word_qa','technical_preflight'],
    template_sha256:['word_draft','word_qa','technical_preflight'],
    mapping_revision_id:['word_draft','word_qa','technical_preflight'],
    risk_method_revision_id:['risk_review','word_draft',
      'word_qa','technical_preflight'],
    provider_config_revision_id:['ai_preflight','specialist_analysis',
      'fact_match','clarification_register','clarification_routing',
      'hse_review','word_draft','word_qa','technical_preflight']
  });
  const ORDER=Object.freeze([
    'extraction','ocr_confirmation','source_scope','screening','ai_preflight',
    'specialist_analysis','fact_match','clarification_register',
    'clarification_routing','hse_review','risk_review',
    'word_draft','word_qa','technical_preflight'
  ]);
  const denied=(job,code)=>({
    schema_version:VERSION,job_id:id(job)?job:null,state:'blocked',
    from_revision_id:null,to_revision_id:null,changed_fields:[],
    invalidate_artifacts:[],invalidate_count:0,
    cas_required:true,plan_applied:false,persist_allowed:false,
    reanalysis_completed:false,duvri_approved:false,issuance_allowed:false,
    blockers:[code]
  });
  const normalized=(o)=>record(o)&&Object.keys(o).length===FIELDS.length+2&&
    Object.keys(o).every(k=>k==='job_id'||k==='snapshot_revision_id'||FIELDS.includes(k))&&
    id(o.job_id)&&id(o.snapshot_revision_id)&&FIELDS.every(k=>
      Object.prototype.hasOwnProperty.call(o,k)&&
      (o[k]===null||(HASHES.has(k)?sha(o[k]):id(o[k]))))&&sha(o.manifest_sha256);
  function plan({previous,current,trustedContext}={}){
    const job=record(previous)?previous.job_id:null;
    if(!normalized(previous)||!normalized(current)||
      previous.job_id!==current.job_id)
      return denied(job,'INVALID_OR_CROSS_JOB_SNAPSHOTS');
    const c=trustedContext;
    if(!record(c)||Object.keys(c).some(k=>![
      'job_id','expected_previous_revision_id','current_snapshot_revision_id',
      'authenticated','can_update_fascicolo',
      'previous_snapshot_server_verified','current_snapshot_server_verified'
    ].includes(k))||
      c.job_id!==job||
      c.expected_previous_revision_id!==previous.snapshot_revision_id||
      c.current_snapshot_revision_id!==current.snapshot_revision_id||
      c.authenticated!==true||c.can_update_fascicolo!==true||
      c.previous_snapshot_server_verified!==true||
      c.current_snapshot_server_verified!==true)
      return denied(job,'UNTRUSTED_OR_STALE_CAS_CONTEXT');

    const changes=FIELDS.filter(k=>previous[k]!==current[k]);
    if(changes.length>0&&previous.snapshot_revision_id===current.snapshot_revision_id)
      return denied(job,'CHANGES_WITHOUT_NEW_SNAPSHOT_REVISION');
    if(changes.length===0&&previous.snapshot_revision_id!==current.snapshot_revision_id)
      return denied(job,'REVISION_ADVANCED_WITHOUT_DECLARED_DEPENDENCY_CHANGE');

    const affected=new Set(changes.flatMap(k=>DEPS[k]));
    const invalidate=ORDER.filter(k=>affected.has(k));
    return {
      schema_version:VERSION,job_id:job,
      state:changes.length?'invalidation_required':'no_dependency_change',
      from_revision_id:previous.snapshot_revision_id,
      to_revision_id:current.snapshot_revision_id,
      changed_fields:changes,
      invalidate_artifacts:invalidate,
      invalidate_count:invalidate.length,
      cas_required:true,plan_applied:false,persist_allowed:false,
      reanalysis_completed:false,duvri_approved:false,issuance_allowed:false,
      blockers:[]
    };
  }
  return Object.freeze({VERSION,FIELDS,ORDER,plan});
})();
if(typeof module!=='undefined'&&module.exports)module.exports=duvriRevisionInvalidation;
