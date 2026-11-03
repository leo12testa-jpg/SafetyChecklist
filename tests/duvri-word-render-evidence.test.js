'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');

test('independent DUVRI render-page evidence gate passes synthetic integrity suite',()=>{
 const executable=process.platform==='win32'?'py':'python3';
 const args=process.platform==='win32'?
  ['-3','-m','unittest','discover','-s','tests/python','-p','test_duvri_word_render_evidence.py','-v']:
  ['-m','unittest','discover','-s','tests/python','-p','test_duvri_word_render_evidence.py','-v'];
 const run=spawnSync(executable,args,{
  encoding:'utf8',timeout:30000,maxBuffer:2*1024*1024,
  env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}
 });
 assert.ifError(run.error);
 assert.equal(run.status,0,[
  'exit='+run.status,run.stderr||'',run.stdout||''
 ].join('\n').slice(-3500));
});
