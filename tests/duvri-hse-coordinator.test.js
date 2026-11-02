'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildReviewPacket } = require('../js/duvri-hse-coordinator.js');
const example = JSON.parse(fs.readFileSync(path.join(__dirname, '../schemas/duvri-agent-analysis.v1.example.json'), 'utf8'));
const clone = x => structuredClone(x);
const agents = ['documentale', 'normativa', 'coordinamento', 'lavori_quota'];
const signals = { lavori_in_quota: 'yes', incendio_emergenze: 'no', impianti_elettrici: 'no', cantieri_edili: 'no', chimici_atex: 'no', ambienti_confinati: 'no', macchine_impianti: 'no', logistica_viabilita: 'no', agenti_fisici: 'no' };
const mk = (agent, state = 'completed') => ({
  schema_version: 'colligo-duvri-agent-analysis/1.0',
  job_id: 'FASCICOLO_TEST_SYNTH_001', agent_id: agent, status: state,
  findings: [], missing_information: [], conflicts: [], requires_human_review: true
});
const results = () => agents.map(agent => agent === 'lavori_quota' ? clone(example) : mk(agent));
const build = (extra={}) => buildReviewPacket({jobId: 'FASCICOLO_TEST_SYNTH_001', specialtySignals: signals,
 agentResults: results(), allowedFileIds: ['FILE_TEST_001', 'FILE_TEST_002'], ...extra});

test('four agents produce a review packet with full provenance', () => {
  const r = build();
  assert.equal(r.state, 'awaiting_input');
  assert.deepEqual(r.required_agents, agents);
  assert.equal(r.findings[0].agent_id, 'lavori_quota');
  assert.equal(r.findings[0].source_evidence[0].file_id, 'FILE_TEST_001');
  assert.equal(r.issuance_allowed, false);
  assert.equal(r.human_review_required, true);
});
test('complete, nonblocking analysis still requires human review', () => {
  const rs = results();
  rs[3].missing_information = [];
  rs[3].status = 'completed';
  rs[3].findings[0].validation_status = 'to_be_reviewed';
  const r = build({agentResults: rs});
  assert.equal(r.state, 'needs_review');
  assert.equal(r.issuance_allowed, false);
});
test('missing specialist blocks overall packet instead of silently accepting it', () => {
  const r = build({agentResults: results().slice(0,3)});
  assert.equal(r.state, 'blocked');
  assert.deepEqual(r.pending_agents, ['lavori_quota']);
});
test('duplicate specialist reports fail closed', () => {
  const r = build({agentResults: [...results(), mk('documentale')]});
  assert.equal(r.state, 'blocked');
  assert.deepEqual(r.findings, []);
});
test('unselected specialist reports fail closed', () => {
  const r = build({agentResults: [...results(), mk('elettrico')]});
  assert.equal(r.state, 'blocked');
});
test('foreign job or file evidence fails closed without leaking findings', () => {
  const rs = results(); rs[3].job_id = 'ALTRO_CLIENTE';
  let r = build({agentResults: rs});
  assert.equal(r.state, 'blocked'); assert.deepEqual(r.findings, []);
  rs[3].job_id = 'FASCICOLO_TEST_SYNTH_001';
  rs[3].findings[0].source_evidence[0].file_id = 'FOREIGN_FILE';
  r = build({agentResults: rs});
  assert.equal(r.state, 'blocked'); assert.deepEqual(r.findings, []);
});
test('invalid configuration and unsupported signals are blocked', () => {
  assert.equal(buildReviewPacket().state, 'blocked');
  assert.equal(build({specialtySignals: { fake: 'yes' }}).state, 'blocked');
  assert.equal(build({allowedFileIds: null}).state, 'blocked');
});
test('unknown screening flag requires more input, not a negative assumption', () => {
  const rs = results(); rs[3].missing_information = []; rs[3].status = 'completed';
  const incomplete = { ...signals }; delete incomplete.impianti_elettrici;
  const r = build({specialtySignals: incomplete, agentResults: rs});
  assert.equal(r.state, 'awaiting_input');
  assert.deepEqual(r.screening_required, ['impianti_elettrici']);
});
test('two agents reporting same scenario remain distinct, are flagged for review', () => {
  const rs = results();
  const second = clone(example.findings[0]); second.finding_id = 'F-002';
  rs[0].findings = [second];
  const r = build({agentResults: rs});
  assert.equal(r.findings.length, 2);
  assert.equal(r.possible_overlaps.length, 1);
  assert.equal(r.possible_overlaps[0].length, 2);
});
test('real conflicts remain visible and require clarification', () => {
  const rs = results(); rs[3].status = 'completed'; rs[3].missing_information = [];
  rs[0].conflicts = [{ description: 'Dati orari incongruenti', evidence: [
    clone(example.findings[0].source_evidence[0]),
    {source_type: 'current_job_document', file_id:'FILE_TEST_002', locator:'pagina 1', excerpt_or_fact:'orario differente', verification_status:'confirmed'}
  ], resolution_question:'Quale orario e valido?' }];
  const r = build({agentResults: rs});
  assert.equal(r.state, 'awaiting_input');
  assert.equal(r.conflicts.length, 1);
  assert.equal(r.conflicts[0].agent_id, 'documentale');
});
test('historical-only findings and invented scores fail closed', () => {
  const rs = results();
  rs[3].findings[0].source_evidence = [{source_type:'historical_2026_reference',file_id:'ARCHIVIO_TEST_001',locator:'pag. 1',excerpt_or_fact:'dati fittizi', verification_status:'historical_example_only'}];
  let r = build({agentResults: rs, allowedFileIds:['FILE_TEST_001'],
    allowedHistoricalReferenceIds:['ARCHIVIO_TEST_001']});
  assert.equal(r.state,'blocked');
  rs[3].findings[0].source_evidence = clone(example.findings[0].source_evidence);
  rs[3].findings[0].risk_score = 3;
  r = build({agentResults:rs});
  assert.equal(r.state,'blocked');
});
test('not applicable agent with findings is rejected', () => {
  const rs = results(); rs[3].status = 'not_applicable';
  assert.equal(build({agentResults:rs}).state, 'blocked');
});
test('blocked agent stops overall process', () => {
  const rs = results(); rs[1].status = 'blocked';
  assert.equal(build({agentResults:rs}).state, 'blocked');
});
test('result generation does not mutate original outputs', () => {
  const rs = results(); const before = clone(rs);
  const r = build({agentResults:rs});
  assert.deepEqual(rs,before);
  r.findings[0].scenario = 'changed';
  assert.equal(rs[3].findings[0].scenario,before[3].findings[0].scenario);
});

test('finding-level requires_clarification prevents premature needs_review', () => {
  const rs = results();
  rs[3].missing_information = [];
  rs[3].status = 'completed';
  assert.equal(build({ agentResults: rs }).state, 'awaiting_input');
  rs[3].findings[0].validation_status = 'to_be_reviewed';
  assert.equal(build({ agentResults: rs }).state, 'needs_review');
});
