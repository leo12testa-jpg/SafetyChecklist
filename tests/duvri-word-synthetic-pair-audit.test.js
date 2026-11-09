'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');

test('read-only synthetic DUVRI Word pair audit passes Python fixtures',()=>{
  const python=process.platform==='win32'?'py':'python3';
  const args=process.platform==='win32'
    ?['-3','-m','unittest','discover','-s','tests/python',
      '-p','test_duvri_word_synthetic_pair_audit.py','-v']
    :['-m','unittest','discover','-s','tests/python',
      '-p','test_duvri_word_synthetic_pair_audit.py','-v'];
  const result=spawnSync(python,args,{
    encoding:'utf8',timeout:45000,maxBuffer:2*1024*1024,
    env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}
  });
  assert.ifError(result.error);
  assert.equal(result.status,0,
    ['exit='+result.status,result.stderr||'',result.stdout||''].join('\n').slice(-4000));
});
