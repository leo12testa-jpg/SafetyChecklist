/*
 * COLLIGO DUVRI AI — private provider execution PREFLIGHT ONLY.
 * No AI invocation, network, upload, credential management or DUVRI issuance.
 * The backend must fetch and independently verify every attestation below.
 */
const duvriAiExecutionPreflight=(()=>{
 'use strict';
 const agents=typeof require==='function'?require('./duvri-agent-contract.js'):
   (typeof duvriAgentContract!=='undefined'?duvriAgentContract:null);
 const VERSION='colligo-duvri-ai-execution-preflight/1.0';
 const rec=x=>!!x&&typeof x==='object'&&!Array.isArray(x);
 const id=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{6,128}$/.test(x);
 const money=x=>Number.isSafeInteger(x)&&x>=0&&x<=1000000000;
 const noExtra=(o,allowed)=>rec(o)&&Object.keys(o).every(k=>allowed.includes(k));
 const denied=(job,code)=>({
  schema_version:VERSION,job_id:id(job)?job:null,state:'blocked',
  selected_agents:[],estimated_cost_cents:null,blockers:[code],
  eligible_for_private_execution_review:false,
  provider_dispatch_allowed:false,external_data_transfer_allowed:false,
  document_draft_allowed:false,issuance_allowed:false
 });
 function assess({jobId,analysisRevisionId,extractionRevisionId,sourceScope,
   screeningSignals,selectedAgentIds,provider,authorization,budget,runtime}={}){
  if(!agents||!id(jobId)||!id(analysisRevisionId)||!id(extractionRevisionId))
   return denied(jobId,'INVALID_JOB_OR_REVISION');
  const s=sourceScope;
  if(!rec(s)||s.schema_version!=='colligo-duvri-hse-evidence-scope/1.0'||
   s.job_id!==jobId||s.analysis_revision_id!==analysisRevisionId||
   s.extraction_revision_id!==extractionRevisionId||
   s.state!=='ready_for_hse_screening'||s.checklist_ready!==true||
   s.issuance_allowed!==false||!Array.isArray(s.allowed_file_ids)||
   s.allowed_file_ids.length===0||s.allowed_file_ids.length>200||
   !s.allowed_file_ids.every(id)||new Set(s.allowed_file_ids).size!==s.allowed_file_ids.length||
   !Array.isArray(s.withheld_file_ids)||s.withheld_file_ids.length||
   !Array.isArray(s.manual_review_file_ids)||s.manual_review_file_ids.length)
   return denied(jobId,'SOURCES_INCOMPLETE_OR_STALE');
  if(!rec(screeningSignals)||!Array.isArray(selectedAgentIds)||
   selectedAgentIds.length<3||selectedAgentIds.length>agents.AGENTS.length||
   !selectedAgentIds.every(x=>agents.AGENTS.includes(x))||
   new Set(selectedAgentIds).size!==selectedAgentIds.length)
   return denied(jobId,'INVALID_SPECIALIST_SELECTION');
  let route;
  try{route=agents.routeSpecialists(screeningSignals);}
  catch(_){return denied(jobId,'INVALID_SCREENING_SIGNALS');}
  if(route.needs_screening.length||
   selectedAgentIds.length!==route.selected_agents.length||
   route.selected_agents.some(x=>!selectedAgentIds.includes(x)))
   return denied(jobId,'SCREENING_UNRESOLVED_OR_INCOMPLETE_ROSTER');
  const p=provider;
  if(!noExtra(p,['provider_id','model_id','region','config_revision_id'])||
   !id(p.provider_id)||!id(p.model_id)||!id(p.region)||!id(p.config_revision_id))
   return denied(jobId,'PROVIDER_CONFIG_UNVERIFIED');
  const a=authorization;
  if(!noExtra(a,['job_id','analysis_revision_id','extraction_revision_id',
   'organization_approval_id','approval_revision_id','approver_id','approver_role',
   'approved_provider_id','approved_model_id','approved_region','authenticated',
   'can_authorize_ai','provider_processing_approved','customer_data_processing_authorized',
   'retention_policy_approved','client_scope_reviewed','human_hse_review_required'])||
   a.job_id!==jobId||a.analysis_revision_id!==analysisRevisionId||
   a.extraction_revision_id!==extractionRevisionId||
   !id(a.organization_approval_id)||!id(a.approval_revision_id)||!id(a.approver_id)||
   !['admin','direzione'].includes(a.approver_role)||
   a.approved_provider_id!==p.provider_id||a.approved_model_id!==p.model_id||
   a.approved_region!==p.region||a.authenticated!==true||
   a.can_authorize_ai!==true||a.provider_processing_approved!==true||
   a.customer_data_processing_authorized!==true||a.retention_policy_approved!==true||
   a.client_scope_reviewed!==true||a.human_hse_review_required!==true)
   return denied(jobId,'ORGANIZATION_OR_PRIVACY_APPROVAL_MISSING');
  const b=budget;
  if(!noExtra(b,['job_id','analysis_revision_id','approval_revision_id',
   'price_schedule_revision_id','cost_approval_id','estimated_run_cents',
   'max_run_cents','job_remaining_cents','organization_remaining_cents',
   'cost_approved','estimate_server_verified'])||
   b.job_id!==jobId||b.analysis_revision_id!==analysisRevisionId||
   b.approval_revision_id!==a.approval_revision_id||
   !id(b.price_schedule_revision_id)||!id(b.cost_approval_id)||
   !money(b.estimated_run_cents)||b.estimated_run_cents===0||
   !money(b.max_run_cents)||b.max_run_cents===0||
   !money(b.job_remaining_cents)||!money(b.organization_remaining_cents)||
   b.estimated_run_cents>b.max_run_cents||
   b.max_run_cents>b.job_remaining_cents||
   b.max_run_cents>b.organization_remaining_cents||
   b.cost_approved!==true||b.estimate_server_verified!==true)
   return denied(jobId,'AI_BUDGET_NOT_VERIFIED');
  const r=runtime;
  if(!noExtra(r,['backend_mode','backend_config_revision_id','provider_config_revision_id',
   'job_id','analysis_revision_id','extraction_revision_id','secrets_server_side',
   'endpoint_allowlisted','runtime_egress_controlled','input_data_minimized',
   'no_unapproved_storage','audit_logging_enabled','provider_enabled'])||
   r.backend_mode!=='private_backend'||!id(r.backend_config_revision_id)||
   r.provider_config_revision_id!==p.config_revision_id||
   r.job_id!==jobId||r.analysis_revision_id!==analysisRevisionId||
   r.extraction_revision_id!==extractionRevisionId||
   r.secrets_server_side!==true||r.endpoint_allowlisted!==true||
   r.runtime_egress_controlled!==true||r.input_data_minimized!==true||
   r.no_unapproved_storage!==true||r.audit_logging_enabled!==true||
   r.provider_enabled!==true)
   return denied(jobId,'PRIVATE_GATEWAY_NOT_VERIFIED');
  // Positive preflight is NOT an authorization token. Actual gateway must
  // recheck permissions, approved data transfer and budget atomically.
  return {
   schema_version:VERSION,job_id:jobId,
   state:'preflight_passed_pending_gateway_review',
   selected_agents:[...route.selected_agents],
   estimated_cost_cents:b.estimated_run_cents,blockers:[],
   eligible_for_private_execution_review:true,
   provider_dispatch_allowed:false,external_data_transfer_allowed:false,
   document_draft_allowed:false,issuance_allowed:false
  };
 }
 return Object.freeze({VERSION,assess});
})();
if(typeof module!=='undefined'&&module.exports)module.exports=duvriAiExecutionPreflight;
