/*
 * COLLIGO DUVRI AI — trust-boundary adapter for Claude's LOCAL Word QA report.
 *
 * Pure metadata contract, not a DOCX generator. The backend must independently
 * verify the source and output hashes, approval record, document revision and
 * analyst permissions. NEVER accept these fields directly from an AI message,
 * an uploaded document or a browser form.
 *
 * No customer names, file paths, document excerpts, API calls or network I/O.
 */
const duvriWordQaHandoff = (() => {
  'use strict';
  const SOURCE_VERSION = 'colligo-word-qa-local/1.0';
  const TARGET_VERSION = 'colligo-word-qa-handoff/1.0';
  const isObject = x => x !== null && typeof x === 'object' && !Array.isArray(x);
  const opaque = x => typeof x === 'string' && /^[A-Za-z0-9_-]{6,128}$/.test(x);
  const sha = x => typeof x === 'string' && /^[a-f0-9]{64}$/i.test(x);
  const integer = (x,max) => Number.isInteger(x) && x >= 0 && x <= max;
  const BOOLS = [
    'source_unchanged','populated_output_created','structural_qa_passed',
    'visual_qa_after_population_passed','fixed_content_unchanged',
    'sections_tables_headers_verified','editorial_rules_verified',
    'editorial_comments_removed_or_approved','signature_fields_identified',
    'signatures_verified_blank','risk_tables_reviewed','risk_rows_source_mapped'
  ];
  const NUMBERS = Object.freeze({
    yellow_segments_total:22, yellow_segments_populated:22,
    yellow_segments_not_applicable:22, yellow_segments_human_verified:22,
    yellow_segments_unresolved:22,
    editorial_comments_total:27, editorial_comments_reviewed:27,
    editorial_comments_unresolved:27
  });
  const FIELDS = Object.freeze([
    'schema_version','job_id','template_version','mapping_revision_id',
    'document_revision_id','qa_document_revision_id',
    'source_sha256','output_sha256','qa_output_sha256',
    'yellow_segments_total','yellow_segments_populated',
    'yellow_segments_not_applicable','yellow_segments_human_verified',
    'yellow_segments_unresolved','editorial_comments_total',
    'editorial_comments_reviewed','editorial_comments_unresolved',
    ...BOOLS
  ]);
  function block(reason,jobId) {
    return {
      schema_version: TARGET_VERSION,
      job_id: opaque(jobId) ? jobId : null,
      state:'blocked',population:null,editorial:null,docx:null,
      risk_table_layout:null,
      ready_for_technical_preflight:false,
      duvri_approved:false,issuance_allowed:false,errors:[reason]
    };
  }
  function normalize({jobId,templateVersion,mappingRevisionId,documentRevisionId,report}={}) {
    if (!opaque(jobId) || !opaque(templateVersion) ||
        !opaque(mappingRevisionId) || !opaque(documentRevisionId) ||
        !isObject(report) || Object.keys(report).some(x => !FIELDS.includes(x)) ||
        FIELDS.some(k=>!Object.prototype.hasOwnProperty.call(report,k)) ||
        report.schema_version !== SOURCE_VERSION ||
        report.job_id !== jobId ||
        report.template_version !== templateVersion ||
        report.mapping_revision_id !== mappingRevisionId ||
        report.document_revision_id !== documentRevisionId ||
        report.qa_document_revision_id !== documentRevisionId ||
        !sha(report.source_sha256) ||
        !BOOLS.every(k=>typeof report[k] === 'boolean') ||
        !Object.entries(NUMBERS).every(([k,max])=>integer(report[k],max)) ||
        report.yellow_segments_total !== 22 ||
        report.editorial_comments_total !== 27) {
      return block('Report Word QA non valido o non riferito alla revisione corrente',jobId);
    }
    const populated = report.yellow_segments_populated;
    const notApplicable = report.yellow_segments_not_applicable;
    const unresolved = report.yellow_segments_unresolved;
    const commentResolved = report.editorial_comments_reviewed === 27 &&
      report.editorial_comments_unresolved === 0 &&
      report.editorial_rules_verified &&
      report.editorial_comments_removed_or_approved;
    const fieldsResolved = populated+notApplicable===22 &&
      report.yellow_segments_human_verified===22 &&
      unresolved===0;
    const wordVerified = report.populated_output_created &&
      sha(report.output_sha256) && sha(report.qa_output_sha256) &&
      report.output_sha256.toLowerCase()===report.qa_output_sha256.toLowerCase() &&
      report.source_unchanged && report.structural_qa_passed &&
      report.visual_qa_after_population_passed &&
      report.fixed_content_unchanged &&
      report.sections_tables_headers_verified &&
      report.signature_fields_identified &&
      report.signatures_verified_blank;
    const riskTablesVerified=report.risk_tables_reviewed && report.risk_rows_source_mapped;
    const ready=Boolean(fieldsResolved && commentResolved && wordVerified && riskTablesVerified);
    // These are report-derived assertions only, never server attestations.
    return {
      schema_version:TARGET_VERSION,job_id:jobId,
      state: ready ? 'qa_report_complete' : 'needs_claude_review',
      mapping_revision_id:mappingRevisionId,
      document_revision_id:documentRevisionId,
      source_sha256:report.source_sha256.toLowerCase(),
      population: {
        document_revision_id:documentRevisionId,
        mapping_revision_id:mappingRevisionId,
        template_version:templateVersion,
        actual_populated:populated,
        actual_not_applicable:notApplicable,
        human_verified:report.yellow_segments_human_verified,
        unresolved
      },
      editorial:{
        expected:27,reviewed:report.editorial_comments_reviewed,
        unresolved:report.editorial_comments_unresolved,
        content_rules_verified:commentResolved
      },
      docx:{
        document_revision_id:documentRevisionId,
        qa_document_revision_id:documentRevisionId,
        output_sha256:sha(report.output_sha256)?report.output_sha256.toLowerCase():null,
        qa_output_sha256:sha(report.qa_output_sha256)?report.qa_output_sha256.toLowerCase():null,
        source_unchanged:report.source_unchanged,
        generated_with_populated_fields:report.populated_output_created,
        structural_qa_passed:report.structural_qa_passed,
        visual_qa_after_population_passed:report.visual_qa_after_population_passed,
        editorial_comments_removed_or_approved:report.editorial_comments_removed_or_approved,
        signature_fields_identified:report.signature_fields_identified,
        signatures_verified_blank:report.signatures_verified_blank,
        fixed_content_unchanged:report.fixed_content_unchanged,
        sections_tables_headers_verified:report.sections_tables_headers_verified
      },
      risk_table_layout:{
        tables_reviewed:report.risk_tables_reviewed,
        rows_source_mapped:report.risk_rows_source_mapped,
        method_D1_approved:false
      },
      ready_for_technical_preflight:false,
      duvri_approved:false,issuance_allowed:false,errors:[]
    };
  }
  return Object.freeze({SOURCE_VERSION,TARGET_VERSION,normalize});
})();
if(typeof module!=='undefined'&&module.exports)module.exports=duvriWordQaHandoff;
