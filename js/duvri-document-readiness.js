/*
 * COLLIGO DUVRI AI — independent documentary readiness checkpoint (v1).
 * Written for the verified 2026 Colligo template (22 yellow segments, 27 comments).
 *
 * This pure function only evaluates trusted server-side QA attestations. It DOES NOT
 * inspect Word bytes, certify technical/legal accuracy, issue or approve a DUVRI.
 * Never accept raw browser/agent-supplied "true" values as QA attestations.
 */
const duvriDocumentReadiness = (() => {
  'use strict';
  // Only the prefix was supplied in the local Claude report. Never fabricate
  // the complete official checksum: it must come from a reviewed server manifest.
  const OFFICIAL_SHA256_PREFIX = '69b2f63c';
  const validSha256 = x => typeof x === 'string' && /^[0-9a-f]{64}$/i.test(x);
  const OFFICIAL_BASELINE = Object.freeze({
    yellow_segments: 22, yellow_runs: 62, editorial_comments: 27,
    sections: 19, tables: 13, text_boxes: 16
  });
  const own = (obj,key) => Object.prototype.hasOwnProperty.call(obj,key);
  const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{6,128}$/.test(value);
  const verifiedInteger = (v, min=0) => Number.isInteger(v) && v>=min && v<=100000;
  function assess({jobId, template, fields, editorial, risk, docx, hse} = {}) {
    const reasons=[];
    const add=(code,description)=>reasons.push({code,description});
    if (!validId(jobId)) add('JOB_ID','Identificativo fascicolo server non valido.');
    const approved = record(template) && template.approved === true &&
      template.manifest_verified === true &&
      validId(template.approval_record_id) &&
      validId(template.template_version) &&
      validSha256(template.expected_sha256) &&
      validSha256(template.source_sha256) &&
      template.source_sha256.toLowerCase() === template.expected_sha256.toLowerCase() &&
      template.expected_sha256.toLowerCase().startsWith(OFFICIAL_SHA256_PREFIX);
    if (!approved) add('TEMPLATE','Modello aziendale ufficiale non riconosciuto o non approvato.');
    if (!record(fields) ||
        !verifiedInteger(fields.expected) || fields.expected !== OFFICIAL_BASELINE.yellow_segments ||
        !verifiedInteger(fields.mapped) || fields.mapped !== fields.expected ||
        !verifiedInteger(fields.populated) ||
        !verifiedInteger(fields.not_applicable) ||
        fields.populated + fields.not_applicable !== fields.expected ||
        (fields.not_applicable > 0 && fields.not_applicable_approved !== true) ||
        !verifiedInteger(fields.human_verified) || fields.human_verified !== fields.expected ||
        fields.mapping_approved !== true ||
        fields.unresolved_yellow_segments !== 0) {
      add('YELLOW_FIELDS','I 22 segmenti gialli devono essere mappati, risolti e verificati; i non applicabili richiedono approvazione.');
    }
    if (!record(editorial) ||
        editorial.expected !== OFFICIAL_BASELINE.editorial_comments ||
        editorial.reviewed !== editorial.expected ||
        editorial.unresolved !== 0 ||
        editorial.content_rules_verified !== true) {
      add('EDITORIAL','I 27 commenti redazionali non sono stati tutti risolti e tradotti in regole controllate.');
    }
    if (!record(risk) || risk.method_approved !== true ||
        !validId(risk.method_approval_id) || !validId(risk.method_version) ||
        risk.tables_reviewed !== true ||
        risk.rows_source_mapped !== true ||
        risk.indices_validated_under_approved_method !== true) {
      add('RISK_METHOD','Metodo D1, tabelle rischio e indici non verificati formalmente.');
    }
    if (!record(docx) ||
        docx.source_unchanged !== true ||
        docx.generated_with_populated_fields !== true ||
        docx.structural_qa_passed !== true ||
        docx.visual_qa_after_population_passed !== true ||
        docx.editorial_comments_removed_or_approved !== true ||
        docx.signature_fields_identified !== true ||
        docx.signatures_verified_blank !== true ||
        docx.fixed_content_unchanged !== true ||
        docx.sections_tables_headers_verified !== true) {
      add('DOCX_QUALITY','Bozza reale compilata non verificata per contenuto fisso, layout, commenti, firme e tabelle.');
    }
    if (!record(hse) || hse.job_id !== jobId ||
        !validId(hse.analysis_revision_id) || !validId(hse.document_revision_id) ||
        hse.findings_decision_state !== 'draft_findings_reviewed' ||
        hse.open_blockers !== 0 ||
        hse.sources_rechecked !== true ||
        hse.professional_review_required !== true) {
      add('HSE_REVIEW','Revisione professionale o provenienza delle evidenze ancora incomplete.');
    }
    return {
      schema_version:'colligo-duvri-document-readiness/1.0',
      job_id: validId(jobId) ? jobId : null,
      state: reasons.length ? 'blocked' : 'eligible_for_final_technical_review',
      readiness_checks_passed: reasons.length === 0,
      duvri_approved: false,
      issuance_allowed: false,
      blockers: reasons
    };
  }
  return Object.freeze({OFFICIAL_SHA256_PREFIX,OFFICIAL_BASELINE,assess});
})();
if (typeof module !== 'undefined' && module.exports) module.exports = duvriDocumentReadiness;
