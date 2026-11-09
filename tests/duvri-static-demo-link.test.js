'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('native DUVRI generation replaces demo link while cloud remains disabled', () => {
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  const action = fs.readFileSync(path.join(__dirname, '../js/document-generation-action.js'), 'utf8');
  const config = fs.readFileSync(path.join(__dirname, '../js/supabase-config.js'), 'utf8');
  assert.equal(html.includes('id="dg-open-synthetic-demo"'), false);
  assert.equal(html.includes('href="duvri-demo/"'), false);
  assert.ok(html.includes('src="js/document-generation-action.js"'));
  assert.ok(action.includes("btn.textContent = 'Genera DUVRI'"));
  assert.ok(action.includes('NON EMETTIBILE'));
  assert.ok(config.includes('DOCUMENT_GENERATION_CLOUD_ENABLED = false'));
});
