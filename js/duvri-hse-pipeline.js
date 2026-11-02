/*
 * COLLIGO DUVRI AI — source-grounded HSE aggregation (isolated v1).
 * All input data and ACLs must be retrieved by an authenticated private backend.
 * No AI, no database, no issuance or client file I/O in this module.
 */
const duvriHsePipeline = (() => {
  'use strict';
  const screening = typeof require === 'function'
    ? require('./duvri-hse-screening.js')
    : (typeof duvriHseScreening !== 'undefined' ? duvriHseScreening : null);
  const coordinator = typeof require === 'function'
    ? require('./duvri-hse-coordinator.js')
    : (typeof duvriHseCoordinator !== 'undefined' ? duvriHseCoordinator : null);

  const validId = x => typeof x === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(x);
  function blocked(jobId, reason) {
    return {
      schema_version:'colligo-duvri-review-packet/1.0',
      job_id:validId(jobId)?jobId:null,analysis_revision_id:null,
      state:'blocked',human_review_required:true,issuance_allowed:false,
      required_agents:[],pending_agents:[],screening_required:[],
      findings:[],missing_information:[],conflicts:[],possible_overlaps:[],
      blocking_reasons:[reason],screening_confirmation_required:[]
    };
  }
  function aggregateEvidenceGated({
    jobId,analysisRevisionId,screeningAnswers,allowedFileIds,agentResults
  }={}) {
    if (!screening || !coordinator ||
        !validId(jobId) || !validId(analysisRevisionId) ||
        !(Array.isArray(allowedFileIds) || allowedFileIds instanceof Set) ||
        !Array.isArray(agentResults)) {
      return blocked(jobId,'Configurazione di orchestrazione non valida');
    }
    const s=screening.normalizeSpecialtyScreening({
      jobId,answers:screeningAnswers,allowedFileIds
    });
    if (s.state==='blocked') {
      return blocked(jobId,'Screening documentale invalido: '+s.errors.join(' | '));
    }
    const packet=coordinator.buildReviewPacket({
      jobId,analysisRevisionId,specialtySignals:s.signals,
      agentResults,allowedFileIds
    });
    // Each "yes" from an unconfirmed file can summon a specialist, but must
    // NEVER allow the full case to reach document drafting before confirmation.
    if (packet.state==='blocked') {
      return { ...packet,screening_confirmation_required:[...s.needs_confirmation] };
    }
    const needsConfirmation=s.state==='needs_confirmation';
    return {
      ...packet,
      state:needsConfirmation ? 'awaiting_input' : packet.state,
      human_review_required:true,
      issuance_allowed:false,
      screening_confirmation_required:[...s.needs_confirmation]
    };
  }
  return Object.freeze({aggregateEvidenceGated});
})();
if (typeof module !== 'undefined' && module.exports) module.exports=duvriHsePipeline;
