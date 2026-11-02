/*
 * COLLIGO DUVRI AI — evidence-aware specialist screening (isolated v1).
 * Does NOT assess risk, decide applicability of DUVRI or call AI.
 * Backend must supply case-scoped authorized file IDs obtained from trusted ACLs.
 */
const duvriHseScreening = (() => {
  'use strict';
  const contract = typeof require === 'function'
    ? require('./duvri-agent-contract.js')
    : (typeof duvriAgentContract !== 'undefined' ? duvriAgentContract : null);

  const validId = x => typeof x === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(x);
  const isRecord = x => x !== null && typeof x === 'object' && !Array.isArray(x);
  const exactKeys = (x, allow) => Object.keys(x).every(key => allow.includes(key));
  const CURRENT_SOURCES = new Set(['current_job_document','current_job_checklist']);
  const STATUSES = new Set(['confirmed','extracted_unconfirmed','requires_verification']);
  function block(jobId, reason) {
    return { schema_version:'colligo-duvri-hse-screening/1.0',
      job_id:validId(jobId)?jobId:null, state:'blocked', signals:{},
      needs_confirmation:[], observations:[], errors:[reason] };
  }
  function normalizeSpecialtyScreening({jobId, answers, allowedFileIds}={}) {
    if (!contract || !validId(jobId) || !Array.isArray(answers) || answers.length > 60 ||
        !(Array.isArray(allowedFileIds) || allowedFileIds instanceof Set)) {
      return block(jobId, 'Contesto di screening incompleto o non valido');
    }
    const allowed = new Set(allowedFileIds);
    const known = contract.SIGNAL_TO_AGENT;
    const signals = {};
    const needsConfirmation = [];
    const observations = [];
    const seen = new Set();
    for (const [i, item] of answers.entries()) {
      if (!isRecord(item) ||
          !exactKeys(item,['signal','answer','evidence']) ||
          !Object.prototype.hasOwnProperty.call(known,item.signal) ||
          !['yes','no','unknown'].includes(item.answer) ||
          !Array.isArray(item.evidence) || item.evidence.length > 20 ||
          seen.has(item.signal)) {
        return block(jobId, 'Risposta di screening sconosciuta, duplicata o malformata alla posizione ' + i);
      }
      seen.add(item.signal);
      let anyConfirmed = false;
      let anyUnconfirmed = false;
      for (const ev of item.evidence) {
        if (!isRecord(ev) || !exactKeys(ev,['source_type','file_id','locator','verification_status']) ||
            !CURRENT_SOURCES.has(ev.source_type) || !validId(ev.file_id) ||
            !allowed.has(ev.file_id) || typeof ev.locator !== 'string' ||
            !ev.locator.trim() || ev.locator.length > 1000 ||
            !STATUSES.has(ev.verification_status)) {
          return block(jobId, 'Fonte di screening non autorizzata o non verificabile alla posizione ' + i);
        }
        if (ev.verification_status === 'confirmed') anyConfirmed = true;
        else anyUnconfirmed = true;
      }
      if ((item.answer === 'yes' || item.answer === 'no') && !item.evidence.length) {
        return block(jobId, 'Risposta sì/no senza fonte documentale alla posizione ' + i);
      }
      let routed;
      if (item.answer === 'yes') {
        // Safety-biased: a possible present risk still activates the specialist.
        routed='yes';
      } else if (item.answer === 'no' && anyConfirmed && !anyUnconfirmed) {
        // A mixed confirmed/unconfirmed negative cannot silently exclude a specialist.
        routed='no';
      } else {
        routed='unknown';
      }
      if (routed==='unknown' || (item.answer==='yes' && !anyConfirmed)) {
        needsConfirmation.push(item.signal);
      }
      signals[item.signal]=routed;
      observations.push({
        signal:item.signal,provided_answer:item.answer,routed_answer:routed,
        evidence_count:item.evidence.length,confirmed_source:anyConfirmed,
        has_unconfirmed_sources:anyUnconfirmed
      });
    }
    // Missing signals are unknown and must be screened by the coordinator.
    const route = contract.routeSpecialists(signals);
    return {
      schema_version:'colligo-duvri-hse-screening/1.0', job_id:jobId,
      state:route.needs_screening.length || needsConfirmation.length ? 'needs_confirmation':'ready',
      signals, needs_confirmation:[...new Set([...needsConfirmation,...route.needs_screening])],
      observations,errors:[]
    };
  }
  return Object.freeze({ normalizeSpecialtyScreening });
})();
if (typeof module !== 'undefined' && module.exports) module.exports=duvriHseScreening;
