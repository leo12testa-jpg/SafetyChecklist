'use strict';
/*
 * Public-build safety guardrails for the isolated DUVRI rollout.
 * These tests never inspect customer documents, execute cloud APIs,
 * configure an HSE provider or approve/issue a DUVRI.
 *
 * The private Codex/Claude backend has its own independent test gates.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');

test('cloud DUVRI processing remains explicitly disabled in the public client', () => {
  const config = read('js/supabase-config.js');
  assert.match(config, /\bconst\s+DOCUMENT_GENERATION_CLOUD_ENABLED\s*=\s*false\s*;/);
  assert.doesNotMatch(config, /\bconst\s+DOCUMENT_GENERATION_CLOUD_ENABLED\s*=\s*true\s*;/);
});

test('public index does not start experimental private DUVRI workers or agents', () => {
  const html = read('index.html');
  assert.doesNotMatch(html, /<script\b[^>]*\bsrc\s*=\s*["'](?:js\/duvri-|supabase\/functions\/document-(?:worker|jobs))/i);
});

test('each remaining browser PDF.js getDocument call disables eval', () => {
  for (const file of ['js/document-intake.js', 'js/pdf-import.js', 'js/pdf.js']) {
    const source = read(file);
    const calls = [...source.matchAll(/pdfjsLib\.getDocument\s*\(\s*\{([^}]*)\}/gs)];
    assert.ok(calls.length > 0, 'Missing PDF.js call or audit required: ' + file);
    for (const match of calls) {
      assert.match(match[1], /\bisEvalSupported\s*:\s*false\b/,
        'Browser PDF.js call must disable eval: ' + file);
    }
  }
});

test('unverified Word QA cannot become permission to issue a DUVRI', () => {
  const {normalize} = require('../js/duvri-word-qa-handoff.js');
  const report = normalize();
  assert.equal(report.state, 'blocked');
  assert.equal(report.ready_for_technical_preflight, false);
  assert.equal(report.duvri_approved, false);
  assert.equal(report.issuance_allowed, false);
});

test('source-aggregation and file-manifest failures cannot authorize a DUVRI', () => {
  const {aggregateEvidenceGated} = require('../js/duvri-hse-pipeline.js');
  const {assessManifest} = require('../js/duvri-case-manifest.js');
  const hse = aggregateEvidenceGated();
  const files = assessManifest();
  assert.equal(hse.state, 'blocked');
  assert.equal(hse.issuance_allowed, false);
  assert.equal(files.state, 'blocked');
  assert.equal(files.issuance_allowed, false);
});
