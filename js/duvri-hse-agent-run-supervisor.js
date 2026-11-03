/*
 * Colligo DUVRI AI — deterministic specialist-run supervisor (v1).
 *
 * No AI invocation, network, database, private-file access, provider grants,
 * Word generation, HSE approval or issuance. The authenticated private
 * backend owns task staging, recorded execution evidence and its SHA checks.
 *
 * This module consumes ONLY opaque metadata and server-verified receipts,
 * and stages dependencies: documentale + normativa -> specialisti ->
 * coordinamento -> tecnico HSE. It never returns document or model content.
 */
const duvriHseAgentRunSupervisor=(()=>{
  'use strict';
  const catalog=typeof require==='function'
    ?require('./duvri-agent-contract.js'):duvriAgentContract;
  const VERSION='colligo-duvri-hse-agent-run-supervisor/1.0';
  const HASH=/^[a-f0-9]{64}$/i;
  const ID=/^[A-Za-z0-9_-]{6,128}$/;
  const isObject=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
  const isId=x=>typeof x==='string'&&ID.test(x);
  const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
  const exact=(o,keys)=>isObject(o)&&
    Object.keys(o).length===keys.length&&
    Object.keys(o).every(k=>keys.includes(k));
  const foundation=Object.freeze(['documentale','normativa']);
  const terminalStatuses=Object.freeze(['completed','not_applicable','needs_clarification','blocked']);
  function blocked(jobId,reason){
    return {
      schema_version:VERSION,
      job_id:isId(jobId)?jobId:null,
      state:'blocked',
      phase:'halt',
      next_agent_ids:[],
      pending_agent_ids:[],
      recorded_agent_count:0,
      requires_human_review:true,
      blocker_codes:[reason],
      provider_dispatch_allowed:false,
      external_data_transfer_allowed:false,
      document_draft_allowed:false,
      hse_approved:false,
      issuance_allowed:false
    };
  }
  function envelopeValid(x,jobId,analysisRevisionId,extractionRevisionId){
    if(!isObject(x)||
       x.schema_version!=='colligo-duvri-agent-task-staging/1.0'||
       x.state!=='tasks_staged_for_private_backend'||
       x.job_id!==jobId||
       x.provider_dispatch_allowed!==false||
       x.external_data_transfer_allowed!==false||
       x.issuance_allowed!==false||
       !Array.isArray(x.selected_agents)||
       !Array.isArray(x.agent_tasks)||
       x.selected_agents.length<3||x.selected_agents.length>12||
       x.agent_tasks.length!==x.selected_agents.length||
       new Set(x.selected_agents).size!==x.selected_agents.length||
       !foundation.every(a=>x.selected_agents.includes(a))||
       !x.selected_agents.includes('coordinamento')||
       x.selected_agents.some(a=>!catalog.AGENTS.includes(a)))
      return false;
    const first=x.agent_tasks[0];
    if(!isObject(first)||!Array.isArray(first.allowed_file_ids)||
       first.allowed_file_ids.length<1||first.allowed_file_ids.length>200||
       !first.allowed_file_ids.every(isId)||
       new Set(first.allowed_file_ids).size!==first.allowed_file_ids.length)
      return false;
    const fileIds=first.allowed_file_ids;
    return x.agent_tasks.every((t,i)=>isObject(t)&&
      t.agent_id===x.selected_agents[i]&&
      t.job_id===jobId&&
      t.analysis_revision_id===analysisRevisionId&&
      t.extraction_revision_id===extractionRevisionId&&
      t.output_schema_version==='colligo-duvri-agent-analysis/1.0'&&
      t.requires_human_review===true&&
      Array.isArray(t.allowed_file_ids)&&
      t.allowed_file_ids.length===fileIds.length&&
      t.allowed_file_ids.every((v,k)=>v===fileIds[k])&&
      Array.isArray(t.instructions)&&
      t.instructions.length>=3&&
      t.instructions.every(v=>typeof v==='string'));
  }
  function receiptValid(r,context,selected){
    const keys=[
      'agent_id','job_id','analysis_revision_id','extraction_revision_id',
      'run_revision_id','result_revision_id','result_sha256','result_status',
      'backend_result_hash_verified','agent_schema_validated',
      'authorized_source_scope_verified','citation_match_verified'
    ];
    return exact(r,keys)&&selected.includes(r.agent_id)&&
      r.job_id===context.jobId&&
      r.analysis_revision_id===context.analysisRevisionId&&
      r.extraction_revision_id===context.extractionRevisionId&&
      r.run_revision_id===context.runRevisionId&&
      isId(r.result_revision_id)&&
      typeof r.result_sha256==='string'&&HASH.test(r.result_sha256)&&
      terminalStatuses.includes(r.result_status)&&
      r.backend_result_hash_verified===true&&
      r.agent_schema_validated===true&&
      r.authorized_source_scope_verified===true&&
      r.citation_match_verified===true;
  }
  function safeState(jobId,phase,next,pending,recorded,blockers=[]){
    const state=phase==='complete'?
      blockers.includes('SPECIALIST_CLARIFICATIONS_REQUIRE_HUMAN')?
        'awaiting_human_clarifications':'ready_for_private_hse_packet_review':
      'awaiting_specialist_results';
    return {
      schema_version:VERSION,job_id:jobId,state,phase,
      next_agent_ids:[...next],pending_agent_ids:[...pending],
      recorded_agent_count:recorded,requires_human_review:true,
      blocker_codes:[...blockers],
      // "next" lists dependencies ready for authenticated local staging.
      // It is NOT permission to invoke AI or to disclose source documents.
      provider_dispatch_allowed:false,
      external_data_transfer_allowed:false,
      document_draft_allowed:false,hse_approved:false,issuance_allowed:false
    };
  }
  function assess(input){
    const a=isObject(input)?input:{};
    const {jobId,analysisRevisionId,extractionRevisionId,
      runRevisionId,currentRunRevisionId,staged,receipts}=a;
    if(!isId(jobId)||!isId(analysisRevisionId)||!isId(extractionRevisionId)||
       !isId(runRevisionId)||runRevisionId!==currentRunRevisionId||
       !Array.isArray(receipts)||receipts.length>12)
      return blocked(jobId,'INVALID_OR_STALE_AGENT_RUN');
    if(!envelopeValid(staged,jobId,analysisRevisionId,extractionRevisionId))
      return blocked(jobId,'INVALID_OR_UNTRUSTED_AGENT_TASKS');
    const selected=staged.selected_agents;
    const records=new Map();
    for(const r of receipts){
      if(!receiptValid(r,{jobId,analysisRevisionId,extractionRevisionId,runRevisionId},selected)||
         records.has(r.agent_id))
        return blocked(jobId,'INVALID_OR_DUPLICATE_AGENT_RECEIPT');
      records.set(r.agent_id,r);
    }
    if([...records.values()].some(r=>r.result_status==='blocked'))
      return blocked(jobId,'SPECIALIST_REPORTED_BLOCKED');
    const foundationMissing=foundation.filter(a=>!records.has(a));
    const specialists=selected.filter(a=>!foundation.includes(a)&&a!=='coordinamento');
    if(foundationMissing.length){
      if([...records.keys()].some(a=>!foundation.includes(a)))
        return blocked(jobId,'AGENT_DEPENDENCY_ORDER_VIOLATION');
      return safeState(jobId,'foundation',foundationMissing,
        selected.filter(a=>!records.has(a)),records.size);
    }
    const specialtyMissing=specialists.filter(a=>!records.has(a));
    if(specialtyMissing.length){
      if(records.has('coordinamento'))
        return blocked(jobId,'COORDINATOR_RAN_BEFORE_SPECIALISTS');
      return safeState(jobId,'specialists',specialtyMissing,
        selected.filter(a=>!records.has(a)),records.size);
    }
    if(!records.has('coordinamento'))
      return safeState(jobId,'coordination',['coordinamento'],
        ['coordinamento'],records.size);
    const clarifications=[...records.values()].some(r=>r.result_status==='needs_clarification');
    return safeState(jobId,'complete',[],[],records.size,
      clarifications?['SPECIALIST_CLARIFICATIONS_REQUIRE_HUMAN']:['HUMAN_HSE_REVIEW_REQUIRED']);
  }
  return Object.freeze({VERSION,assess});
})();
if(typeof module!=='undefined'&&module.exports)
  module.exports=duvriHseAgentRunSupervisor;
