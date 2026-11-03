'use strict';

// Required in CI: do not silently skip the private Word audit suite.
// The Python tests construct synthetic DOCX in a temporary directory only.
const test=require('node:test');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');

test('offline Colligo DOCX audit Python suite passes on synthetic OOXML',()=>{
 const executable=process.platform==='win32'?'py':'python3';
 const args=process.platform==='win32'?
  ['-3','-m','unittest','discover','-s','tests/python','-p','test_duvri_word_template_audit.py','-v']:
  ['-m','unittest','discover','-s','tests/python','-p','test_duvri_word_template_audit.py','-v'];
 const result=spawnSync(executable,args,{
  encoding:'utf8',timeout:30000,maxBuffer:2*1024*1024,
  env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}
 });
 assert.ifError(result.error);
 assert.equal(result.status,0,[
  'exit='+result.status,result.stderr||'',result.stdout||''
 ].join('\n').slice(-3500));
});
