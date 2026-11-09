'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const path=require('node:path');

test('DUVRI Colligo 2026 layout contract covers portrait cover and variable landscape pages',()=>{
  const windows=process.platform==='win32';
  const cmd=windows?'py':'python3';
  const args=[...(windows?['-3']:[]),'-m','unittest','discover',
    '-s','tests/python','-p','test_duvri_layout_contract_v1.py','-v'];
  const run=spawnSync(cmd,args,{cwd:path.join(__dirname,'..'),encoding:'utf8',timeout:45000,
    maxBuffer:1024*1024,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
  assert.ifError(run.error);
  assert.equal(run.status,0,(run.stderr||run.stdout||'').slice(-3000));
});
