'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const JSZip=require('../js/vendor/jszip.min.js');
const {generateDocx,documentXml}=require('../js/duvri-demo-generator.js');
const root=path.join(__dirname,'..');
const sample={checklistName:'checklist-demo.docx',attachments:[
 {name:'cronoprogramma-demo.pdf'},{name:'foto-area-demo.jpg'}
]};
test('generates a real DOCX ZIP package offline with Word content and two sources',async()=>{
 const buf=await generateDocx(JSZip,sample,{outputType:'nodebuffer'});
 assert.ok(Buffer.isBuffer(buf));
 const zip=await JSZip.loadAsync(buf);
 assert.ok(zip.file('[Content_Types].xml'));
 assert.ok(zip.file('_rels/.rels'));
 const xml=await zip.file('word/document.xml').async('string');
 assert.match(xml,/DOCUMENTO UNICO DI VALUTAZIONE/);
 assert.match(xml,/checklist-demo\.docx/);
 assert.match(xml,/cronoprogramma-demo\.pdf/);
 assert.match(xml,/foto-area-demo\.jpg/);
 assert.match(xml,/NON UTILIZZARE/);
 assert.match(xml,/NON ha interpretato/);
 assert.match(xml,/non è un DUVRI/i);
});
test('simulation is explicitly not AI, nor a client-specific technical risk assessment',()=>{
 const xml=documentXml(sample);
 assert.match(xml,/esempi fissi/);
 assert.match(xml,/Metodologia di rischio Colligo D1/);
 assert.match(xml,/modello Word ufficiale D2/);
 assert.doesNotMatch(xml,/<w:t[^>]*>cliente reale/i);
});
test('must have checklist Word and one attachment',async()=>{
 await assert.rejects(()=>generateDocx(JSZip,{checklistName:'x.pdf',attachments:[{name:'a.pdf'}]},{outputType:'nodebuffer'}),/checklist Word/);
 await assert.rejects(()=>generateDocx(JSZip,{checklistName:'x.docx',attachments:[]},{outputType:'nodebuffer'}),/almeno un allegato/);
});
test('escapes potentially hostile attachment filenames into safe Word XML',()=>{
 const xml=documentXml({checklistName:'x.docx',attachments:[{name:'<script>& injection.jpg'}]});
 assert.ok(xml.includes('&lt;script&gt;&amp; injection.jpg'));
 assert.equal(xml.includes('<script>'),false);
});
test('browser has exactly two upload controls and one demo action',()=>{
 const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
 const start=html.indexOf('<section id="screen-document-generation"');
 const end=html.indexOf('<section id="screen-history"');
 const screen=html.slice(start,end);
 assert.ok(start>=0 && end>start);
 assert.match(screen,/id="dg-demo-generate"/);
 assert.match(screen,/Solo dimostrazione/);
 assert.match(screen,/js\/duvri-demo-generator\.js/);
 assert.match(screen,/js\/duvri-demo-ui\.js/);
 const surface=screen.slice(screen.indexOf('<div class="dg-intake-areas">'),screen.indexOf('<div id="dg-auto-results"'));
 assert.equal((surface.match(/type="file"/g)||[]).length,2);
});
test('demo handler only uses local file memory and object URL, no AI or network',()=>{
 const source=fs.readFileSync(path.join(root,'js/duvri-demo-ui.js'),'utf8');
 assert.match(source,/documentIntakeSelection/);
 assert.match(source,/JSZip\.loadAsync/);
 assert.match(source,/URL\.createObjectURL/);
 assert.doesNotMatch(source,/\bfetch\(|XMLHttpRequest|anthropic|openai/i);
});
