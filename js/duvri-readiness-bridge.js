/*
 * COLLIGO DUVRI AI — revision-bound final technical review preflight.
 * Pure cross-module consistency check; cannot issue/approve a DUVRI.
 * Backend MUST derive these input records from trusted, immutable storage,
 * recompute actual SHA-256 values and enforce access controls on every job.
 */
const duvriReadinessBridge = (() => {
  'use strict';
  const readiness = typeof require === 'function'
    ? require('./duvri-document-readiness.js')
    : (typeof duvriDocumentReadiness !== 'undefined' ? duvriDocumentReadiness : null);

  const isRecord = x => x !== null && typeof x === 'object' && !Array.isArray(x);
  const validId = x => typeof x === 'string' && /^[A-Za-z0-9_-]{6,128}$/.test(x);
  const count = x => Number.isInteger(x) && x >= 0 && x <= 22;
  const validSha256 = x => typeof x === 'string' && /^[0-9a-f]{64}$/i.test(x);
  const blocked = (jobId, code, description) => ({
    schema_version: 'colligo-duvri-technical-preflight/1.0',
    job_id: validId(jobId) ? jobId : null,
    state: 'blocked',
    technical_review_eligible: false,
    duvri_approved: false,
    issuance_allowed: false,
    blockers: [{code,description}]
  });

  function assessTechnicalPreflight({
    jobId, analysisRevisionId, documentRevisionId,
    template, mapping, population, editorial, risk, docx,
    review, hseOpenBlockers, sourcesRechecked, rejectedFindingsResolved
  } = {}) {
    if (!readiness) return blocked(jobId, 'DEPENDENCY', 'Controllo documentale non disponibile');
    if (!validId(jobId) || !validId(analysisRevisionId) ||
        !validId(documentRevisionId)) {
      return blocked(jobId, 'REVISION', 'Fascicolo e revisioni server obbligatori');
    }
    if (!isRecord(template) || !isRecord(mapping) ||
        mapping.schema_version !== 'colligo-duvri-yellow-map/1.0' ||
        mapping.template_version !== template.template_version ||
        !validId(mapping.mapping_revision_id) ||
        !Array.isArray(mapping.needs_review) || mapping.needs_review.length !== 0 ||
        mapping.state !== 'mapping_ready' || mapping.mapping_approved !== true ||
        mapping.mapped !== 22 || mapping.verified !== 22 ||
        mapping.unresolved !== 0 || !Array.isArray(mapping.errors) || mapping.errors.length ||
        !count(mapping.populated_expected) || !count(mapping.not_applicable) ||
        mapping.populated_expected + mapping.not_applicable !== 22 ||
        mapping.document_fields_populated !== false ||
        mapping.issuance_allowed !== false) {
      return blocked(jobId, 'MAPPING', 'Mappa dei 22 segmenti non approvata o incompatibile con il modello');
    }
    if (!isRecord(population) ||
        population.document_revision_id !== documentRevisionId ||
        population.template_version !== template.template_version ||
        population.mapping_revision_id !== mapping.mapping_revision_id ||
        !count(population.actual_populated) ||
        !count(population.actual_not_applicable) ||
        !count(population.human_verified) ||
        population.actual_populated !== mapping.populated_expected ||
        population.actual_not_applicable !== mapping.not_applicable ||
        population.human_verified !== 22 ||
        population.unresolved !== 0 ||
        population.mapping_approved_by_backend !== true ||
        (mapping.not_applicable > 0 && population.not_applicable_approved !== true)) {
      return blocked(jobId, 'POPULATION', 'Compilazione Word non corrisponde alla mappa approvata o alla revisione corrente');
    }
    if (!isRecord(docx) ||
        docx.document_revision_id !== documentRevisionId ||
        docx.qa_document_revision_id !== documentRevisionId ||
        !validSha256(docx.output_sha256) ||
        !validSha256(docx.qa_output_sha256) ||
        docx.output_sha256.toLowerCase() !== docx.qa_output_sha256.toLowerCase() ||
        docx.output_sha256_verified !== true) {
      return blocked(jobId, 'DOCX_REVISION', 'Report QA del DOCX non riferito alla revisione corrente');
    }
    if (!isRecord(review) || review.schema_version !== 'colligo-duvri-review-decisions/1.0' ||
        review.state !== 'draft_findings_reviewed' ||
        review.job_id !== jobId ||
        review.analysis_revision_id !== analysisRevisionId ||
        review.document_revision_id !== documentRevisionId ||
        review.draft_findings_reviewed !== true ||
        review.duvri_approved !== false || review.issuance_allowed !== false ||
        !Array.isArray(review.decisions) || review.decisions.length === 0 ||
        review.decisions.some(d => !isRecord(d) ||
          !validId(d.agent_id) || !validId(d.finding_id) ||
          !['accept_for_draft','reject'].includes(d.action)) ||
        review.has_rejected_findings !== review.decisions.some(d => d.action === 'reject') ||
        !Array.isArray(review.pending) || review.pending.length !== 0 ||
        !Array.isArray(review.errors) || review.errors.length !== 0) {
      return blocked(jobId, 'REVIEW_REVISION', 'Decisioni HSE incomplete o associate a revisioni superate');
    }
    if (review.has_rejected_findings === true &&
        rejectedFindingsResolved !== true) {
      return blocked(jobId, 'REJECTED_FINDINGS', 'Le valutazioni respinte richiedono una risoluzione tecnica distinta');
    }
    if (hseOpenBlockers !== 0 || sourcesRechecked !== true) {
      return blocked(jobId, 'EVIDENCE_QA', 'Blocchi HSE o riconferma delle fonti non risolti');
    }
    const fieldReport = {
      expected: 22, mapped: mapping.mapped,
      populated: population.actual_populated,
      not_applicable: population.actual_not_applicable,
      not_applicable_approved: mapping.not_applicable === 0 ||
        population.not_applicable_approved === true,
      human_verified: population.human_verified,
      mapping_approved: population.mapping_approved_by_backend === true,
      unresolved_yellow_segments: population.unresolved
    };
    const report = readiness.assess({
      jobId,template,fields:fieldReport,editorial,risk,docx,
      hse: {
        job_id: jobId,analysis_revision_id: analysisRevisionId,
        document_revision_id: documentRevisionId,
        findings_decision_state: review.state,
        open_blockers: hseOpenBlockers,
        sources_rechecked: sourcesRechecked,
        professional_review_required: true
      }
    });
    return {
      schema_version: 'colligo-duvri-technical-preflight/1.0',
      job_id: jobId,
      state: report.state,
      technical_review_eligible: report.readiness_checks_passed === true,
      duvri_approved: false,
      issuance_allowed: false,
      blockers: report.blockers
    };
  }

  return Object.freeze({assessTechnicalPreflight});
})();
if (typeof module !== 'undefined' && module.exports) module.exports = duvriReadinessBridge;
