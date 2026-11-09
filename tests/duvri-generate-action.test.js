'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const action = require('../js/document-generation-action.js');

const checklist = {name:'checklist_compilata.docx',size:3600};
const docs = [{file:{name:'planimetria.pdf',size:5000},category:'planimetrie-layout'}];

test('the Word draft button requires a real enabled gateway and explicit cloud consent', () => {
  assert.match(action.validate(checklist,docs,false,true).join(' '),/gateway/);
  assert.match(action.validate(checklist,docs,true,false).join(' '),/autorizzare/);
  assert.deepEqual(action.validate(checklist,docs,true,true),[]);
});

test('DOCX checklist is mandatory, and invalid or empty files are rejected', () => {
  assert.match(action.validate(null,docs,true,true).join(' '),/checklist Word/);
  assert.match(action.validate({name:'a.pdf',size:800},docs,true,true).join(' '),/checklist Word/);
  assert.match(action.validate({name:'a.docx',size:0},docs,true,true).join(' '),/checklist Word/);
  assert.match(action.validate(checklist,[{file:{name:'b.pdf',size:0}}],true,true).join(' '),/vuoti/);
});

test('batch maximum is 12 and total maximum is 45 MiB', () => {
  const many = Array.from({length:12},(_,i)=>({file:{name:'a'+i+'.pdf',size:100}}));
  assert.match(action.validate(checklist,many,true,true).join(' '),/Massimo 12/);
  assert.match(action.validate(checklist,[{file:{name:'heavy.pdf',size:46*1024*1024}}],true,true).join(' '),/45 MB/);
});

test('metadata does not approve HSE decisions or issue a DUVRI', () => {
  const data=action.metadata(checklist,docs,'Manutenzione copertura');
  assert.equal(data.documentType,'duvri');
  assert.equal(data.title,'Manutenzione copertura');
  assert.equal(data.layoutProfileId,'COLLIGO-DUVRI-CORPORATE-2026-V1');
  assert.equal(data.draftOnly,true);
  assert.equal(data.humanReviewRequired,true);
  assert.equal(data.issuanceAllowed,false);
  assert.deepEqual(data.decisionGates,['TITOLO_IV_ART26','HSE_REVIEW','D1','D2']);
  assert.equal(data.documents[0].category,'planimetrie-layout');
  assert.equal(data.aiDataProcessingConsent,true);
});

test('missing title remains a conspicuous unresolved draft field', () => {
  assert.match(action.metadata(checklist,[],null).title,/TITOLO DA CONFERMARE/);
});

test('native action targets actual CSS gate present in the current app, not a missing id', () => {
  const fs=require('node:fs');
  const path=require('node:path');
  const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
  const script=fs.readFileSync(path.join(__dirname,'../js/document-generation-action.js'),'utf8');
  assert.match(html,/class="dg-auto-gate"/);
  assert.match(script,/screen\.querySelector\('\.dg-auto-gate'\)/);
  assert.doesNotMatch(script,/getElementById\('dg-auto-gate'\)/);
  assert.match(html,/<script src="js\/duvri-generate-action\.js"><\/script>/);
  assert.doesNotMatch(html,/id="dg-open-synthetic-demo"/);
  assert.match(script,/issuanceAllowed: false/);
});
