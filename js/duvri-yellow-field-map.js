/*
 * COLLIGO DUVRI AI — reviewable mapping manifest for 22 original yellow fields.
 * This module validates generic metadata only. It does not read/write DOCX,
 * assign values, expose customer data, approve templates, or compute risks.
 * Never trust reviewer IDs from a browser; the backend must enforce identity.
 */
const duvriYellowFieldMap = (() => {
  'use strict';
  const TOTAL_SEGMENTS = 22;
  const MODES = Object.freeze(['field', 'not_applicable', 'unreviewed']);
  const record = x => x !== null && typeof x === 'object' && !Array.isArray(x);
  const keysOnly = (obj, allowed) => Object.keys(obj).every(x=>allowed.includes(x));
  const validId = x => typeof x === 'string' && /^[a-zA-Z0-9_-]{6,128}$/.test(x);
  const validFieldPath = x => typeof x === 'string' &&
    /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*){0,3}$/.test(x) && x.length<=128;
  const nonempty = (x,max=500) => typeof x === 'string' && x.trim().length>0 && x.length<=max;

  function validateMapping({ templateVersion, mappingRevisionId, segments, expectedSegmentCount=TOTAL_SEGMENTS }={}) {
    const errors=[];
    const blocked = message => ({
      schema_version:'colligo-duvri-yellow-map/1.0',
      state:'blocked', mapping_approved:false,
      mapped:0, populated_expected:0, not_applicable:0,
      verified:0, unresolved:TOTAL_SEGMENTS, needs_review:[],
      errors:[message]
    });
    if (!validId(templateVersion) || !validId(mappingRevisionId) ||
        expectedSegmentCount!==TOTAL_SEGMENTS ||
        !Array.isArray(segments) || segments.length!==TOTAL_SEGMENTS) {
      return blocked('Versione e 22 segmenti del modello Colligo obbligatori');
    }
    const seen=new Set(), needsReview=[];
    let populatedExpected=0,notApplicable=0,verified=0,mapped=0;
    const validRows=new Array(TOTAL_SEGMENTS);
    for(let i=0;i<segments.length;i++){
      const r=segments[i],where='segment['+i+']';
      if(!record(r) || !keysOnly(r,['segment_id','mode','field_key','reason','reviewer_id','review_reference','reviewed'])){
        errors.push(where+': riga o campi non consentiti');continue;
      }
      if(!Number.isInteger(r.segment_id) || r.segment_id<1 ||
          r.segment_id>TOTAL_SEGMENTS || seen.has(r.segment_id)){
        errors.push(where+': identificatore duplicato o fuori intervallo');continue;
      }
      seen.add(r.segment_id);
      if(!MODES.includes(r.mode)){
        errors.push(where+': scelta non consentita');continue;
      }
      const reviewerValid = r.reviewed===true && validId(r.reviewer_id) &&
        validId(r.review_reference);
      if (r.mode==='field'){
        if(!validFieldPath(r.field_key) || (r.reason!==undefined && r.reason!=='')){
          errors.push(where+': campo da compilare richiede una chiave tecnica valida senza testo libero');continue;
        }
        mapped++;populatedExpected++;
      } else if(r.mode==='not_applicable'){
        if(!nonempty(r.reason) || (r.field_key!==undefined && r.field_key!==null)){
          errors.push(where+': non applicabile richiede motivo e nessuna chiave campo');continue;
        }
        mapped++;notApplicable++;
      } else {
        if ((r.field_key!==undefined && r.field_key!==null) ||
            (r.reason!==undefined && r.reason!=='')){
          errors.push(where+': elemento in sospeso non può sembrare già assegnato');continue;
        }
      }
      if(reviewerValid && r.mode!=='unreviewed') verified++;
      else needsReview.push(r.segment_id);
      validRows[r.segment_id-1]=r.mode;
    }
    if(errors.length || seen.size!==TOTAL_SEGMENTS){
      return blocked(errors.length?errors.join(' | '):'Segmenti mancanti');
    }
    const unresolved = TOTAL_SEGMENTS-mapped;
    return {
      schema_version:'colligo-duvri-yellow-map/1.0',
      state:unresolved===0 && verified===TOTAL_SEGMENTS ? 'mapping_ready' : 'needs_review',
      template_version:templateVersion,mapping_revision_id:mappingRevisionId,
      mapping_approved:unresolved===0 && verified===TOTAL_SEGMENTS,
      mapped,populated_expected:populatedExpected,not_applicable:notApplicable,
      verified,unresolved,needs_review:needsReview,errors:[],
      // This is only a mapping declaration: actual population and DOCX QA are separate.
      document_fields_populated:false,duvri_approved:false,issuance_allowed:false
    };
  }
  return Object.freeze({TOTAL_SEGMENTS,MODES,validateMapping});
})();
if(typeof module!=='undefined' && module.exports)module.exports=duvriYellowFieldMap;
