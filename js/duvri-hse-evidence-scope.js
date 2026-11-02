/*
 * COLLIGO DUVRI AI — HSE source authorization scope (isolated, deterministic).
 * Bridges a dossier file manifest with trustworthy, revision-bound extraction
 * attestations. No AI inference, risk scoring, Word editing, uploads or storage.
 *
 * Crucial trust boundary: the future backend MUST independently fetch file
 * rows and attestations from authenticated private storage; NEVER call this
 * with objects supplied directly by a client, an LLM or an uploaded document.
 */
const duvriHseEvidenceScope = (() => {
  'use strict';
  const dossier = typeof require === 'function'
    ? require('./duvri-case-manifest.js')
    : (typeof duvriCaseManifest !== 'undefined' ? duvriCaseManifest : null);

  const isRecord = x => x!==null && typeof x==='object' && !Array.isArray(x);
  const id = x => typeof x==='string' && /^[A-Za-z0-9_-]{6,128}$/.test(x);
  const sha = x => typeof x==='string' && /^[a-fA-F0-9]{64}$/.test(x);
  const ownKeys = (x,keys) => isRecord(x) && Object.keys(x).every(k=>keys.includes(k));
  const fields=['schema_version','job_id','analysis_revision_id','extraction_revision_id',
    'file_id','source_sha256','evidence_kind','source_locator_verified','backend_verified'];
  const textMimes = new Set([
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/pdf','application/msword','application/rtf','text/plain',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','text/csv'
  ]);
  const imageMimes = new Set(['image/jpeg','image/png','image/webp','image/tiff']);
  function blocked(jobId,reason) {
    return {
      schema_version:'colligo-duvri-hse-evidence-scope/1.0',
      job_id:id(jobId)?jobId:null,
      state:'blocked', allowed_file_ids:[], withheld_file_ids:[],
      manual_review_file_ids:[], checklist_ready:false,
      analysis_revision_id:null, issuance_allowed:false,
      evidence_verified:false, human_review_required:true,
      reasons:[reason]
    };
  }
  function buildHseEvidenceScope({jobId,analysisRevisionId,files,extractions}={}) {
    if(!dossier || !id(jobId) || !id(analysisRevisionId) ||
      !Array.isArray(files) || !Array.isArray(extractions) ||
      extractions.length>200) {
      return blocked(jobId,'Contesto fascicolo o estrazioni backend mancanti');
    }
    const report=dossier.assessManifest({jobId,documents:files});
    if(report.state==='blocked') {
      return blocked(jobId,'Manifest del fascicolo non valido: '+report.errors.join(' | '));
    }
    const fileMap=new Map(files.map(f=>[f.file_id,f]));
    const attested=new Map();
    for(const [n,e] of extractions.entries()) {
      if(!ownKeys(e,fields) || Object.keys(e).length!==fields.length ||
        e.schema_version!=='colligo-duvri-extraction-attestation/1.0' ||
        e.job_id!==jobId || e.analysis_revision_id!==analysisRevisionId ||
        !id(e.extraction_revision_id) || !id(e.file_id) ||
        !sha(e.source_sha256) ||
        !['extracted_text','human_verified_image'].includes(e.evidence_kind) ||
        e.source_locator_verified!==true || e.backend_verified!==true ||
        attested.has(e.file_id) || !fileMap.has(e.file_id)) {
        return blocked(jobId,'Attestazione estrazione duplicata, incompleta o non autorizzata: '+n);
      }
      const f=fileMap.get(e.file_id);
      if(f.parse_status!=='parsed' ||
        f.sha256.toLowerCase()!==e.source_sha256.toLowerCase() ||
        (textMimes.has(f.mime_type) && e.evidence_kind!=='extracted_text') ||
        (imageMimes.has(f.mime_type) && e.evidence_kind!=='human_verified_image') ||
        (!textMimes.has(f.mime_type) && !imageMimes.has(f.mime_type))) {
        return blocked(jobId,'Attestazione incompatibile con file, impronta o lettura: '+n);
      }
      attested.set(e.file_id,e);
    }
    const allowed=[],withheld=[];
    for(const f of files) {
      if(attested.has(f.file_id)) allowed.push(f.file_id);
      else withheld.push(f.file_id);
    }
    const checklist=files.find(f=>f.role==='client_checklist');
    const checklistReady=Boolean(checklist && attested.has(checklist.file_id));
    const extraReady=files.some(f=>f.role!=='client_checklist' && attested.has(f.file_id));
    const ready=checklistReady && extraReady && withheld.length===0 &&
      report.state==='ready_for_extraction';
    const reasons=[];
    if(!checklistReady) reasons.push('Checklist Word non ancora estratta e verificata');
    if(!extraReady) reasons.push('Nessun allegato con fonte verificata');
    if(withheld.length) reasons.push('Documenti non estratti o da verifica manuale: '+withheld.length);
    return {
      schema_version:'colligo-duvri-hse-evidence-scope/1.0',
      job_id:jobId,analysis_revision_id:analysisRevisionId,
      state:ready?'ready_for_hse_screening':'awaiting_extraction',
      allowed_file_ids:allowed,
      withheld_file_ids:withheld,
      manual_review_file_ids:report.manual_review_file_ids,
      checklist_ready:checklistReady,
      // Even a complete provenance scope is NOT a professional endorsement.
      evidence_verified:false,human_review_required:true,
      issuance_allowed:false,reasons
    };
  }
  return Object.freeze({buildHseEvidenceScope});
})();
if(typeof module!=='undefined'&&module.exports)module.exports=duvriHseEvidenceScope;
