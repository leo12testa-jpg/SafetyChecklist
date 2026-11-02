/*
 * COLLIGO DUVRI AI — isolated HSE proposal review gate (v1).
 * Records decisions on findings, NOT document approval or legal issuance.
 * The surrounding backend MUST authenticate the reviewer, load the packet and
 * revision from private storage, and determine privileges server-side.
 * No AI calls, persistence, network or customer data in this module.
 */
const duvriHseReview = (() => {
  'use strict';
  const isRecord = x => x !== null && typeof x === 'object' && !Array.isArray(x);
  const opaque = x => typeof x === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(x);
  const text = (x, max=4000) => typeof x === 'string' && x.trim().length > 0 && x.length <= max;
  const DECISIONS = Object.freeze(['accept_for_draft', 'reject', 'request_changes']);
  const PERMITTED_ROLES = Object.freeze(['tecnico', 'admin']);

  function blocked(reason, jobId) {
    return {
      schema_version: 'colligo-duvri-review-decisions/1.0',
      job_id: opaque(jobId) ? jobId : null,
      state: 'blocked',
      draft_findings_reviewed: false,
      duvri_approved: false,
      issuance_allowed: false,
      decisions: [],
      pending: [],
      errors: [reason]
    };
  }

  // Reviewer context and packet MUST be trusted server inputs, NOT client claims.
  function prepareReviewDecisions({packet, decisions, reviewerContext} = {}) {
    const jobId = isRecord(packet) ? packet.job_id : null;
    if (!isRecord(packet) || !isRecord(reviewerContext)) {
      return blocked('Pacchetto e contesto revisore verificato obbligatori', jobId);
    }
    const ctx = reviewerContext;
    if (!opaque(ctx.job_id) || ctx.job_id !== jobId ||
        !opaque(ctx.reviewer_id) || !opaque(ctx.document_revision_id) ||
        ctx.authenticated !== true || ctx.can_review !== true ||
        !PERMITTED_ROLES.includes(ctx.role)) {
      return blocked('Revisore non autorizzato, revisione o fascicolo non validi', jobId);
    }
    if (packet.schema_version !== 'colligo-duvri-review-packet/1.0' ||
        packet.state !== 'needs_review' || packet.issuance_allowed !== false ||
        packet.human_review_required !== true ||
        !Array.isArray(packet.findings) ||
        !Array.isArray(packet.pending_agents) || packet.pending_agents.length ||
        !Array.isArray(packet.blocking_reasons) || packet.blocking_reasons.length ||
        !Array.isArray(packet.conflicts) || packet.conflicts.length ||
        !Array.isArray(packet.screening_required) || packet.screening_required.length ||
        !Array.isArray(packet.missing_information) ||
        packet.missing_information.some(m => !isRecord(m) || m.blocking === true) ||
        packet.findings.some(f => !isRecord(f) ||
          f.validation_status !== 'to_be_reviewed')) {
      return blocked('Analisi HSE incompleta o chiarimenti/conflitti non risolti', jobId);
    }
    if (packet.findings.length === 0) {
      return blocked('Nessun finding: richiedere determinazione tecnica esplicita', jobId);
    }
    if (!Array.isArray(decisions)) return blocked('Elenco delle decisioni obbligatorio', jobId);
    const errors = [];
    const expected = new Map();
    for (const finding of packet.findings) {
      if (!opaque(finding.agent_id) || !opaque(finding.finding_id)) {
        return blocked('Identificatori delle valutazioni non validi', jobId);
      }
      const key = finding.agent_id + '\u0000' + finding.finding_id;
      if (expected.has(key)) return blocked('Finding duplicato nel pacchetto', jobId);
      expected.set(key, finding);
    }
    const reviewed = [];
    const seen = new Set();
    for (const [i, item] of decisions.entries()) {
      const at = 'decision[' + i + ']';
      if (!isRecord(item) ||
          Object.keys(item).some(k => !['agent_id', 'finding_id', 'action', 'note'].includes(k)) ||
          !opaque(item.agent_id) || !opaque(item.finding_id) ||
          !DECISIONS.includes(item.action) ||
          (item.note !== undefined &&
            (typeof item.note !== 'string' || item.note.length > 4000))) {
        errors.push(at + ': formato o azione non consentita');
        continue;
      }
      if ((item.action === 'reject' || item.action === 'request_changes') &&
          !text(item.note)) {
        errors.push(at + ': motivazione richiesta');
        continue;
      }
      const key = item.agent_id + '\u0000' + item.finding_id;
      if (!expected.has(key)) {
        errors.push(at + ': finding non appartenente al fascicolo');
        continue;
      }
      if (seen.has(key)) {
        errors.push(at + ': decisione duplicata');
        continue;
      }
      seen.add(key);
      reviewed.push({
        agent_id: item.agent_id,
        finding_id: item.finding_id,
        action: item.action,
        note: typeof item.note === 'string' ? item.note : ''
      });
    }
    if (errors.length) return blocked(errors.join(' | '), jobId);
    const pending = [...expected.keys()].filter(k => !seen.has(k)).map(k => {
      const [agent_id, finding_id] = k.split('\u0000');
      return {agent_id, finding_id};
    });
    const requestChanges = reviewed.some(r => r.action === 'request_changes');
    const rejected = reviewed.some(r => r.action === 'reject');
    const complete = pending.length === 0 && !requestChanges;
    return {
      schema_version: 'colligo-duvri-review-decisions/1.0',
      job_id: jobId,
      document_revision_id: ctx.document_revision_id,
      reviewer_id: ctx.reviewer_id,
      state: pending.length ? 'awaiting_decisions' :
        requestChanges ? 'changes_requested' : 'draft_findings_reviewed',
      draft_findings_reviewed: complete,
      has_rejected_findings: rejected,
      duvri_approved: false,
      issuance_allowed: false,
      decisions: reviewed, pending, errors: []
    };
  }

  return Object.freeze({DECISIONS, PERMITTED_ROLES, prepareReviewDecisions});
})();
if (typeof module !== 'undefined' && module.exports) module.exports = duvriHseReview;
