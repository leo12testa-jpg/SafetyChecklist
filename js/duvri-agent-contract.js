/*
 * COLLIGO DUVRI AI — isolated HSE agent contract, v1.
 * Deterministic checks only; NO AI, NO browser, NO network, NO risk calculations.
 * Not connected to the live SafetyChecklist app.
 */
const duvriAgentContract = (() => {
  'use strict';

  const AGENTS = Object.freeze([
    'documentale', 'normativa', 'antincendio', 'elettrico', 'lavori_quota',
    'cantieri', 'chimico_atex', 'spazi_confinati', 'macchine_impianti',
    'logistica', 'agenti_fisici', 'coordinamento'
  ]);
  const BASE_AGENTS = Object.freeze(['documentale', 'normativa', 'coordinamento']);
  const SIGNAL_TO_AGENT = Object.freeze({
    incendio_emergenze: 'antincendio',
    impianti_elettrici: 'elettrico',
    lavori_in_quota: 'lavori_quota',
    cantieri_edili: 'cantieri',
    chimici_atex: 'chimico_atex',
    ambienti_confinati: 'spazi_confinati',
    macchine_impianti: 'macchine_impianti',
    logistica_viabilita: 'logistica',
    agenti_fisici: 'agenti_fisici'
  });
  const SOURCE_TYPES = Object.freeze([
    'current_job_document', 'current_job_checklist',
    'historical_2026_reference', 'approved_internal_rule'
  ]);
  const CURRENT_SOURCES = new Set(['current_job_document', 'current_job_checklist']);
  const VERIFY_STATUSES = Object.freeze([
    'confirmed', 'extracted_unconfirmed',
    'historical_example_only', 'requires_verification'
  ]);

  const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
  const isText = (value, max = 10000) => typeof value === 'string' &&
    value.trim().length > 0 && value.length <= max;

  function keys(object, allowed, required, location, errors) {
    if (!isObject(object)) {
      errors.push(location + ': oggetto obbligatorio');
      return false;
    }
    for (const key of Object.keys(object)) {
      if (!allowed.includes(key)) errors.push(location + '.' + key + ': campo non consentito');
    }
    for (const key of required) {
      if (!hasOwn(object, key)) errors.push(location + '.' + key + ': campo mancante');
    }
    return true;
  }
  function text(value, location, errors, max) {
    if (!isText(value, max)) errors.push(location + ': testo obbligatorio o troppo lungo');
  }
  function evidence(item, location, errors, authorizedIds) {
    const fields = ['source_type', 'file_id', 'locator', 'excerpt_or_fact', 'verification_status'];
    if (!keys(item, fields, fields, location, errors)) return;
    if (!SOURCE_TYPES.includes(item.source_type)) errors.push(location + ': fonte sconosciuta');
    text(item.file_id, location + '.file_id', errors, 128);
    text(item.locator, location + '.locator', errors, 1000);
    text(item.excerpt_or_fact, location + '.excerpt_or_fact', errors, 2000);
    if (!VERIFY_STATUSES.includes(item.verification_status)) errors.push(location + ': verifica non valida');
    if (item.source_type === 'historical_2026_reference' &&
        item.verification_status !== 'historical_example_only') {
      errors.push(location + ': un DUVRI storico deve essere marcato solo come esempio');
    }
    if (item.source_type !== 'historical_2026_reference' &&
        item.verification_status === 'historical_example_only') {
      errors.push(location + ': historical_example_only riservato ai precedenti');
    }
    if (authorizedIds && !authorizedIds.has(item.file_id)) {
      errors.push(location + '.file_id: file non autorizzato per questo fascicolo');
    }
  }
  function evidenceList(items, location, errors, authorizedIds, minimum) {
    if (!Array.isArray(items) || items.length < minimum) {
      errors.push(location + ': riferimenti documentali insufficienti');
      return [];
    }
    items.forEach((item, i) => evidence(item, location + '[' + i + ']', errors, authorizedIds));
    return items.filter(isObject);
  }

  // 'no' excludes a specialist from automatic routing; it is NOT proof the risk is absent.
  // Missing / unknown always triggers screening rather than silent exclusion.
  function routeSpecialists(signals = {}) {
    if (!isObject(signals)) throw new TypeError('specialty_signals deve essere un oggetto');
    for (const [key, value] of Object.entries(signals)) {
      if (!hasOwn(SIGNAL_TO_AGENT, key)) throw new TypeError('Segnale sconosciuto: ' + key);
      if (!['yes', 'no', 'unknown'].includes(value)) {
        throw new TypeError('Segnale ' + key + ': yes, no o unknown');
      }
    }
    const selected_agents = [...BASE_AGENTS];
    const needs_screening = [];
    for (const [signal, agent] of Object.entries(SIGNAL_TO_AGENT)) {
      if (signals[signal] === 'yes') selected_agents.push(agent);
      else if (!hasOwn(signals, signal) || signals[signal] === 'unknown') needs_screening.push(signal);
    }
    return { selected_agents, needs_screening };
  }

  // This contract checks structure and provenance, NOT safety or legal correctness.
  // Production callers MUST supply jobId and all authorized file IDs on each invocation.
  function validateAgentResult(data, options = {}) {
    const errors = [];
    const main = ['schema_version', 'job_id', 'agent_id', 'status', 'findings',
      'missing_information', 'conflicts', 'requires_human_review'];
    if (!keys(data, main, main, '$', errors)) return { valid: false, errors };
    if (data.schema_version !== 'colligo-duvri-agent-analysis/1.0') {
      errors.push('$.schema_version: versione non supportata');
    }
    text(data.job_id, '$.job_id', errors, 128);
    if (options.jobId !== undefined && data.job_id !== options.jobId) {
      errors.push('$.job_id: fascicolo non corrispondente');
    }
    if (!AGENTS.includes(data.agent_id)) errors.push('$.agent_id: agente sconosciuto');
    if (!['completed', 'needs_clarification', 'not_applicable', 'blocked'].includes(data.status)) {
      errors.push('$.status: stato non valido');
    }
    if (data.requires_human_review !== true) errors.push('$.requires_human_review: revisione obbligatoria');
    let authorizedIds;
    if (options.allowedFileIds !== undefined) {
      if (!Array.isArray(options.allowedFileIds) && !(options.allowedFileIds instanceof Set)) {
        throw new TypeError('allowedFileIds deve essere array o Set');
      }
      authorizedIds = new Set(options.allowedFileIds);
    }
    if (!Array.isArray(data.findings)) errors.push('$.findings: elenco obbligatorio');
    else {
      const ids = new Set();
      data.findings.forEach((finding, i) => {
        const p = '$.findings[' + i + ']';
        const required = ['finding_id', 'category', 'work_phase', 'scenario',
          'interference_explanation', 'exposed_parties', 'source_evidence',
          'proposed_measures', 'validation_status'];
        if (!keys(finding, required, required, p, errors)) return;
        for (const key of ['finding_id', 'category', 'work_phase', 'scenario', 'interference_explanation']) {
          text(finding[key], p + '.' + key, errors, key === 'finding_id' ? 128 : 10000);
        }
        if (ids.has(finding.finding_id)) errors.push(p + '.finding_id: ID duplicato');
        ids.add(finding.finding_id);
        if (!Array.isArray(finding.exposed_parties) || finding.exposed_parties.length < 1 ||
            !finding.exposed_parties.every(v => isText(v, 200)) ||
            new Set(finding.exposed_parties).size !== finding.exposed_parties.length) {
          errors.push(p + '.exposed_parties: elenco non valido');
        }
        const sources = evidenceList(finding.source_evidence, p + '.source_evidence',
          errors, authorizedIds, 1);
        if (sources.length && !sources.some(s => CURRENT_SOURCES.has(s.source_type))) {
          errors.push(p + '.source_evidence: nessuna evidenza del lavoro corrente');
        }
        if (!Array.isArray(finding.proposed_measures)) {
          errors.push(p + '.proposed_measures: elenco obbligatorio');
        } else finding.proposed_measures.forEach((measure, j) => {
          const mp = p + '.proposed_measures[' + j + ']';
          const mr = ['proposal', 'implementation_owner_status', 'needs_human_validation'];
          if (!keys(measure, mr, mr, mp, errors)) return;
          text(measure.proposal, mp + '.proposal', errors);
          if (!['identified_in_sources', 'to_assign'].includes(measure.implementation_owner_status)) {
            errors.push(mp + '.implementation_owner_status: stato non valido');
          }
          if (measure.needs_human_validation !== true) errors.push(mp + ': validazione umana obbligatoria');
        });
        if (!['to_be_reviewed', 'requires_clarification'].includes(finding.validation_status)) {
          errors.push(p + '.validation_status: stato non valido');
        }
      });
    }
    if (!Array.isArray(data.missing_information)) errors.push('$.missing_information: elenco obbligatorio');
    else data.missing_information.forEach((item, i) => {
      const p = '$.missing_information[' + i + ']';
      const mr = ['question', 'why_needed', 'blocking'];
      if (!keys(item, mr, mr, p, errors)) return;
      text(item.question, p + '.question', errors);
      text(item.why_needed, p + '.why_needed', errors);
      if (typeof item.blocking !== 'boolean') errors.push(p + '.blocking: booleano obbligatorio');
    });
    if (!Array.isArray(data.conflicts)) errors.push('$.conflicts: elenco obbligatorio');
    else data.conflicts.forEach((item, i) => {
      const p = '$.conflicts[' + i + ']';
      const cr = ['description', 'evidence', 'resolution_question'];
      if (!keys(item, cr, cr, p, errors)) return;
      text(item.description, p + '.description', errors);
      text(item.resolution_question, p + '.resolution_question', errors);
      const sources = evidenceList(item.evidence, p + '.evidence', errors, authorizedIds, 2);
      if (sources.length && sources.filter(s => CURRENT_SOURCES.has(s.source_type)).length < 2) {
        errors.push(p + '.evidence: conflitto richiede almeno due evidenze del lavoro corrente');
      }
    });
    if (data.status === 'completed' && Array.isArray(data.missing_information) &&
        data.missing_information.some(item => isObject(item) && item.blocking === true)) {
      errors.push('$.status: completed incompatibile con dati bloccanti mancanti');
    }
    return { valid: errors.length === 0, errors };
  }

  return Object.freeze({ AGENTS, BASE_AGENTS, SIGNAL_TO_AGENT, routeSpecialists, validateAgentResult });
})();

if (typeof module !== 'undefined' && module.exports) module.exports = duvriAgentContract;
