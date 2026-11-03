/*
 * Colligo DUVRI AI: STRICTLY-LOCAL Ollama HSE candidate adapter.
 * No provider keys, cloud, model pulls, installs or requests on import.
 * Never import into the public PWA/browser or cloud functions.
 * It runs only on the Windows machine hosting Ollama and PRIVATE backend.
 */
'use strict';
const {getAgentInstruction}=require('../js/duvri-hse-agent-instructions.js');
const {validateAgentResult}=require('../js/duvri-agent-contract.js');

const BASE='http://127.0.0.1:11434';
const TAGS=BASE+'/api/tags',CHAT=BASE+'/api/chat';
const OPAQUE=/^[A-Za-z0-9_-]{6,128}$/;
const MODEL=/^[A-Za-z0-9][A-Za-z0-9._/-]{0,110}(?::[A-Za-z0-9][A-Za-z0-9._-]{0,50})?$/;
const isId=x=>typeof x==='string'&&OPAQUE.test(x);
const obj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const exact=(x,keys)=>obj(x)&&Object.keys(x).length===keys.length&&
  Object.keys(x).every(k=>keys.includes(k));
function blocked(code,attempted=false){
 return {
  state:'blocked',blocker_code:code,
  local_request_attempted:attempted,
  external_data_transfer_allowed:false,
  provider_dispatch_allowed:false,
  hse_approved:false,issuance_allowed:false
 };
}
function createLocalOllamaAdapter({
  enabled=false,loadSyntheticCase,verifyLocalRuntime,recordAudit,
  fetchImpl=globalThis.fetch
}={}){
 if(enabled!==true)return Object.freeze({
  invoke:async()=>blocked('LOCAL_ADAPTER_DISABLED')
 });
 if([loadSyntheticCase,verifyLocalRuntime,recordAudit,fetchImpl]
    .some(x=>typeof x!=='function'))
  return Object.freeze({invoke:async()=>blocked('PRIVATE_CALLBACKS_MISSING')});
 async function invoke(request){
  const fields=['jobId','agentId','analysisRevisionId','extractionRevisionId','runRevisionId'];
  if(!exact(request,fields)||![
      request.jobId,request.analysisRevisionId,request.extractionRevisionId,
      request.runRevisionId].every(isId))
    return blocked('INVALID_REQUEST');
  const role=getAgentInstruction(request.agentId);
  if(!role)return blocked('UNKNOWN_SPECIALIST');
  const ref={
   job_id:request.jobId,agent_id:request.agentId,
   analysis_revision_id:request.analysisRevisionId,
   extraction_revision_id:request.extractionRevisionId,
   run_revision_id:request.runRevisionId
  };
  let safety;
  try{safety=await verifyLocalRuntime(Object.freeze({...ref}));}
  catch(_){return blocked('LOCAL_ONLY_RUNTIME_NOT_VERIFIED');}
  // Backend must independently confirm Ollama is running in local-only mode,
  // OLLAMA_NO_CLOUD=1, its effective settings and that it binds only loopback.
  // A caller/browser boolean is NOT sufficient; this is a server boundary.
  if(!obj(safety)||safety.backend_checked!==true||
     safety.ollama_no_cloud_effective!==true||
     safety.ollama_loopback_only===false||
     safety.ollama_loopback_only!==true||
     safety.no_external_provider_configured!==true)
    return blocked('LOCAL_ONLY_RUNTIME_NOT_VERIFIED');
  let policy;
  try{policy=await loadSyntheticCase(Object.freeze({...ref}));}
  catch(_){return blocked('SYNTHETIC_CASE_NOT_VERIFIED');}
  if(!obj(policy)||policy.backend_verified!==true||
     policy.local_execution_authorized!==true||
     policy.data_classification!=='synthetic'||
     policy.synthetic_only!==true||
     policy.revision_current!==true||
     policy.local_only!==true||
     policy.job_id!==ref.job_id||
     policy.agent_id!==ref.agent_id||
     policy.analysis_revision_id!==ref.analysis_revision_id||
     policy.extraction_revision_id!==ref.extraction_revision_id||
     policy.run_revision_id!==ref.run_revision_id)
    return blocked('SYNTHETIC_CASE_NOT_VERIFIED');
  // A cloud model advertised through local Ollama still might invoke a
  // remote service. Reject any cloud-tagged model, even if in /api/tags.
  if(typeof policy.model_id!=='string'||!MODEL.test(policy.model_id)||
      /cloud/i.test(policy.model_id))
    return blocked('CLOUD_OR_INVALID_MODEL_REJECTED');
  if(!Array.isArray(policy.allowed_file_ids)||
     policy.allowed_file_ids.length<1||policy.allowed_file_ids.length>100||
     !policy.allowed_file_ids.every(isId)||
     new Set(policy.allowed_file_ids).size!==policy.allowed_file_ids.length)
    return blocked('SOURCE_SCOPE_INVALID');
  const facts=policy.source_facts;
  if(!obj(facts)||facts.synthetic_only!==true||
     facts.job_id!==ref.job_id||
     facts.agent_id!==ref.agent_id||
     facts.analysis_revision_id!==ref.analysis_revision_id||
     facts.extraction_revision_id!==ref.extraction_revision_id||
     !obj(facts.task)||
     Object.keys(facts).some(k=>![
       'synthetic_only','job_id','agent_id',
       'analysis_revision_id','extraction_revision_id','task'].includes(k)))
    return blocked('SYNTHETIC_FACTS_INVALID');
  let serialized;
  try{serialized=JSON.stringify(facts);}
  catch(_){return blocked('SYNTHETIC_FACTS_INVALID');}
  if(typeof serialized!=='string'||serialized.length>22000)
    return blocked('SYNTHETIC_FACTS_INVALID');
  const ctx={...ref,model_id:policy.model_id};
  try{await recordAudit({...ctx,event:'local_run_started'});}
  catch(_){return blocked('LOCAL_AUDIT_NOT_AVAILABLE');}

  let attempted=false,status='LOCAL_MODEL_RESPONSE_INVALID',candidate=null,usage=null;
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),120000);
  try{
    attempted=true;
    const modelsResponse=await fetchImpl(TAGS,{
      method:'GET',redirect:'error',signal:controller.signal
    });
    if(!modelsResponse||modelsResponse.ok!==true)
      status='LOCAL_OLLAMA_UNAVAILABLE';
    else {
      const rawTags=await modelsResponse.text();
      let tags=null;
      if(typeof rawTags==='string'&&rawTags.length<131072){
        try{tags=JSON.parse(rawTags);}catch(_){tags=null;}
      }
      if(!Array.isArray(tags?.models)||tags.models.length>1000)
        status='LOCAL_MODEL_LIST_INVALID';
      else if(!tags.models.some(m=>obj(m)&&m.name===policy.model_id))
        status='LOCAL_MODEL_NOT_INSTALLED';
      else {
        attempted=true;
        const response=await fetchImpl(CHAT,{
          method:'POST',redirect:'error',signal:controller.signal,
          headers:{'content-type':'application/json'},
          body:JSON.stringify({
            model:policy.model_id,
            messages:[
              {role:'system',content:role.instructions.join('\n')},
              {role:'user',content:serialized}
            ],
            stream:false,format:'json',
            options:{temperature:0,num_predict:1024}
          })
        });
        if(!response||response.ok!==true)status='LOCAL_CHAT_FAILED';
        else {
          const raw=await response.text();
          let packet=null;
          if(typeof raw==='string'&&raw.length<=196608){
            try{packet=JSON.parse(raw);}catch(_){packet=null;}
          }
          if(packet?.done!==true||packet.model!==policy.model_id||
             typeof packet.message?.content!=='string'||
             packet.message.content.length>128000)
            status='LOCAL_MODEL_RESPONSE_INVALID';
          else{
            let generated=null;
            try{generated=JSON.parse(packet.message.content);}catch(_){generated=null;}
            let valid=false;
            if(generated&&generated.agent_id===ref.agent_id){
              try{valid=validateAgentResult(generated,{
                jobId:ref.job_id,allowedFileIds:policy.allowed_file_ids
              }).valid===true;}catch(_){valid=false;}
            }
            if(valid){
              candidate=generated;
              status='HSE_CANDIDATE_NEEDS_FACT_CHECK';
              usage={
                prompt_tokens:Number.isSafeInteger(packet.prompt_eval_count)?packet.prompt_eval_count:0,
                completion_tokens:Number.isSafeInteger(packet.eval_count)?packet.eval_count:0
              };
            }else status='HSE_OUTPUT_REJECTED';
          }
        }
      }
    }
  }catch(_){status='LOCAL_REQUEST_FAILED_OR_TIMED_OUT';}
  finally{clearTimeout(timeout);}

  let audited=false;
  try{
    await recordAudit({...ctx,event:'local_run_finished',
      result_code:status,local_request_attempted:attempted,usage});
    audited=true;
  }catch(_){audited=false;}
  if(!audited)return blocked('LOCAL_AUDIT_COMPLETION_FAILED',attempted);
  if(!candidate)return blocked(status,attempted);
  // Candidate only; cite/fact matching, HSE judgment and Word QA are separate.
  return {
    state:'candidate_for_private_fact_verification',
    local_request_attempted:attempted,
    agent_result:candidate,
    needs_human_review:true,hse_approved:false,issuance_allowed:false,
    external_data_transfer_allowed:false,provider_dispatch_allowed:false
  };
 }
 return Object.freeze({invoke});
}
module.exports=Object.freeze({createLocalOllamaAdapter});
