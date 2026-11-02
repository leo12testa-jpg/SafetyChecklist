/*
 * COLLIGO DUVRI AI — technician-only routing of a validated clarification register.
 *
 * This is a DRAFT of routing decisions, never a client dispatch, resolution
 * of an HSE finding, or approval of the Word/DUVRI.
 *
 * Trust boundary: the backend must load the immutable register and reviewer's
 * context from private authenticated storage; independently recalculate and
 * verify the exact register digest and implement transaction/CAS + audit.
 * Never trust browser- or LLM-provided "verified" booleans.
 */
const duvriClarificationTriage = (() => {
  'use strict';
  const VERSION = 'colligo-duvri-clarification-triage/1.0';
  const REGISTER_VERSION = 'colligo-duvri-clarification-register/1.0';
  const ROUTES = Object.freeze(['ask_client','investigate_internally','hold_for_reanalysis']);
  const KINDS = new Set([
    'screening_confirmation','missing_information','conflicting_sources',
    'finding_clarification'
  ]);
  const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
  const id = x => typeof x === 'string' && /^[A-Za-z0-9_-]{6,128}$/.test(x);
  const requestId = x => typeof x === 'string' && /^REQ_[0-9]{4}$/.test(x);
  const sha = x => typeof x === 'string' && /^[a-fA-F0-9]{64}$/.test(x);
  const count = x => Number.isInteger(x) && x >= 0 && x <= 300;
  const note = x => typeof x === 'string' && x.trim().length > 0 && x.length <= 2000;

  function blocked(jobId,code) {
    return {
      schema_version:VERSION,job_id:id(jobId)?jobId:null,
      analysis_revision_id:null,extraction_revision_id:null,
      register_revision_id:null,reviewer_id:null,
      state:'blocked',routed_to_client_ids:[],
      routed_to_internal_ids:[],held_for_reanalysis_ids:[],
      pending_request_ids:[],open_blocking_request_ids:[],
      client_dispatch_allowed:false,clarifications_resolved:false,
      ready_for_technical_preflight:false,duvri_approved:false,
      issuance_allowed:false,errors:[code]
    };
  }

  function prepareRouting({
    register,decisions,reviewerContext,
    expectedJobId,expectedAnalysisRevisionId,
    expectedExtractionRevisionId,expectedRegisterRevisionId
  }={}) {
    const jobId=object(register)?register.job_id:null;
    const c=reviewerContext;
    if(!id(expectedJobId) || !id(expectedAnalysisRevisionId) ||
       !id(expectedExtractionRevisionId) || !id(expectedRegisterRevisionId) ||
       !object(register) || !object(c) ||
       register.schema_version!==REGISTER_VERSION ||
       register.job_id!==expectedJobId ||
       register.analysis_revision_id!==expectedAnalysisRevisionId ||
       register.extraction_revision_id!==expectedExtractionRevisionId ||
       !['needs_technical_triage','no_open_requests'].includes(register.state) ||
       register.human_review_required!==true ||
       register.client_dispatch_allowed!==false ||
       register.ready_for_technical_preflight!==false ||
       register.issuance_allowed!==false ||
       typeof register.blocks_document_draft!=='boolean' ||
       !Array.isArray(register.blockers) || register.blockers.length!==0 ||
       !Array.isArray(register.items) || register.items.length>300 ||
       !count(register.item_count) ||
       !count(register.blocking_count) ||
       register.item_count!==register.items.length ||
       (register.state==='needs_technical_triage' && register.items.length===0) ||
       (register.state==='no_open_requests' && register.items.length!==0) ||
       !id(c.job_id) || c.job_id!==expectedJobId ||
       c.analysis_revision_id!==expectedAnalysisRevisionId ||
       c.extraction_revision_id!==expectedExtractionRevisionId ||
       c.register_revision_id!==expectedRegisterRevisionId ||
       c.current_register_revision_id!==expectedRegisterRevisionId ||
       !sha(c.register_sha256) || !sha(c.current_register_sha256) ||
       c.register_sha256.toLowerCase()!==c.current_register_sha256.toLowerCase() ||
       c.register_sha256_verified!==true ||
       !id(c.reviewer_id) || c.authenticated!==true ||
       c.can_triage!==true || !['tecnico','admin'].includes(c.role)) {
      return blocked(jobId,'STALE_OR_UNVERIFIED_TRIAGE_CONTEXT');
    }

    const requests=new Set(),blocking=[];
    for(const item of register.items) {
      if(!object(item) || !requestId(item.request_id) ||
         requests.has(item.request_id) || !KINDS.has(item.kind) ||
         item.requires_technical_review!==true ||
         item.client_dispatch_allowed!==false ||
         typeof item.blocking!=='boolean') {
        return blocked(jobId,'INVALID_CLARIFICATION_REGISTER');
      }
      requests.add(item.request_id);
      if(item.blocking) blocking.push(item.request_id);
    }
    if(register.blocking_count!==blocking.length ||
       (blocking.length>0 && register.blocks_document_draft!==true)) {
      return blocked(jobId,'INCONSISTENT_BLOCKING_CLARIFICATIONS');
    }

    if(!Array.isArray(decisions) || decisions.length>requests.size) {
      return blocked(jobId,'INVALID_ROUTING_DECISIONS');
    }
    const seen=new Set(),toClient=[],toInternal=[],toReanalysis=[];
    for(const choice of decisions) {
      if(!object(choice) ||
         Object.keys(choice).some(k=>!['request_id','route','note'].includes(k)) ||
         !requestId(choice.request_id) || !requests.has(choice.request_id) ||
         seen.has(choice.request_id) || !ROUTES.includes(choice.route) ||
         (choice.note!==undefined &&
           (typeof choice.note!=='string' || choice.note.length>2000)) ||
         (choice.route!=='ask_client' && !note(choice.note))) {
        return blocked(jobId,'INVALID_OR_DUPLICATE_ROUTE');
      }
      seen.add(choice.request_id);
      if(choice.route==='ask_client') toClient.push(choice.request_id);
      if(choice.route==='investigate_internally') toInternal.push(choice.request_id);
      if(choice.route==='hold_for_reanalysis') toReanalysis.push(choice.request_id);
    }
    const pending=[...requests].filter(x=>!seen.has(x));
    // Routing is never a resolution of the question itself. The technician
    // must review the new evidence and run a new HSE analysis.
    return {
      schema_version:VERSION,job_id:expectedJobId,
      analysis_revision_id:expectedAnalysisRevisionId,
      extraction_revision_id:expectedExtractionRevisionId,
      register_revision_id:expectedRegisterRevisionId,reviewer_id:c.reviewer_id,
      state:register.items.length===0?'no_open_requests':
        pending.length?'awaiting_routing_decisions':'routing_reviewed',
      routed_to_client_ids:toClient,routed_to_internal_ids:toInternal,
      held_for_reanalysis_ids:toReanalysis,pending_request_ids:pending,
      open_blocking_request_ids:blocking,
      client_dispatch_allowed:false,clarifications_resolved:false,
      ready_for_technical_preflight:false,duvri_approved:false,
      issuance_allowed:false,errors:[]
    };
  }
  return Object.freeze({VERSION,ROUTES,prepareRouting});
})();
if(typeof module!=='undefined' && module.exports)module.exports=duvriClarificationTriage;
