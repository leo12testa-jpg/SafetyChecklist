'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {normalizeCatalog}=require('../js/duvri-archive-index-adapter.js');
const {findHistoricalReferences}=require('../js/duvri-historical-references.js');

const columns={
  archive_id:'archivio_id_test',
  year:'anno_estratto_test',
  year_status:'verifica_anno_test',
  document_status:'versione_stato_test',
  activity_tags:'attivita_classificate_test',
  interference_tags:'interferenze_classificate_test'
};
const row=(id,year=2026,status='confirmed')=>({
  archivio_id_test:id,anno_estratto_test:year,
  verifica_anno_test:status,versione_stato_test:'revisione',
  attivita_classificate_test:['lavori_in_quota'],
  interferenze_classificate_test:['caduta_materiali'],
  client_name:'CLIENTE_DA_NON_DIVULGARE',original_path:'C:/DATI_RISERVATI/DUVRI.docx',
  original_text:'Testo riservato da escludere',contact_email:'anonimo@example.com',
  sha256:'a'.repeat(64)
});
const manifest=(count)=>({approved:true,archive_scope:'duvri_2026_local_only',
  revision_id:'CATALOGO_REV_SYNTH_001',records_reviewed:count});
const run=(rows=[row('ARCH_SYNTH_001')],options={})=>
  normalizeCatalog({rows,columns,approvedManifest:manifest(rows.length),...options});
test('approved index only contains six allowed fields',()=>{
 const r=run();
 assert.equal(r.state,'normalized_local_only');
 assert.deepEqual(Object.keys(r.catalog[0]).sort(),Object.keys(columns).sort());
});
test('source client name, local paths and full text cannot leak',()=>{
 const r=run(),s=JSON.stringify(r);
 assert.equal(s.includes('CLIENTE_DA_NON_DIVULGARE'),false);
 assert.equal(s.includes('DATI_RISERVATI'),false);
 assert.equal(s.includes('Testo riservato'),false);
 assert.equal(s.includes('anonimo@example.com'),false);
 assert.equal(s.includes('a'.repeat(64)),false);
});
test('old years and unverified 2026 candidates excluded',()=>{
 const r=run([row('ARCH_SYNTH_001'),row('ARCH_SYNTH_002',2025),
   row('ARCH_SYNTH_003',2026,'unverified')]);
 assert.equal(r.included_count,1);
 assert.equal(r.excluded_count,2);
 assert.equal(r.catalog[0].archive_id,'ARCH_SYNTH_001');
});
test('unknown categories fail closed, no partial catalog',()=>{
 const records=[row('ARCH_SYNTH_001'),row('ARCH_SYNTH_002')];
 records[1].attivita_classificate_test=['cliente_coin'];
 const r=run(records);
 assert.equal(r.state,'blocked');
 assert.deepEqual(r.catalog,[]);
});
test('duplicate archive ID fails closed',()=>{
 const r=run([row('ARCH_SYNTH_001'),row('ARCH_SYNTH_001')]);
 assert.equal(r.state,'blocked');
 assert.deepEqual(r.catalog,[]);
});
test('no column mapping fails closed, never guess from common labels',()=>{
 const r=run([row('ARCH_SYNTH_001')],{columns:null});
 assert.equal(r.state,'blocked');
});
test('missing mapped column fails closed',()=>{
 const records=[row('ARCH_SYNTH_001')];
 delete records[0].verifica_anno_test;
 assert.equal(run(records).state,'blocked');
});
test('source columns must be unique and explicitly mapped',()=>{
 const mapping={...columns,year:columns.archive_id};
 assert.equal(run([row('ARCH_SYNTH_001')],{columns:mapping}).state,'blocked');
});
test('manifest approval is mandatory',()=>{
 const r=run([row('ARCH_SYNTH_001')],{approvedManifest:{...manifest(1),approved:false}});
 assert.equal(r.state,'blocked');
});
test('manifest revision and number of reviewed source records are mandatory',()=>{
 const r1=run([row('ARCH_SYNTH_001')],{approvedManifest:manifest(2)});
 assert.equal(r1.state,'blocked');
 const r2=run([row('ARCH_SYNTH_001')],{approvedManifest:{...manifest(1),revision_id:''}});
 assert.equal(r2.state,'blocked');
});
test('manifest must be explicitly for private 2026 archive',()=>{
 const r=run([row('ARCH_SYNTH_001')],{approvedManifest:{...manifest(1),archive_scope:'github_public'}});
 assert.equal(r.state,'blocked');
});
test('invalid document state and year type blocked',()=>{
 let records=[row('ARCH_SYNTH_001')];
 records[0].versione_stato_test='published_without_review';
 assert.equal(run(records).state,'blocked');
 records=[row('ARCH_SYNTH_001')];
 records[0].anno_estratto_test='2026';
 assert.equal(run(records).state,'blocked');
});
test('retrieval accepts normalized local index without knowing client identity',()=>{
 const r=run([row('ARCH_SYNTH_001')]);
 const matches=findHistoricalReferences({
  job_id:'FASCICOLO_SYNTH_001',
  activity_tags:['lavori_in_quota'],
  interference_tags:['caduta_materiali']
 },r.catalog);
 assert.equal(matches.ok,true);
 assert.equal(matches.references.length,1);
 assert.equal(matches.references[0].current_job_evidence,false);
});
test('never mutates source rows or mapping declaration',()=>{
 const records=[row('ARCH_SYNTH_001')],before=structuredClone(records),
   declared=structuredClone(columns);
 const result=run(records);
 result.catalog[0].activity_tags.push('pulizie');
 assert.deepEqual(records,before);
 assert.deepEqual(columns,declared);
});
test('empty catalog remains empty and does not claim completed documents',()=>{
 const r=run([]);
 assert.equal(r.state,'normalized_local_only');
 assert.equal(r.included_count,0);
 assert.deepEqual(r.catalog,[]);
});
