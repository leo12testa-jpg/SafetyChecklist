/*
 * Colligo DUVRI — safe HSE agent activation preparation, version 1.
 *
 * This module NEVER calls a provider, dispatches tasks, writes to DB,
 * transfers data, approves HSE findings or authorizes DUVRI issuance.
 * Inputs (sourceScope, approvals and runtime) must come from the PRIVATE
 * authenticated backend. A positive preflight is NOT an authorization token.
 */
const duvriAgentActivationPreparation=(()=>{
  'use strict';
  const instructions=typeof require==='function'
    ?require('./duvri-hse-agent-instructions.js'):duvriHseAgentInstructions;
  const preflight=typeof require==='function'
    ?require('./duvri-ai-execution-preflight.js'):duvriAiExecutionPreflight;
  const VERSION='colligo-duvri-agent-activation-preparation/1.0';
  const ID=/^[A-Za-z0-9_-]{6,128}$/;
  const id=x=>typeof x==='string'&&ID.test(x);
  const obj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
  function result(jobId,state,phase,agentIds,next,blockers,extra={}){
    return {
      schema_version:VERSION,
      job_id:id(jobId)?jobId:null,
      state,phase,
      selected_agent_ids:[...agentIds],
      next_agent_ids:[...next],
      blocker_codes:[...blockers],
      requires_human_hse_review:true,
      requires_d1_d2:true,
      provider_dispatch_allowed:false,
      external_data_transfer_allowed:false,
      document_draft_allowed:false,
      hse_approved:false,
      issuance_allowed:false,
      ...extra
    };
  }
  const block=(job,code)=>result(job,'blocked','halt',[],[],[code]);
  function prepare(input){
    const a=obj(input)?input:{};
    const allowed=[
      'jobId','analysisRevisionId','extractionRevisionId','sourceScope',
      'screeningSignals','mode','provider','authorization','budget','runtime'
    ];
    if(Object.keys(a).some(k=>!allowed.includes(k)))
      return block(a.jobId,'UNEXPECTED_ACTIVATION_PARAMETER');
    const {jobId,analysisRevisionId,extractionRevisionId,
      sourceScope,screeningSignals,mode}=a;
    if(!id(jobId)||!id(analysisRevisionId)||!id(extractionRevisionId))
      return block(jobId,'INVALID_JOB_OR_REVISION');
    if(mode!=='synthetic_preparation'&&mode!=='private_provider_review')
      return block(jobId,'UNSUPPORTED_OR_UNAUTHORIZED_ACTIVATION_MODE');
    let staged;
    try{
      staged=instructions.stage({jobId,analysisRevisionId,
        extractionRevisionId,sourceScope,screeningSignals});
    }catch(_){return block(jobId,'TASK_STAGING_FAILED');}
    if(staged.state!=='tasks_staged_for_private_backend'||
       staged.provider_dispatch_allowed!==false||
       staged.external_data_transfer_allowed!==false||
       staged.issuance_allowed!==false||
       !Array.isArray(staged.agent_tasks)||
       staged.agent_tasks.length!==staged.selected_agents.length)
      return block(jobId,'TASK_STAGING_NOT_READY');
    const ids=staged.selected_agents;
    if(!ids.includes('documentale')||!ids.includes('normativa')||
       !ids.includes('coordinamento')||
       ids.length!==new Set(ids).size)
      return block(jobId,'INVALID_SPECIALIST_ROSTER');
    const next=['documentale','normativa'];
    if(mode==='synthetic_preparation'){
      // The private backend still must execute an opt-in synthetic harness.
      // NO result text is fabricated and NO provider is invoked here.
      return result(jobId,'synthetic_tasks_prepared','foundation',
        ids,next,['PRIVATE_SYNTHETIC_EXECUTOR_REQUIRED']);
    }
    let assessment;
    try{
      assessment=preflight.assess({jobId,analysisRevisionId,
        extractionRevisionId,sourceScope,screeningSignals,
        selectedAgentIds:ids,
        provider:a.provider,authorization:a.authorization,
        budget:a.budget,runtime:a.runtime});
    }catch(_){return block(jobId,'PROVIDER_PREFLIGHT_FAILED');}
    if(assessment.state!=='preflight_passed_pending_gateway_review'||
       assessment.eligible_for_private_execution_review!==true||
       assessment.provider_dispatch_allowed!==false||
       assessment.external_data_transfer_allowed!==false||
       assessment.issuance_allowed!==false)
      return result(jobId,'blocked','halt',[],[],
        ['PROVIDER_PREFLIGHT_NOT_APPROVED',...(
          Array.isArray(assessment.blockers)?
            assessment.blockers.filter(x=>typeof x==='string'&&
              /^[A-Z0-9_]{3,80}$/.test(x)).slice(0,3):[]
        )]);
    if(!Array.isArray(assessment.selected_agents)||
       assessment.selected_agents.length!==ids.length||
       ids.some((x,i)=>assessment.selected_agents[i]!==x))
      return block(jobId,'AGENT_ROSTER_NOT_ATTESTED');
    return result(jobId,'ready_for_private_gateway_authorization_review',
      'foundation',ids,next,['ATOMIC_BACKEND_GATEWAY_AUTHORIZATION_REQUIRED'],{
        estimated_run_cents:assessment.estimated_cost_cents
      });
  }
  return Object.freeze({VERSION,prepare});
})();
if(typeof module!=='undefined'&&module.exports)
  module.exports=duvriAgentActivationPreparation;
