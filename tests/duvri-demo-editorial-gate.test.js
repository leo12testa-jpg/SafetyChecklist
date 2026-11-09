'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {spawnSync}=require('node:child_process');

test('DUVRI Word editorial preflight rejects structural blockers without showing customer text',()=>{
  const win=process.platform==='win32';
  const cmd=win?'py':'python3';
  const args=[...(win?['-3']:[]),'-m','unittest','discover','-s','tests/python',
    '-p','test_duvri_demo_editorial_gate.py','-v'];
  const result=spawnSync(cmd,args,{
    cwd:path.resolve(__dirname,'..'),timeout:30000,encoding:'utf8',maxBuffer:1024*1024,
    env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}
  });
  assert.ifError(result.error);
  assert.equal(result.status,0,(result.stderr||result.stdout||'').slice(-3200));
});
