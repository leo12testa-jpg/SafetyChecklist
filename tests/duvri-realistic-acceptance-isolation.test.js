'use strict';
/*
 * Realistic synthetic acceptance matrix / strict public-app isolation.
 * Tests never run Ollama, create a Word, invent severity, or invoke private APIs.
 * Actual Word generation + independent visual QA belong to the private Codex
 * backend on Windows; see docs/DUVRI_REALISTIC_ACCEPTANCE_RUNBOOK_V1.md.
 */
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const load=p=>fs.readFileSync(path.join(root,p),'utf8');
const spec=JSON.parse(load('tests/fixtures/duvri-realistic/scenarios.v1.json'));

test('all scenarios are synthetic end-to-end cases, not real client documents',()=>{
 assert.equal(spec.schema_version,'colligo-duvri-realistic-acceptance/1.0');
 assert.equal(spec.synthetic_only,true);
 assert.equal(spec.cases.length,3);
 assert.deepEqual(spec.cases.map(x=>x.case_id),[
  'REAL_SYN_01','REAL_SYN_02','REAL_SYN_03']);
 assert.equal(new Set(spec.cases.map(x=>x.site_type)).size,3);
 for(const x of spec.cases){
  assert.match(x.client,/Dimostrativ/);
  assert.ok(x.contractors.length>=1);
  assert.ok(x.contractors.every(n=>/Dimostrativ/.test(n)));
  assert.equal(x.issuance_allowed,false);
  assert.equal(x.risk_index_approved,false);
  assert.equal(x.word_visual_review_required,true);
  assert.equal(x.missing_information_blocks,'YES');
 }
});

test('DUVRI gets its own Word checklist and appendices, not a PWA audit JSON',()=>{
 const b=spec.module_boundary;
 assert.equal(b.checklist_app,'audit_dvr_existing_workflow_unmodified');
 assert.equal(b.document_generator,'isolated_private_duvri_case');
 assert.equal(b.transfer,'none_implicit');
 for(const scenario of spec.cases){
  assert.equal(scenario.documents.length,3);
  assert.equal(scenario.documents[0],'CHECKLIST_'+scenario.case_id+'.docx');
  assert.equal(scenario.documents[1],'CAPITOLATO_'+scenario.case_id+'.pdf');
  assert.equal(scenario.documents[2],'CRONOPROGRAMMA_'+scenario.case_id+'.xlsx');
  for(const name of scenario.documents)assert.doesNotMatch(name,/sopralluogo\.json$/i);
 }
});

test('each candidate interference is traceable to current-job synthetic facts',()=>{
 for(const scenario of spec.cases){
  const facts=new Map(scenario.facts.map(x=>[x.id,x]));
  assert.equal(facts.size,scenario.facts.length,'unique fact IDs');
  for(const fact of scenario.facts){
   assert.ok(scenario.documents.includes(fact.source),fact.id);
   assert.ok(fact.text.length>25,fact.id);
  }
  assert.ok(scenario.interferences.length>=2);
  for(const item of scenario.interferences){
   assert.ok(item.phase.length>5);
   assert.ok(item.exposure.length>5);
   assert.ok(item.proposal_to_review.length>20);
   assert.ok(item.evidence_ids.length>=2);
   for(const id of item.evidence_ids)assert.ok(facts.has(id),id);
   assert.equal('risk_score' in item,false);
   assert.equal('risk_index' in item,false);
  }
  assert.ok(scenario.clarifications.length>0);
  assert.ok(scenario.expected_agents.includes('documentale'));
  assert.ok(scenario.expected_agents.includes('normativa'));
  assert.ok(scenario.expected_agents.includes('coordinamento'));
 }
});

test('never auto-assert a missing legal permit or an inherently safe condition',()=>{
 const confined=spec.cases.find(x=>x.case_id==='REAL_SYN_03');
 assert.ok(confined);
 assert.ok(confined.expected_agents.includes('spazi_confinati'));
 assert.ok(confined.facts.some(x=>/non è allegato/.test(x.text)));
 assert.ok(confined.facts.some(x=>/Non risultano allegate/.test(x.text)));
 assert.ok(confined.forbidden_context.includes('accesso autorizzato'));
 assert.ok(confined.forbidden_context.includes('assenza di rischi'));
 assert.equal(confined.issuance_allowed,false);
});

test('realistic pilot fixtures are never persisted as audit/checklist application data',()=>{
 const auditSource=load('js/app.js');
 const engine=load('js/checklist.js');
 const db=load('js/db.js');
 const generator=load('js/document-generation.js');
 const intake=load('js/document-intake-ui.js');
 for(const source of [auditSource,engine,db]){
  assert.doesNotMatch(source,/require\(['"](?:\.\/)?(?:duvri-|document-generation)/);
  assert.doesNotMatch(source,/import\s*\(.*duvri-/);
 }
 assert.doesNotMatch(generator,/\bchecklistEngine\s*\./);
 assert.doesNotMatch(generator,/\banteprimaImportazionePendente\b/);
 assert.doesNotMatch(intake,/\bchecklistEngine\s*\./);
 assert.doesNotMatch(intake,/\bdb\s*\.\s*(?:salva|salvaSopralluogo|aggiornaSopralluogo|getSopralluogo)/);
 assert.doesNotMatch(intake,/\b(?:localStorage|indexedDB)\s*\./);
});

test('public DUVRI intake and audit/start flow are separate screens',()=>{
 const html=load('index.html');
 const start=html.indexOf('<section id="screen-document-generation"');
 assert.ok(start>=0,'document generator screen must exist');
 const end=html.indexOf('<section id="screen-history"',start);
 assert.ok(end>start);
 const panel=html.slice(start,end);
 assert.match(panel,/id="dg-checklist-file" type="file" accept="\.docx"/);
 assert.match(panel,/id="dg-auto-files" type="file" multiple/);
 assert.doesNotMatch(panel,/id="checklist-domanda-/);
 const config=load('js/supabase-config.js');
 assert.match(config,/DOCUMENT_GENERATION_CLOUD_ENABLED\s*=\s*false/);
 assert.equal(load('service-worker.js').includes('duvri-realistic/scenarios.v1.json'),false);
});

test('fixture never approves HSE, D1/D2, Word QA, AI or emission',()=>{
 const all=JSON.stringify(spec);
 for(const banned of [
  '"issuance_allowed":true','"risk_index_approved":true',
  '"word_visual_review_required":false',
  '"external_data_transfer_allowed":true',
  '"d1_approved":true','"d2_approved":true'
 ])assert.ok(!all.replace(/\s/g,'').includes(banned));
 for(const scenario of spec.cases){
  assert.ok(scenario.forbidden_context.length>=3);
  assert.notEqual(scenario.work_window,'');
 }
});
