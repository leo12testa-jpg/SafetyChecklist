'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');

test('synthetic Word checklist + attachments have byte-level provenance and no cross-case swaps', () => {
  const windows = process.platform === 'win32';
  const python = windows ? 'py' : 'python3';
  const args = [...(windows ? ['-3'] : []), '-m', 'unittest', 'discover',
    '-s', 'tests/python', '-p', 'test_duvri_synthetic_input_integrity.py', '-v'];
  const result = spawnSync(python, args, {
    cwd: ROOT, encoding: 'utf8', timeout: 60000, maxBuffer: 1024 * 1024,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, (result.stderr || result.stdout || '').slice(-4000));
});
