'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const JSZip=require('../js/vendor/jszip.min.js');
const generator=require('../duvri-demo/generator.js');

test('synthetic DUVRI demo generates a valid OOXML Word without reading file bytes',async()=>{
  const word=await generator.generate(JSZip,{
    title:'MANUTENZIONE DIMOSTRATIVA',
    files:['Checklist_FITTIZIA.docx','Allegato_FITTIZIO.pdf'],
    date:'09/11/2026'
  });
  const zip=await JSZip.loadAsync(Buffer.from(await word.arrayBuffer()));
  for(const part of ['[Content_Types].xml','word/document.xml','word/header1.xml',
                      'word/footer1.xml','word/_rels/document.xml.rels']) {
    assert.ok(zip.file(part),'missing DOCX member '+part);
  }
  const document=await zip.file('word/document.xml').async('string');
  assert.match(document,/MANUTENZIONE DIMOSTRATIVA/);
  assert.match(document,/Checklist_FITTIZIA.docx/);
  assert.match(document,/NON EMETTIBILE/);
  assert.match(document,/w:top="1140"/);
  assert.match(document,/w:top="1418"/);
  assert.equal((document.match(/<w:sectPr>/g)||[]).length,2);
  assert.doesNotMatch(document,/D1 APPROVATO|HSE APPROVATO/);
});

test('filename and title XML escaping prevents OOXML injection',()=>{
  const xml=generator.content({title:'<INJECT>&',files:['<w:sectPr>'],date:'1'});
  assert.ok(xml.includes('&lt;INJECT&gt;&amp;'));
  assert.ok(xml.includes('&lt;w:sectPr&gt;'));
  assert.equal((xml.match(/<w:sectPr>/g)||[]).length,2);
});

test('synthetic preview cannot silently generate from oversized lists',async()=>{
  await assert.rejects(()=>generator.generate(JSZip,{title:'test',files:Array(13).fill('x')}),/File non validi/);
});

test('preview page is isolated, no upload or fake AI progress',()=>{
  const index=fs.readFileSync(path.join(__dirname,'../duvri-demo/index.html'),'utf8');
  const app=fs.readFileSync(path.join(__dirname,'../duvri-demo/app.js'),'utf8');
  assert.match(index,/SOLO DATI SINTETICI/);
  assert.match(index,/connect-src 'none'/);
  assert.match(index,/id="checklist"/);
  assert.match(index,/id="docs"/);
  assert.match(index,/id="generate"/);
  assert.doesNotMatch(app,/\bfetch\s*\(|XMLHttpRequest|sendBeacon|FileReader|\.arrayBuffer\s*\(/);
});