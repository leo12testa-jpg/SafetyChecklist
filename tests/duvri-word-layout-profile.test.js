'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {spawnSync} = require('node:child_process');

test('synthetic Word layout postprocessor preserves source registry, comments and master parts', () => {
  const windows=process.platform==='win32';
  const executable=windows?'py':'python3';
  const args=[...(windows?['-3']:[]),'-m','unittest','discover',
    '-s','tests/python','-p','test_duvri_word_layout_profile.py','-v'];
  const proc=spawnSync(executable,args,{
    cwd:path.resolve(__dirname,'..'),
    encoding:'utf8',timeout:45000,maxBuffer:1024*1024,
    env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}
  });
  assert.ifError(proc.error);
  assert.equal(proc.status,0,(proc.stderr||proc.stdout||'').slice(-4000));
});
