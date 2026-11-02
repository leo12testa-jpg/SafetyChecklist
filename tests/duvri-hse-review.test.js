'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildReviewPacket } = require('../js/duvri-hse-coordinator.js');
const { prepareReviewDecisions, DECISIONS } = require('../js/duvri-hse-review.js');
const example = JSON.parse(fs.readFileSync(path.join(__dirname, '../schemas/duvri-agent-analysis.v1.example.json'), 'utf8'));
const clone = x => structuredClone(x);
const job = 'FASCICOLO_TEST_SYNTH_001';
const signals = { lavori_in_quota: 'yes', incendio_emergenze: 'no', impianti_elettrici: 'no',
  cantieri_edili: 'no', chimici_atex: 'no', ambienti_confinati: 'no',
  macchine_impianti: 'no', logistica_viabilita: 'no', agenti_fisici: 'no' };
const mk = (agent, findings=[]) => ({
  schema_version:'colligo-duvri-agent-analysis/1.0',
  job_id:job, agent_id:agent, status:'completed', findings,
  missing_information:[], conflicts:[], requires_human_review:true
});
function packet() {
  const finding=clone(example.findings[0]);
  finding.validation_status = 'to_be_reviewed';
  return buildReviewPacket({jobId:job, analysisRevisionId:'ANALYSIS_SYNTH_001', specialtySignals:signals, allowedFileIds:['FILE_TEST_001'],
    agentResults:[
      mk('documentale'),mk('normativa'),mk('coordinamento'),mk('lavori_quota',[finding])
    ]});
}
const context = {job_id:job, reviewer_id:'TECNICO_SYNTH_01',
  document_revision_id:'REV_SYNTH_001', analysis_revision_id:'ANALYSIS_SYNTH_001', role:'tecnico',
  authenticated:true, can_review:true};
const accepted = {agent_id:'lavori_quota',finding_id:'F-001',action:'accept_for_draft'};
const run = (p=packet(),d=[accepted],c=context) =>
  prepareReviewDecisions({packet:p,decisions:d,reviewerContext:c});

