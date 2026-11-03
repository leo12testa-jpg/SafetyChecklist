/*
 * Colligo DUVRI — REAL provider transport for PRIVATE Node gateway only.
 *
 * This module CAN send an HTTP request to Vercel AI Gateway, but ONLY when
 * invoked from a server that supplies trusted ACL/privacy/provider records,
 * an atomic budget reservation, auditing and a server-held secret.
 *
 * It is NOT wired into the public app or the Deno worker. No call on import.
 * Do not use with customer data until Colligo authorizes the provider,
 * processing region, retention, use case and spending.
 */
'use strict';
const {getAgentInstruction}=require('../js/duvri-hse-agent-instructions.js');
const {validateAgentResult}=require('../js/duvri-agent-contract.js');

const URL='https://ai-gateway.vercel.sh/v1/chat/completions';
const ID=/^[A-Za-z0-9_-]{6,128}$/;
const MODEL=/^[a-z][a-z0-9-]{1,40}\/[A-Za-z0-9][A-Za-z0-9._-]{1,128}$/;
const isId=x=>typeof x==='string'&&ID.test(x);
const isRecord=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const positiveInt=x=>Number.isSafeInteger(x)&&x>0;
const deny=(code)=>({
  status:'blocked',code,request_sent:false,
  needs_human_review:true,approved:false,issuance_allowed:false
});
const errors=Object.freeze(new Set([
  'DISABLED','INVALID_REQUEST','INVALID_SERVER_DEPENDENCIES',
  'AUTHORIZATION_NOT_VERIFIED','PRIVATE_PAYLOAD_NOT_VERIFIED',
  'BUDGET_RESERVATION_FAILED','AUDIT_START_FAILED',
  'GATEWAY_CREDENTIAL_UNAVAILABLE','PROVIDER_HTTP_FAILURE',
  'PROVIDER_TIMEOUT_OR_NETWORK','PROVIDER_RESPONSE_INVALID',
  'HSE_RESULT_INVALID','BUDGET_SETTLEMENT_FAILED',
  'AUDIT_COMPLETION_FAILED'
]));
function reject(code){return deny(errors.has(code)?code:'PROVIDER_RESPONSE_INVALID');}

