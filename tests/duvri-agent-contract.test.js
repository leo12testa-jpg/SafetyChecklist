'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { routeSpecialists, validateAgentResult, AGENTS, SIGNAL_TO_AGENT } = require('../js/duvri-agent-contract.js');
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'schemas', 'duvri-agent-analysis.v1.example.json'), 'utf8'));
const clone = x => structuredClone(x);
const validate = data => validateAgentResult(data, {
  jobId: 'FASCICOLO_TEST_SYNTH_001',
  allowedFileIds: ['FILE_TEST_001', 'ARCHIVIO_TEST_001', 'FILE_TEST_002']
});

// All examples synthetic: NEVER commit customer DUVRI or internal document contents.
test('valid synthetic output with explicit source and mandatory human review', () => {
  assert.deepEqual(validate(fixture), { valid: true, errors: [] });
});
test('routes only specialists with explicit yes and screens unknown signals', () => {
  const routed = routeSpecialists({ lavori_in_quota: 'yes', impianti_elettrici: 'no', chimici_atex: 'unknown' });
  assert.deepEqual(routed.selected_agents, ['documentale', 'normativa', 'coordinamento', 'lavori_quota']);
  assert.ok(routed.needs_screening.includes('chimici_atex'));
  assert.ok(!routed.needs_screening.includes('impianti_elettrici'));
  assert.equal(routeSpecialists({}).needs_screening.length, Object.keys(SIGNAL_TO_AGENT).length);
  assert.throws(() => routeSpecialists({ lavori_in_quota: true }), /yes, no o unknown/);
  assert.throws(() => routeSpecialists({ ignore_everything: 'yes' }), /sconosciuto/);
  assert.equal(new Set(AGENTS).size, AGENTS.length);
});
test('DUVRI 2026 precedent alone cannot establish a finding in a new case', () => {
  const data = clone(fixture);
  data.findings[0].source_evidence = [{ source_type: 'historical_2026_reference', file_id: 'ARCHIVIO_TEST_001',
    locator: 'pag. 2', excerpt_or_fact: 'Misura storica sintetica', verification_status: 'historical_example_only' }];
  assert.equal(validate(data).valid, false);
  assert.match(validate(data).errors.join(' '), /nessuna evidenza del lavoro corrente/);
});
test('precedent supplements actual evidence but never becomes confirmed job evidence', () => {
  const data = clone(fixture);
  data.findings[0].source_evidence.push({ source_type: 'historical_2026_reference',
    file_id: 'ARCHIVIO_TEST_001', locator: 'pag. 2', excerpt_or_fact: 'Esempio sintetico',
    verification_status: 'historical_example_only' });
  assert.equal(validate(data).valid, true);
  data.findings[0].source_evidence[1].verification_status = 'confirmed';
  assert.equal(validate(data).valid, false);
});
test('rejects invented risk score and unapproved additional fields', () => {
  const data = clone(fixture);
  data.findings[0].risk_score = 9;
  assert.equal(validate(data).valid, false);
  assert.match(validate(data).errors.join(' '), /campo non consentito/);
});
test('rejects foreign file IDs and mismatching job ID', () => {
  const data = clone(fixture);
  data.findings[0].source_evidence[0].file_id = 'FILE_OTHER_CLIENT';
  assert.equal(validate(data).valid, false);
  data.findings[0].source_evidence[0].file_id = 'FILE_TEST_001';
  data.job_id = 'ANOTHER_CASE';
  assert.equal(validate(data).valid, false);
});
test('rejects missing fields, client-specific agent and no human review', () => {
  const data = clone(fixture);
  delete data.findings[0].work_phase;
  data.agent_id = 'cliente_coin';
  data.requires_human_review = false;
  assert.equal(validate(data).valid, false);
  assert.ok(validate(data).errors.length >= 3);
});
test('rejects empty evidence, duplicate findings and invalid exposed parties', () => {
  const data = clone(fixture);
  data.findings[0].source_evidence = [];
  data.findings[0].exposed_parties = [];
  data.findings.push(clone(data.findings[0]));
  assert.equal(validate(data).valid, false);
  assert.match(validate(data).errors.join(' '), /ID duplicato/);
});
test('blocks completed state while blocking information is missing', () => {
  const data = clone(fixture);
  data.status = 'completed';
  assert.equal(validate(data).valid, false);
  data.status = 'needs_clarification';
  assert.equal(validate(data).valid, true);
});
test('requires two current-job sources for a reported conflict', () => {
  const data = clone(fixture);
  data.conflicts = [{ description: 'Orari contraddittori', evidence: [
    clone(data.findings[0].source_evidence[0]),
    { source_type: 'current_job_document', file_id: 'FILE_TEST_002', locator: 'pag. 1',
      excerpt_or_fact: 'Un orario differente', verification_status: 'confirmed' }
  ], resolution_question: 'Quale orario è corretto?' }];
  assert.equal(validate(data).valid, true);
  data.conflicts[0].evidence[1].source_type = 'historical_2026_reference';
  data.conflicts[0].evidence[1].file_id = 'ARCHIVIO_TEST_001';
  data.conflicts[0].evidence[1].verification_status = 'historical_example_only';
  assert.equal(validate(data).valid, false);
});
test('cannot mark a proposed measure as human validated', () => {
  const data = clone(fixture);
  data.findings[0].proposed_measures[0].needs_human_validation = false;
  assert.equal(validate(data).valid, false);
  data.findings[0].proposed_measures[0].needs_human_validation = true;
  data.findings[0].source_evidence[0].source_type = 'historical_2026_reference';
  assert.equal(validate(data).valid, false);
});
test('rejects malformed objects or an unsupported schema version without throwing', () => {
  assert.equal(validate(null).valid, false);
  assert.equal(validate([]).valid, false);
  const data = clone(fixture);
  data.schema_version = 'other';
  assert.equal(validate(data).valid, false);
});

test('fail closed when job ID or authorized file set are not supplied', () => {
  assert.equal(validateAgentResult(fixture).valid, false);
  assert.equal(validateAgentResult(fixture, { jobId: fixture.job_id }).valid, false);
  assert.equal(validateAgentResult(fixture, { allowedFileIds: ['FILE_TEST_001'] }).valid, false);
  assert.equal(validateAgentResult(fixture, { jobId: fixture.job_id, allowedFileIds: [] }).valid, false);
});
