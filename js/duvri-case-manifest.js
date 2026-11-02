/*
 * COLLIGO DUVRI AI — isolated dossier file manifest validator.
 * Only checks structural metadata. It does NOT read user files, authenticate,
 * establish file ACLs, approve HSE facts, call AI or authorize DUVRI issuance.
 *
 * In production, the backend must read these records from authenticated private
 * storage and RECOMPUTE each SHA-256 from the uploaded bytes. Never trust
 * browser-provided file IDs, hashes, MIME labels or per-job permissions.
 */
const duvriCaseManifest = (() => {
  'use strict';
  const CHECKLIST_MIME =
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  const ATTACHMENT_MIME = Object.freeze([
    CHECKLIST_MIME,
    'application/pdf',
    'application/msword',
    'application/rtf',
    'text/plain',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv',
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/tiff'
  ]);
  // Some real customer uploads cannot be parsed safely yet. Keep them on the
  // private dossier as review-only files; do not silently discard or extract.
  const REVIEW_ONLY_MIME = Object.freeze([
    'application/zip',
    'application/x-zip-compressed',
    'image/heic',
    'image/heif'
  ]);
  const REVIEW_ONLY = new Set(REVIEW_ONLY_MIME);
  const ALLOWED = new Set([...ATTACHMENT_MIME,...REVIEW_ONLY_MIME]);
  const IMAGE = new Set(['image/jpeg','image/png','image/webp','image/tiff']);
  const ROLES = Object.freeze(['client_checklist','supporting_document','photograph','drawing']);
  const own = (x,k) => Object.prototype.hasOwnProperty.call(x,k);
  const record = x => x !== null && typeof x === 'object' && !Array.isArray(x);
  const identifier = x => typeof x === 'string' && /^[A-Za-z0-9_-]{6,128}$/.test(x);
  const sha = x => typeof x === 'string' && /^[a-f0-9]{64}$/i.test(x);
  function deny(jobId,reason) {
    return {
      schema_version:'colligo-duvri-file-manifest/1.0',
      job_id:identifier(jobId)?jobId:null,
      state:'blocked',files_count:0,attachment_count:0,
      files_for_authorization_review:[],manual_review_file_ids:[],requires_extraction:true,
      evidence_verified:false,issuance_allowed:false,errors:[reason]
    };
  }
  function assessManifest({jobId,documents}={}) {
    if(!identifier(jobId) || !Array.isArray(documents) ||
       documents.length===0 || documents.length>200)
      return deny(jobId,'Manifest non valido: fascicolo e documenti obbligatori');
    let checklist=0,attention=0;
    const fileIds=new Set(),checksums=new Set(),candidates=[],manualReview=[];
    for(let i=0;i<documents.length;i++){
      const f=documents[i];
      if(!record(f) ||
        Object.keys(f).some(k=>!['file_id','job_id','role','mime_type','size_bytes','sha256','parse_status'].includes(k)) ||
        !identifier(f.file_id) || !identifier(f.job_id) ||
        f.job_id!==jobId || fileIds.has(f.file_id) ||
        !ROLES.includes(f.role) || !ALLOWED.has(f.mime_type) ||
        !Number.isSafeInteger(f.size_bytes) || f.size_bytes<=0 ||
        !sha(f.sha256) ||
        !['pending','parsed','unreadable'].includes(f.parse_status))
        return deny(jobId,'File non valido o non appartenente al fascicolo: indice '+i);
      fileIds.add(f.file_id);
      if(checksums.has(f.sha256.toLowerCase()))
        return deny(jobId,'Copia duplicata nel fascicolo: indice '+i);
      checksums.add(f.sha256.toLowerCase());
      if(f.role==='client_checklist'){
        checklist++;
        if(f.mime_type!==CHECKLIST_MIME)
          return deny(jobId,'La checklist del cliente deve essere un documento Word DOCX');
      }
      if(f.role==='photograph' && !IMAGE.has(f.mime_type) &&
         !['image/heic','image/heif'].includes(f.mime_type))
        return deny(jobId,'Foto dichiarata con un formato non immagine');
      if(f.role==='drawing' && !IMAGE.has(f.mime_type) && f.mime_type!=='application/pdf')
        return deny(jobId,'Planimetria in formato non supportato');
      if(f.parse_status==='unreadable' || REVIEW_ONLY.has(f.mime_type)) {
        attention++;
        manualReview.push(f.file_id);
      } else candidates.push(f.file_id);
    }
    if(checklist!==1)
      return deny(jobId,'Richiesta una sola checklist principale DOCX per fascicolo');
    return {
      schema_version:'colligo-duvri-file-manifest/1.0',
      job_id:jobId,state:attention?'needs_attention':'ready_for_extraction',
      files_count:documents.length,attachment_count:documents.length-1,
      files_for_authorization_review:candidates,
      manual_review_file_ids:manualReview,
      requires_extraction:true,evidence_verified:false,
      issuance_allowed:false,errors:[]
    };
  }
  return Object.freeze({CHECKLIST_MIME,ATTACHMENT_MIME,REVIEW_ONLY_MIME,ROLES,assessManifest});
})();
if(typeof module!=='undefined'&&module.exports)module.exports=duvriCaseManifest;