function createPrivateGateway({
  enabled=false,loadAuthorizedRun,reserveBudget,settleBudget,
  recordAudit,getServerApiKey,fetchImpl=globalThis.fetch
}={}){
  // Configuration is set exclusively by the private server at startup.
  if(enabled!==true)return Object.freeze({
    invoke:async()=>reject('DISABLED')
  });
  const fns=[loadAuthorizedRun,reserveBudget,settleBudget,
    recordAudit,getServerApiKey,fetchImpl];
  if(fns.some(f=>typeof f!=='function'))return Object.freeze({
    invoke:async()=>reject('INVALID_SERVER_DEPENDENCIES')
  });
  async function invoke(request){
    if(!isRecord(request)||Object.keys(request).sort().join('|')!==
      ['agentId','analysisRevisionId','extractionRevisionId',
       'jobId','runRevisionId'].sort().join('|')||
      ![request.jobId,request.analysisRevisionId,
        request.extractionRevisionId,request.runRevisionId].every(isId)||
      !getAgentInstruction(request.agentId))return reject('INVALID_REQUEST');
    const ref={job_id:request.jobId,agent_id:request.agentId,
      analysis_revision_id:request.analysisRevisionId,
      extraction_revision_id:request.extractionRevisionId,
      run_revision_id:request.runRevisionId};
    let policy;
    try{policy=await loadAuthorizedRun(Object.freeze({...ref}));}
    catch(_){return reject('AUTHORIZATION_NOT_VERIFIED');}
    // The private backend must derive every field below from its DB and ACL;
    // a browser-provided truthy value MUST NOT be forwarded as a policy.
    if(!isRecord(policy)||policy.backend_verified!==true||
      policy.authenticated_operator_authorized!==true||
      policy.company_approval_verified!==true||
      policy.privacy_and_retention_verified!==true||
      policy.region_binding_verified!==true||
      policy.request_revision_current!==true||
      policy.provider_id!=='vercel_ai_gateway'||
      typeof policy.model_id!=='string'||!MODEL.test(policy.model_id)||
      !positiveInt(policy.max_request_cents)||
      !positiveInt(policy.max_output_tokens)||
      policy.max_output_tokens>8192)
      return reject('AUTHORIZATION_NOT_VERIFIED');
    const role=getAgentInstruction(request.agentId);
    if(!Array.isArray(policy.allowed_file_ids)||
       policy.allowed_file_ids.length<1||policy.allowed_file_ids.length>200||
       !policy.allowed_file_ids.every(isId)||
       new Set(policy.allowed_file_ids).size!==policy.allowed_file_ids.length||
       !isRecord(policy.source_facts)||!isRecord(policy.source_facts.task)||
       policy.source_facts.job_id!==ref.job_id||
       policy.source_facts.analysis_revision_id!==ref.analysis_revision_id||
       policy.source_facts.extraction_revision_id!==ref.extraction_revision_id||
       policy.source_facts.agent_id!==ref.agent_id||
       policy.source_facts.scoped_and_minimized!==true||
       JSON.stringify(policy.source_facts).length>24000)
      return reject('PRIVATE_PAYLOAD_NOT_VERIFIED');
    // Never accept model IDs, provider URLs, prompts, approvals or document
    // contents from the invoke() arguments. All come from the backend.
    let reservation;
    try{
      reservation=await reserveBudget(Object.freeze({
        ...ref,max_request_cents:policy.max_request_cents,
        model_id:policy.model_id
      }));
    }catch(_){return reject('BUDGET_RESERVATION_FAILED');}
    if(!isRecord(reservation)||reservation.reserved!==true||
       !isId(reservation.reservation_id)||
       reservation.max_request_cents!==policy.max_request_cents)
      return reject('BUDGET_RESERVATION_FAILED');
    const ctx={...ref,reservation_id:reservation.reservation_id,
      model_id:policy.model_id};
    let settled=false;
    const settle=async(outcome,usage=null)=>{
      if(settled)return true;
      try{
        const r=await settleBudget({...ctx,outcome,usage});
        settled=isRecord(r)&&r.settled===true;
      }catch(_){settled=false;}
      return settled;
    };
    try{
      await recordAudit({...ctx,event:'started',result_code:'STARTED'});
    }catch(_){
      await settle('not_sent');
      return reject('AUDIT_START_FAILED');
    }
    let key;
    try{key=await getServerApiKey();}
    catch(_){key=null;}
    if(typeof key!=='string'||key.length<16){
      await settle('not_sent');
      return reject('GATEWAY_CREDENTIAL_UNAVAILABLE');
    }
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),25000);
    let response=null,raw=null,code='PROVIDER_RESPONSE_INVALID',valid=null;
    let requestSent=false,usage=null;
    try{
      requestSent=true;
      response=await fetchImpl(URL,{
        method:'POST',signal:controller.signal,
        headers:{authorization:'Bearer '+key,'content-type':'application/json'},
        body:JSON.stringify({
          model:policy.model_id,
          messages:[
            {role:'system',content:role.instructions.join('\n')},
            {role:'user',content:JSON.stringify(policy.source_facts)}
          ],
          max_tokens:policy.max_output_tokens,
          stream:false
        })
      });
      if(!response||response.ok!==true){code='PROVIDER_HTTP_FAILURE';}
      else{
        raw=await response.json();
        usage=raw?.usage&&isRecord(raw.usage)?{
          prompt_tokens:Number.isSafeInteger(raw.usage.prompt_tokens)?raw.usage.prompt_tokens:0,
          completion_tokens:Number.isSafeInteger(raw.usage.completion_tokens)?raw.usage.completion_tokens:0
        }:null;
        const content=raw?.choices?.[0]?.message?.content;
        if(typeof content==='string'&&content.length<=128000){
          let candidate;
          try{candidate=JSON.parse(content);}catch(_){candidate=null;}
          if(candidate&&candidate.agent_id===ref.agent_id){
            const check=validateAgentResult(candidate,{
              jobId:ref.job_id,allowedFileIds:policy.allowed_file_ids
            });
            if(check.valid){valid=candidate;code='VALIDATED_CANDIDATE';}
            else code='HSE_RESULT_INVALID';
          }else code='HSE_RESULT_INVALID';
        }
      }
    }catch(_){code='PROVIDER_TIMEOUT_OR_NETWORK';}
    finally{clearTimeout(timeout);}
    const moneyOk=await settle('sent',usage);
    let auditOk=false;
    try{
      await recordAudit({...ctx,event:'completed',result_code:code,
        response_recorded:response!==null});
      auditOk=true;
    }catch(_){auditOk=false;}
    if(!moneyOk)return reject('BUDGET_SETTLEMENT_FAILED');
    if(!auditOk)return reject('AUDIT_COMPLETION_FAILED');
    if(!valid)return reject(code);
    // Candidate stays IN the private backend. It is not a review decision,
    // verified citation match, D1 risk score or permission to draft Word.
    return {
      status:'candidate_for_private_source_verification',
      code:'VALIDATED_CANDIDATE',request_sent:requestSent,
      agent_result:valid,needs_human_review:true,
      approved:false,issuance_allowed:false
    };
  }
  return Object.freeze({invoke});
}
module.exports=Object.freeze({createPrivateGateway});
