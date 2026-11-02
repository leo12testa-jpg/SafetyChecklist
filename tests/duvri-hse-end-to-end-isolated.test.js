'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { findHistoricalReferences } = require('../js/duvri-historical-references.js');
const { buildReviewPacket } = require('../js/duvri-hse-coordinator.js');
const { prepareReviewDecisions } = require('../js/duvri-hse-review.js');

const jobId='FASCICOLO_SYNTH_E2E_001';
const authorizedFile='CHECKLIST_SYNTH_001';
const archiveId='ARCH_2026_SYNTH_001';
const categories={lavori_in_quota:'yes',incendio_emergenze:'no',impianti_elettrici:'no',
  cantieri_edili:'no',chimici_atex:'no',ambienti_confinati:'no',macchine_impianti:'no',
  logistica_viabilita:'no',agenti_fisici:'no'};
const agent = (id, findings=[])=>({
  schema_version:'colligo-duvri-agent-analysis/1.0',job_id:jobId,agent_id:id,status:'completed',
  findings,missing_information:[],conflicts:[],requires_human_review:true
});
const source=(source_type,file_id,verification_status)=>({
  source_type,file_id,locator:'sezione sintetica 2',excerpt_or_fact:'Dati sintetici non reali',
  verification_status
});
const finding=()=>({
  finding_id:'F-SYNTH-001',category:'caduta_materiali',work_phase:'intervento in copertura',
  scenario:'Manutenzione sopra passaggio aziendale',interference_explanation:'Percorso terzi sottostante',
  exposed_parties:['lavoratori committente'],
  source_evidence:[source('current_job_checklist',authorizedFile,'confirmed')],
  proposed_measures:[{
    proposal:'Valutare la segregazione dell area sottostante',implementation_owner_status:'to_assign',
    needs_human_validation:true
  }],
  validation_status:'to_be_reviewed'
});
const allResults=(oneFinding=finding())=>[
  agent('documentale'),agent('normativa'),agent('coordinamento'),
  agent('lavori_quota',oneFinding?[oneFinding]:[])
];
const build=(agentResults=allResults(),allowedFileIds=[authorizedFile])=>
  buildReviewPacket({jobId,analysisRevisionId:'ANALYSIS_SYNTH_E2E_001',specialtySignals:categories,agentResults,
    allowedFileIds,allowedHistoricalReferenceIds:[archiveId]});
const reviewer={job_id:jobId,reviewer_id:'TECNICO_SYNTH_001',
  document_revision_id:'REV_SYNTH_001',analysis_revision_id:'ANALYSIS_SYNTH_E2E_001',role:'tecnico',authenticated:true,can_review:true};
const decision={agent_id:'lavori_quota',finding_id:'F-SYNTH-001',action:'accept_for_draft'};

test('synthetic 2026 precedent retrieval feeds no auto-approval to HSE review',()=>{
  const match=findHistoricalReferences({
    job_id:jobId,activity_tags:['lavori_in_quota'],interference_tags:['caduta_materiali'],limit:3
  },[{archive_id:archiveId,year:2026,year_status:'confirmed',document_status:'finale',
    activity_tags:['lavori_in_quota'],interference_tags:['caduta_materiali']}]);
  assert.equal(match.ok,true);assert.equal(match.references.length,1);
  assert.equal(match.references[0].current_job_evidence,false);
  const f=finding();
  f.source_evidence.push(source('historical_2026_reference',match.references[0].archive_id,'historical_example_only'));
  const packet=build(allResults(f));
  assert.equal(packet.state,'needs_review');
  assert.equal(packet.findings[0].source_evidence.length,2);
  const reviewed=prepareReviewDecisions({packet,decisions:[decision],reviewerContext:reviewer});
  assert.equal(reviewed.state,'draft_findings_reviewed');
  assert.equal(reviewed.duvri_approved,false);
  assert.equal(reviewed.issuance_allowed,false);
});

test('historical precedent without current evidence is rejected and review stays blocked',()=>{
  const f=finding();f.source_evidence=[source('historical_2026_reference',archiveId,'historical_example_only')];
  const packet=build(allResults(f));
  assert.equal(packet.state,'blocked');
  assert.equal(packet.findings.length,0);
  const reviewed=prepareReviewDecisions({packet,decisions:[decision],reviewerContext:reviewer});
  assert.equal(reviewed.state,'blocked');
});

test('one conflicting or missing agent prevents review even with approved reviewer',()=>{
  const packet=build(allResults().slice(0,3));
  assert.equal(packet.state,'blocked');
  const review=prepareReviewDecisions({packet,decisions:[decision],reviewerContext:reviewer});
  assert.equal(review.state,'blocked');
});
test('review decisions from an unauthorized job cannot be applied',()=>{
  const packet=build();
  const review=prepareReviewDecisions({packet,decisions:[decision],
    reviewerContext:{...reviewer,job_id:'ANOTHER_JOB'}});
  assert.equal(review.state,'blocked');
  assert.equal(review.decisions.length,0);
});
test('change request cannot be equated to reviewed draft',()=>{
  const packet=build();
  const review=prepareReviewDecisions({packet,decisions:[{...decision,action:'request_changes',
    note:'Accertare uso del passaggio da terzi'}],reviewerContext:reviewer});
  assert.equal(review.state,'changes_requested');
  assert.equal(review.draft_findings_reviewed,false);
  assert.equal(review.issuance_allowed,false);
});
test('a new case with same historical topic but no source must not import last case',()=>{
  const f=finding();f.source_evidence=[source('current_job_checklist',authorizedFile,'confirmed')];
  const packet=build(allResults(f),['FILE_OTHER_JOB']);
  assert.equal(packet.state,'blocked');
  assert.equal(packet.findings.length,0);
});
