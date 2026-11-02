/*
 * COLLIGO DUVRI AI — isolated, deterministic register of open HSE clarifications.
 *
 * Converts an already validated specialist packet into a TECHNICIAN-ONLY draft.
 * This is not a client email, an AI prompt, a safety assessment or a DUVRI approval.
 *
 * Trust boundary: the private backend must load the packet, evidence scope and
 * current revisions from its authenticated datastore. Never pass browser/LLM
 * claims directly here. Render suggested text as plain text, not HTML.
 */
const duvriClarificationRegister = (() => {
  'use strict';
  const contract = typeof require === 'function'
    ? require('./duvri-agent-contract.js')
    : (typeof duvriAgentContract !== 'undefined' ? duvriAgentContract : null);
  const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
  const id = x => typeof x === 'string' && /^[A-Za-z0-9_-]{6,128}$/.test(x);
  const smallId = x => typeof x === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(x);
  const content = (x,max=2000) => typeof x === 'string' && !!x.trim() && x.length <= max;
  const isList = (x,max=300) => Array.isArray(x) && x.length <= max;
  const allowedStatuses = new Set(['confirmed','extracted_unconfirmed','requires_verification']);
  const sourceTypes = new Set(['current_job_document','current_job_checklist']);
  const signalQuestions = Object.freeze({
    incendio_emergenze:'Verificare la presenza di interferenze con incendio, emergenze e vie di esodo.',
    impianti_elettrici:'Verificare se sono previste lavorazioni o interferenze con impianti elettrici.',
    lavori_in_quota:'Verificare se sono previste lavorazioni in quota o interferenze con aree sottostanti.',
    cantieri_edili:'Verificare se sono presenti attività di cantiere e interferenze correlate.',
    chimici_atex:'Verificare presenza di agenti chimici o atmosfere potenzialmente esplosive.',
    ambienti_confinati:'Verificare se sono previsti accessi ad ambienti confinati o sospetti di inquinamento.',
    macchine_impianti:'Verificare le interferenze con macchine, attrezzature e impianti.',
    logistica_viabilita:'Verificare le interferenze di accessi, viabilità e movimentazione.',
    agenti_fisici:'Verificare esposizioni interferenziali ad agenti fisici.'
  });

  function blocked(jobId,reason) {
    return {
      schema_version:'colligo-duvri-clarification-register/1.0',
      job_id:id(jobId)?jobId:null,
      analysis_revision_id:null,extraction_revision_id:null,
      state:'blocked',items:[],item_count:0,blocking_count:0,
      blocks_document_draft:true,human_review_required:true,client_dispatch_allowed:false,
      ready_for_technical_preflight:false,issuance_allowed:false,
      blockers:[reason]
    };
  }
  function authorizedEvidence(evidence,allowed) {
    if(!isList(evidence,50) || !evidence.length) return null;
    const refs=[];
    for(const e of evidence) {
      if(!object(e) || !sourceTypes.has(e.source_type) ||
          !id(e.file_id) || !allowed.has(e.file_id) ||
          !content(e.locator,1000) || !allowedStatuses.has(e.verification_status)) {
        return null;
      }
      refs.push({
        source_type:e.source_type,file_id:e.file_id,
        locator:e.locator,verification_status:e.verification_status
      });
    }
    return refs;
  }
  function buildClarificationRegister({
    packet,sourceScope,
    expectedJobId,expectedAnalysisRevisionId,expectedExtractionRevisionId
  }={}) {
    const jobId=object(packet)?packet.job_id:null;
    if (!contract || !id(expectedJobId) || !id(expectedAnalysisRevisionId) ||
        !id(expectedExtractionRevisionId) ||
        !object(packet) || !object(sourceScope) ||
        jobId!==expectedJobId ||
        packet.schema_version!=='colligo-duvri-review-packet/1.0' ||
        packet.analysis_revision_id!==expectedAnalysisRevisionId ||
        !['needs_review','awaiting_input'].includes(packet.state) ||
        packet.human_review_required!==true || packet.issuance_allowed!==false ||
        sourceScope.schema_version!=='colligo-duvri-hse-evidence-scope/1.0' ||
        sourceScope.job_id!==jobId ||
        sourceScope.analysis_revision_id!==expectedAnalysisRevisionId ||
        sourceScope.extraction_revision_id!==expectedExtractionRevisionId ||
        sourceScope.state!=='ready_for_hse_screening' ||
        sourceScope.checklist_ready!==true || sourceScope.issuance_allowed!==false ||
        !isList(sourceScope.allowed_file_ids,200) || sourceScope.allowed_file_ids.length===0 ||
        !sourceScope.allowed_file_ids.every(id) ||
        new Set(sourceScope.allowed_file_ids).size!==sourceScope.allowed_file_ids.length ||
        !isList(sourceScope.withheld_file_ids) || sourceScope.withheld_file_ids.length ||
        !isList(sourceScope.manual_review_file_ids) || sourceScope.manual_review_file_ids.length ||
        !isList(packet.required_agents,20) || !isList(packet.pending_agents,20) ||
        packet.pending_agents.length ||
        !isList(packet.blocking_reasons,100) || packet.blocking_reasons.length ||
        !isList(packet.screening_required,20) ||
        !isList(packet.findings) || !isList(packet.missing_information) ||
        !isList(packet.conflicts) ||
        (packet.screening_confirmation_required!==undefined &&
          !isList(packet.screening_confirmation_required,20))) {
      return blocked(jobId,'INVALID_OR_STALE_HSE_CONTEXT');
    }
    const agents=new Set(contract.AGENTS);
    const required=new Set(packet.required_agents);
    if(packet.required_agents.some(a=>!agents.has(a)) ||
        required.size!==packet.required_agents.length ||
        !contract.BASE_AGENTS.every(a=>required.has(a))) {
      return blocked(jobId,'INVALID_SPECIALIST_SET');
    }
    const allowed=new Set(sourceScope.allowed_file_ids);
    const items=[];
    const add=(kind,agent,sourceIndex,question,why,blocking,refs=[])=>{
      items.push({
        request_id:'REQ_'+String(items.length+1).padStart(4,'0'),
        kind,agent_id:agent,source_index:sourceIndex,
        suggested_question:question,why_needed:why,
        blocking,source_references:refs,
        requires_technical_review:true,client_dispatch_allowed:false
      });
    };
    const screening=new Set();
    for(const signal of [
      ...packet.screening_required,
      ...(packet.screening_confirmation_required || [])
    ]) {
      if(!Object.prototype.hasOwnProperty.call(signalQuestions,signal))
        return blocked(jobId,'UNKNOWN_SCREENING_SIGNAL');
      if(!screening.has(signal)) {
        screening.add(signal);
        add('screening_confirmation','coordinamento',signal,
          signalQuestions[signal],
          'Segnale non ancora confermato dalle fonti del fascicolo.',true);
      }
    }
    for(const [i,m] of packet.missing_information.entries()) {
      if(!object(m) || !required.has(m.agent_id) ||
          !content(m.question) || !content(m.why_needed) ||
          typeof m.blocking!=='boolean')
        return blocked(jobId,'INVALID_MISSING_INFORMATION');
      add('missing_information',m.agent_id,i,m.question,m.why_needed,m.blocking);
    }
    for(const [i,c] of packet.conflicts.entries()) {
      if(!object(c) || !required.has(c.agent_id) ||
          !content(c.description) || !content(c.resolution_question))
        return blocked(jobId,'INVALID_CONFLICT');
      const refs=authorizedEvidence(c.evidence,allowed);
      if(!refs || refs.length<2)
        return blocked(jobId,'UNVERIFIED_CONFLICT_SOURCES');
      add('conflicting_sources',c.agent_id,i,c.resolution_question,
        c.description,true,refs);
    }
    const findingIds=new Set();
    for(const [i,f] of packet.findings.entries()) {
      if(!object(f) || !required.has(f.agent_id) || !smallId(f.finding_id) ||
          !['to_be_reviewed','requires_clarification'].includes(f.validation_status))
        return blocked(jobId,'INVALID_FINDING');
      const key=f.agent_id+'\u0000'+f.finding_id;
      if(findingIds.has(key)) return blocked(jobId,'DUPLICATE_FINDING');
      findingIds.add(key);
      // Specialist findings can also cite previously validated history/rules.
      // Reject unknown categories or malformed cross-scope references; the
      // coordinator remains responsible for the separate source allowlists.
      if(!isList(f.source_evidence,50) || !f.source_evidence.length ||
         f.source_evidence.some(e=>!object(e) || !id(e.file_id) ||
           !content(e.locator,1000) ||
           !(sourceTypes.has(e.source_type) ||
             e.source_type==='historical_2026_reference' ||
             e.source_type==='approved_internal_rule') ||
           (e.source_type==='historical_2026_reference' &&
             e.verification_status!=='historical_example_only') ||
           (e.source_type==='approved_internal_rule' &&
             !allowedStatuses.has(e.verification_status)))) {
        return blocked(jobId,'INVALID_FINDING_SOURCE_TYPE');
      }
      // Never surface historical/rule sources as evidence of current work.
      const currentRefs=f.source_evidence.filter(e=>sourceTypes.has(e.source_type));
      const localRefs=authorizedEvidence(currentRefs,allowed);
      if(!localRefs) return blocked(jobId,'UNVERIFIED_FINDING_SOURCES');
      if(f.validation_status==='requires_clarification') {
        add('finding_clarification',f.agent_id,f.finding_id,
          'Chiarire la valutazione interferenziale identificata prima della bozza.',
          'Valutazione specialistica ancora in stato requires_clarification.',true,localRefs);
      }
    }
    if(packet.state==='awaiting_input' && !items.length)
      return blocked(jobId,'UNEXPLAINED_AWAITING_INPUT');
    const blocks=items.filter(x=>x.blocking).length;
    return {
      schema_version:'colligo-duvri-clarification-register/1.0',
      job_id:jobId,
      analysis_revision_id:expectedAnalysisRevisionId,
      extraction_revision_id:expectedExtractionRevisionId,
      state:items.length?'needs_technical_triage':'no_open_requests',
      items,item_count:items.length,blocking_count:blocks,
      blocks_document_draft:packet.state==='awaiting_input'||blocks>0,
      human_review_required:true,client_dispatch_allowed:false,
      ready_for_technical_preflight:false,issuance_allowed:false,
      blockers:[]
    };
  }
  return Object.freeze({buildClarificationRegister});
})();
if(typeof module!=='undefined'&&module.exports)module.exports=duvriClarificationRegister;
