'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {validateMapping,TOTAL_SEGMENTS}=require('../js/duvri-yellow-field-map.js');
const base = ()=>Array.from({length:22},(_,i)=>({
 segment_id:i+1,mode:'field',field_key:'intervention.field_'+(i+1),
 reviewer_id:'TECNICO_SYNTH_001',review_reference:'REVIEW_SYNTH_001',
 reviewed:true
}));
const run=(segments=base(),extra={})=>validateMapping({
 templateVersion:'DUVRI_BASE_GENERALE_2026',segments,...extra
});
const clone=x=>structuredClone(x);
test('baseline has exactly 22 segments',()=>assert.equal(TOTAL_SEGMENTS,22));
test('all 22 reviewed mappings pass but never imply document is populated',()=>{
 const r=run();assert.equal(r.state,'mapping_ready');assert.equal(r.mapped,22);
 assert.equal(r.verified,22);assert.equal(r.populated_expected,22);
 assert.equal(r.document_fields_populated,false);assert.equal(r.issuance_allowed,false);
});
test('all 22 fields unknown block mapping approval',()=>{
 const rows=base().map(({segment_id})=>({segment_id,mode:'unreviewed'}));
 const r=run(rows);assert.equal(r.state,'needs_review');
 assert.equal(r.mapped,0);assert.equal(r.unresolved,22);
 assert.equal(r.mapping_approved,false);assert.equal(r.needs_review.length,22);
});
test('unreviewed field cannot be treated as completed simply by having a key',()=>{
 const rows=base();rows[6]={segment_id:7,mode:'unreviewed',field_key:'client.name'};
 assert.equal(run(rows).state,'blocked');
});
test('an explicitly reasoned N/A field can be mapped after human approval',()=>{
 const rows=base();rows[3]={segment_id:4,mode:'not_applicable',
  reason:'Segmento non previsto nel caso sintetico',reviewed:true,
  reviewer_id:'TECNICO_SYNTH_001',review_reference:'REVIEW_SYNTH_002'};
 const r=run(rows);assert.equal(r.state,'mapping_ready');assert.equal(r.not_applicable,1);
 assert.equal(r.populated_expected,21);assert.equal(r.issuance_allowed,false);
});
test('non-applicable without reason or reviewer stays invalid or pending',()=>{
 const rows=base();rows[3]={segment_id:4,mode:'not_applicable',reason:'',reviewed:true,
  reviewer_id:'TECNICO_SYNTH_001',review_reference:'REVIEW_SYNTH_002'};
 assert.equal(run(rows).state,'blocked');
 rows[3].reason='Caso sintetico';
 delete rows[3].reviewer_id;
 assert.equal(run(rows).state,'needs_review');
 assert.deepEqual(run(rows).needs_review,[4]);
});
test('one field still awaiting approval never produces mapping_ready',()=>{
 const rows=base();rows[5].reviewed=false;
 assert.equal(run(rows).state,'needs_review');
 assert.equal(run(rows).verified,21);
});
test('do not allow unsafe dynamic expressions or HTML in field key',()=>{
 const rows=base();rows[0].field_key='__proto__.constructor';
 assert.equal(run(rows).state,'blocked');
 rows[0].field_key='client.name;eval()';
 assert.equal(run(rows).state,'blocked');
 rows[0].field_key='client.name';
 assert.equal(run(rows).state,'mapping_ready');
});
test('duplicate or missing segments blocked',()=>{
 const rows=base();rows[21].segment_id=1;
 assert.equal(run(rows).state,'blocked');
 assert.equal(run(base().slice(0,21)).state,'blocked');
});
test('out-of-range IDs blocked',()=>{
 const rows=base();rows[0].segment_id=23;
 assert.equal(run(rows).state,'blocked');
 rows[0].segment_id=0;
 assert.equal(run(rows).state,'blocked');
});
test('wrong template or wrong segment baseline fails closed',()=>{
 assert.equal(run(base(),{templateVersion:'BAD'}).state,'blocked');
 assert.equal(run(base(),{expectedSegmentCount:19}).state,'blocked');
 assert.equal(validateMapping().state,'blocked');
});
test('client-specific values and extra fields cannot be placed in a mapping',()=>{
 const rows=base();rows[0].client_name='RISERVATO';
 assert.equal(run(rows).state,'blocked');
 rows[0].client_name=undefined;delete rows[0].client_name;
 rows[0].field_key='cliente Mario Rossi';
 assert.equal(run(rows).state,'blocked');
});
test('review reference and reviewer must be valid opaque IDs',()=>{
 const rows=base();rows[0].review_reference='http://not-permitted';
 assert.equal(run(rows).state,'needs_review');
 rows[0].review_reference='REVIEW_SYNTH_001';
 rows[0].reviewer_id='';assert.equal(run(rows).state,'needs_review');
});
test('original mapping objects are never mutated',()=>{
 const rows=base(), copy=clone(rows);
 const r=run(rows);r.needs_review.push(12);
 assert.deepEqual(rows,copy);
});