test('review readiness requires successful coordinator packet', () => {
  assert.equal(packet().state,'needs_review');
  const r=run();
  assert.equal(r.state,'draft_findings_reviewed');
  assert.equal(r.draft_findings_reviewed,true);
  assert.equal(r.issuance_allowed,false);
  assert.equal(r.duvri_approved,false);
  assert.equal(r.document_revision_id,'REV_SYNTH_001');
});
test('even accepted findings do not approve or issue the DUVRI', () => {
  const r=run();
  assert.deepEqual(r.decisions,[{...accepted,note:''}]);
  assert.equal(r.duvri_approved,false);
  assert.equal(r.issuance_allowed,false);
  assert.equal(DECISIONS.includes('approve_duvri'),false);
});
test('request changes leaves draft findings unreviewed and provides reason', () => {
  const r=run(packet(),[{...accepted,action:'request_changes',note:'Verificare percorso sottostante'}]);
  assert.equal(r.state,'changes_requested');
  assert.equal(r.draft_findings_reviewed,false);
  assert.equal(r.issuance_allowed,false);
});
test('reject is explicit and requires a rationale', () => {
  const r=run(packet(),[{...accepted,action:'reject',note:'Interferenza non documentata'}]);
  assert.equal(r.state,'draft_findings_reviewed');
  assert.equal(r.has_rejected_findings,true);
  assert.equal(r.issuance_allowed,false);
});
test('missing rationale blocks reject and requested modifications', () => {
  assert.equal(run(packet(),[{...accepted,action:'reject',note:'  '}]).state,'blocked');
  assert.equal(run(packet(),[{...accepted,action:'request_changes'}]).state,'blocked');
});
test('missing decision does not silently approve findings', () => {
  const r=run(packet(),[]);
  assert.equal(r.state,'awaiting_decisions');
  assert.deepEqual(r.pending,[{agent_id:'lavori_quota',finding_id:'F-001'}]);
  assert.equal(r.draft_findings_reviewed,false);
});
test('duplicate decision is blocked and not partially committed', () => {
  const r=run(packet(),[accepted,accepted]);
  assert.equal(r.state,'blocked');
  assert.deepEqual(r.decisions,[]);
});
test('foreign finding ID and foreign agent ID are blocked', () => {
  assert.equal(run(packet(),[{...accepted,finding_id:'OTHER_CASE'}]).state,'blocked');
  assert.equal(run(packet(),[{...accepted,agent_id:'coin'}]).state,'blocked');
});
test('unsupported extra fields such as signed or risk score are rejected', () => {
  assert.equal(run(packet(),[{...accepted,signed:true}]).state,'blocked');
  assert.equal(run(packet(),[{...accepted,risk_score:9}]).state,'blocked');
  assert.equal(run(packet(),[{...accepted,action:'approve_duvri'}]).state,'blocked');
});
test('unauthorized, unauthenticated or improper reviewer is blocked', () => {
  assert.equal(run(packet(),[accepted],{...context,authenticated:false}).state,'blocked');
  assert.equal(run(packet(),[accepted],{...context,can_review:false}).state,'blocked');
  assert.equal(run(packet(),[accepted],{...context,role:'direzione'}).state,'blocked');
  assert.equal(run(packet(),[accepted],{...context,role:'client'}).state,'blocked');
  assert.equal(run(packet(),[accepted],{...context,role:'admin'}).state,'draft_findings_reviewed');
});
test('decision cannot be applied to another case or missing revision', () => {
  assert.equal(run(packet(),[accepted],{...context,job_id:'OTHER_CASE'}).state,'blocked');
  assert.equal(run(packet(),[accepted],{...context,document_revision_id:''}).state,'blocked');
  assert.equal(run(packet(),[accepted],{...context,reviewer_id:''}).state,'blocked');
});
test('incomplete or blocked packet cannot enter decision stage', () => {
  const p=packet();p.state='blocked';
  assert.equal(run(p).state,'blocked');
  p.state='awaiting_input';
  assert.equal(run(p).state,'blocked');
  p.state='needs_review';p.pending_agents=['elettrico'];
  assert.equal(run(p).state,'blocked');
});
test('conflicts and blocked missing information cannot be ignored', () => {
  let p=packet();
  p.conflicts=[{description:'incoerenza'}];
  assert.equal(run(p).state,'blocked');
  p=packet();p.missing_information=[{agent_id:'normativa',blocking:true,question:'Chiarire'}];
  assert.equal(run(p).state,'blocked');
});
test('finding-level clarifications must be resolved before review', () => {
  const p=packet();p.findings[0].validation_status='requires_clarification';
  assert.equal(run(p).state,'blocked');
});
test('zero findings cannot be treated as risk-free by default', () => {
  const p=packet();p.findings=[];
  assert.equal(run(p,[]).state,'blocked');
});
test('invalid packet structure and missing context are rejected', () => {
  assert.equal(prepareReviewDecisions().state,'blocked');
  assert.equal(run(null).state,'blocked');
  assert.equal(run(packet(),null).state,'blocked');
  assert.equal(run(packet(),[accepted],null).state,'blocked');
});
test('review cannot modify packet, context or input decisions', () => {
  const p=packet(), c=clone(context), d=[{...accepted}];
  const before=clone(p);
  const r=run(p,d,c);
  r.decisions[0].note='changed';
  assert.deepEqual(p,before);
  assert.deepEqual(d,[accepted]);
  assert.deepEqual(c,context);
});
test('note can be empty for acceptance, but excessive data blocks review', () => {
  assert.equal(run(packet(),[{...accepted,note:''}]).state,'draft_findings_reviewed');
  assert.equal(run(packet(),[{...accepted,note:'x'.repeat(4001)}]).state,'blocked');
});
