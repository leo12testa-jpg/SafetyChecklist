/*
 * COLLIGO DUVRI AI — isolated, deterministic review packet assembler (v1).
 * Does not assess occupational risk, generate DUVRI, invoke AI or approve work.
 * All inputs must come from the trusted backend, never directly from a user.
 */
const duvriHseCoordinator = (() => {
  'use strict';

  const contract = typeof require === 'function'
    ? require('./duvri-agent-contract.js')
    : (typeof duvriAgentContract !== 'undefined' ? duvriAgentContract : null);

  const isRecord = x => x !== null && typeof x === 'object' && !Array.isArray(x);
  const isIdentifier = x => typeof x === 'string' && x.length > 0 && x.length <= 128 && x.trim().length > 0;
  const snapshot = x => JSON.parse(JSON.stringify(x));

  /**
   * Build an HSE review packet with preserved agent provenance.
   * No automatic risk scoring, deduplication or technical approval.
   * On any malformed input, return blocked with no findings.
   */
  function buildReviewPacket({ jobId, analysisRevisionId, specialtySignals, agentResults, allowedFileIds } = {}) {
    const blocked = message => ({
      schema_version: 'colligo-duvri-review-packet/1.0',
      job_id: isIdentifier(jobId) ? jobId : null,
      state: 'blocked', human_review_required: true,
      issuance_allowed: false, required_agents: [], pending_agents: [],
      screening_required: [], findings: [], missing_information: [],
      conflicts: [], possible_overlaps: [], blocking_reasons: [message]
    });
    if (!contract) return blocked('Contratto agenti non disponibile');
    if (!isIdentifier(jobId) || !Array.isArray(agentResults) ||
        !(Array.isArray(allowedFileIds) || allowedFileIds instanceof Set)) {
      return blocked('Configurazione backend incompleta: jobId, risultati e file autorizzati obbligatori');
    }
    let route;
    try { route = contract.routeSpecialists(specialtySignals); }
    catch (_) { return blocked('Segnali di screening non validi'); }

    const required = route.selected_agents;
    const authorizedIds = new Set(allowedFileIds);
    const received = new Map();
    const errors = [];
    for (const result of agentResults) {
      if (!isRecord(result) || !isIdentifier(result.agent_id)) {
        errors.push('Output di agente non valido');
        continue;
      }
      const agent = result.agent_id;
      if (!required.includes(agent)) {
        errors.push('Output di agente non richiesto: ' + agent);
        continue;
      }
      if (received.has(agent)) {
        errors.push('Risposta duplicata dell’agente ' + agent);
        continue;
      }
      const validation = contract.validateAgentResult(result, {
        jobId, allowedFileIds: authorizedIds
      });
      if (!validation.valid) {
        errors.push('Risposta non valida di ' + agent + ': ' + validation.errors.join(' | '));
        continue;
      }
      if (result.status === 'not_applicable' && (result.findings.length || result.conflicts.length)) {
        errors.push('Agente non applicabile con interferenze/conflitti: ' + agent);
        continue;
      }
      received.set(agent, snapshot(result));
    }
    // Never return content from an invalid or unauthorized batch.
    if (errors.length) return blocked(errors.join(' ; '));

    const pending = required.filter(agent => !received.has(agent));
    const findings = [];
    const missing = [];
    const conflicts = [];
    const blockers = [];
    const overlapIndex = new Map();
    for (const agent of required) {
      const result = received.get(agent);
      if (!result) continue;
      if (result.status === 'blocked') blockers.push('Agente bloccato: ' + agent);
      result.findings.forEach(f => {
        const record = { agent_id: agent, ...f };
        findings.push(record);
        // Only flag exact comparable descriptions for human inspection; never merge findings.
        const key = [f.category, f.work_phase, f.scenario]
          .map(s => s.trim().toLocaleLowerCase('it')).join('\u0000');
        if (!overlapIndex.has(key)) overlapIndex.set(key, []);
        overlapIndex.get(key).push({ agent_id: agent, finding_id: f.finding_id });
      });
      result.missing_information.forEach(m => missing.push({ agent_id: agent, ...m }));
      result.conflicts.forEach(c => conflicts.push({ agent_id: agent, ...c }));
    }
    const possibleOverlaps = [...overlapIndex.values()].filter(group =>
      new Set(group.map(x => x.agent_id)).size > 1
    );
    if (pending.length) blockers.push('Agenti senza risposta: ' + pending.join(', '));
    const needsInput = route.needs_screening.length > 0 ||
      missing.some(x => x.blocking) || conflicts.length > 0 ||
      findings.some(x => x.validation_status === 'requires_clarification') ||
      [...received.values()].some(x => x.status === 'needs_clarification');
    // An incomplete evaluation is never a completed DUVRI.
    const state = blockers.length ? 'blocked' : needsInput ? 'awaiting_input' : 'needs_review';
    return {
      schema_version: 'colligo-duvri-review-packet/1.0', job_id: jobId,
      state, human_review_required: true, issuance_allowed: false,
      required_agents: [...required], pending_agents: pending,
      screening_required: [...route.needs_screening], findings,
      missing_information: missing, conflicts,
      possible_overlaps: possibleOverlaps, blocking_reasons: blockers
    };
  }
  return Object.freeze({ buildReviewPacket });
})();

if (typeof module !== 'undefined' && module.exports) module.exports = duvriHseCoordinator;
