/*
 * Colligo DUVRI AI — pure dossier->HSE reviewer flow composer.
 *
 * NO file IO, OCR, model calls, database access, emails, Word generation,
 * security grant, or issuance. Sources, permissions, revision SHA, agent
 * outputs and reviewer identity MUST be verified by the PRIVATE BACKEND.
 * Never expose this function as a client-authoritative approval endpoint.
 */
const duvriReviewFlowComposer=(()=>{
  'use strict';
  const scopeApi=typeof require==='function'?require('./duvri-hse-evidence-scope.js'):duvriHseEvidenceScope;
  const hseApi=typeof require==='function'?require('./duvri-hse-pipeline.js'):duvriHsePipeline;
  const factApi=typeof require==='function'?require('./duvri-hse-fact-match.js'):duvriHseFactMatch;
  const registerApi=typeof require==='function'?require('./duvri-clarification-register.js'):duvriClarificationRegister;
  const routingApi=typeof require==='function'?require('./duvri-clarification-triage.js'):duvriClarificationTriage;
  const reviewApi=typeof require==='function'?require('./duvri-hse-review-session.js'):duvriHseReviewSession;
  const VERSION='colligo-duvri-review-flow/1.0';
  const id=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{6,128}$/.test(x);
  const obj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
  function result(job,code){
    return {
      schema_version:VERSION,job_id:id(job)?job:null,state:code==='INVALID_FLOW_INPUT'?'blocked':'awaiting_documents',
      stages:{extraction:'blocked',hse_analysis:'not_started',
        citation_match:'not_started',clarification_register:'not_started',
        clarification_routing:'not_started',technical_review:'not_started',
        word_qa:'not_started',provider_ai:'disabled'},
      finding_count:0,question_count:0,
      next_action:code==='INVALID_FLOW_INPUT'?'check_backend_request':'complete_document_extraction',
      blocker_codes:[code],client_dispatch_allowed:false,
      provider_dispatch_allowed:false,document_draft_allowed:false,
      duvri_approved:false,issuance_allowed:false
    };
  }
  function assemble({
    jobId,analysisRevisionId,extractionRevisionId,
    files,extractions,screeningAnswers,agentResults,sourceFacts,
    allowedHistoricalReferenceIds=[],allowedInternalRuleIds=[],
    routingDecisions,routerContext,reviewDecisions,reviewerContext
  }={}){
    if(!id(jobId)||!id(analysisRevisionId)||!id(extractionRevisionId)||
       !Array.isArray(files)||!Array.isArray(extractions)||
       !Array.isArray(screeningAnswers)||!Array.isArray(agentResults)||
       !Array.isArray(sourceFacts)||
       !Array.isArray(allowedHistoricalReferenceIds)||
       !Array.isArray(allowedInternalRuleIds))
      return result(jobId,'INVALID_FLOW_INPUT');

    const steps={
      extraction:'blocked',hse_analysis:'not_started',citation_match:'not_started',
      clarification_register:'not_started',clarification_routing:'not_started',
      technical_review:'not_started',word_qa:'not_started',provider_ai:'disabled'
    };
    const out={
      schema_version:VERSION,job_id:jobId,state:'awaiting_documents',stages:steps,
      finding_count:0,question_count:0,next_action:'complete_document_extraction',
      blocker_codes:[],client_dispatch_allowed:false,
      provider_dispatch_allowed:false,document_draft_allowed:false,
      duvri_approved:false,issuance_allowed:false
    };
    try{
      const scope=scopeApi.buildHseEvidenceScope({
        jobId,analysisRevisionId,extractionRevisionId,files,extractions
      });
      steps.extraction=scope.state;
      if(scope.state!=='ready_for_hse_screening'){
        out.blocker_codes=['DOCUMENT_SCOPE_NOT_READY'];
        return out;
      }
      const packet=hseApi.aggregateEvidenceGated({
        jobId,analysisRevisionId,screeningAnswers,
        allowedFileIds:scope.allowed_file_ids,agentResults,
        allowedHistoricalReferenceIds,allowedInternalRuleIds
      });
      steps.hse_analysis=packet.state;
      if(packet.state==='blocked'){
        out.state='blocked';
        out.next_action='correct_hse_input';
        out.blocker_codes=['HSE_PIPELINE_BLOCKED'];
        return out;
      }
      out.finding_count=Array.isArray(packet.findings)?packet.findings.length:0;
      const proof=factApi.verify({
        packet,sourceScope:scope,sourceFacts,
        expectedJobId:jobId,
        expectedAnalysisRevisionId:analysisRevisionId,
        expectedExtractionRevisionId:extractionRevisionId,
        allowedHistoricalReferenceIds,allowedInternalRuleIds
      });
      steps.citation_match=proof.state;
      if(proof.state==='blocked'){
        out.state='blocked';
        out.next_action='reconcile_source_citations';
        out.blocker_codes=['UNTRUSTED_HSE_CITATIONS'];
        return out;
      }
      const registry=registerApi.buildClarificationRegister({
        packet,sourceScope:scope,
        expectedJobId:jobId,
        expectedAnalysisRevisionId:analysisRevisionId,
        expectedExtractionRevisionId:extractionRevisionId
      });
      steps.clarification_register=registry.state;
      if(registry.state==='blocked'){
        out.state='blocked';
        out.next_action='rebuild_clarification_register';
        out.blocker_codes=['CLARIFICATION_REGISTER_BLOCKED'];
        return out;
      }
      out.question_count=registry.item_count;
      if(routerContext!==undefined||routingDecisions!==undefined){
        const triage=routingApi.prepareRouting({
          register:registry,decisions:routingDecisions,reviewerContext:routerContext,
          expectedJobId:jobId,expectedAnalysisRevisionId:analysisRevisionId,
          expectedExtractionRevisionId:extractionRevisionId,
          expectedRegisterRevisionId:obj(routerContext)?
            routerContext.current_register_revision_id:null
        });
        steps.clarification_routing=triage.state;
        if(triage.state==='blocked'){
          out.state='blocked';
          out.next_action='verify_technician_triage';
          out.blocker_codes=['CLARIFICATION_ROUTING_BLOCKED'];
          return out;
        }
      }
      if(packet.state!=='needs_review'||proof.state!=='exact_citations_matched_for_review'||
         registry.state!=='no_open_requests'){
        out.state='awaiting_clarifications';
        out.next_action='resolve_documented_hse_questions';
        out.blocker_codes=['HSE_REVIEW_NOT_READY'];
        return out;
      }
      if(reviewerContext===undefined||reviewDecisions===undefined){
        out.state='awaiting_technician_review';
        out.next_action='technician_review_required';
        out.blocker_codes=['TECHNICIAN_REVIEW_REQUIRED'];
        return out;
      }
      const review=reviewApi.assessReviewSession({
        packet,sourceScope:scope,decisions:reviewDecisions,reviewerContext
      });
      steps.technical_review=review.state;
      if(review.state==='blocked'){
        out.state='blocked';
        out.next_action='refresh_hse_review_snapshot';
        out.blocker_codes=['STALE_OR_INVALID_HSE_REVIEW'];
        return out;
      }
      if(review.state!=='draft_findings_reviewed'){
        out.state='awaiting_technician_review';
        out.next_action='complete_technician_decisions';
        out.blocker_codes=['TECHNICIAN_REVIEW_INCOMPLETE'];
        return out;
      }
      // Even a successful technician review is only an intermediate output.
      // D1/D2 and independent Word QA must be verified in the private backend.
      out.state='reviewed_for_synthetic_draft';
      out.next_action='private_word_compiler_and_D1_D2_gate';
      out.blocker_codes=['D1_D2_WORD_QA_REQUIRED'];
      return out;
    }catch(_){
      // Never leak raw error text, source facts, customer docs, or stack traces.
      return {
        ...result(jobId,'INVALID_FLOW_INPUT'),state:'blocked',
        next_action:'inspect_private_backend_logs',
        blocker_codes:['FLOW_EXECUTION_FAILED']
      };
    }
  }
  return Object.freeze({VERSION,assemble});
})();
if(typeof module!=='undefined'&&module.exports)module.exports=duvriReviewFlowComposer;
