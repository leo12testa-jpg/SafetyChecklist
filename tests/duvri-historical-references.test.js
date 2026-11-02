'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { findHistoricalReferences, ACTIVITY_TAGS, INTERFERENCE_TAGS } =
  require('../js/duvri-historical-references.js');

const mk = (id, {
  year = 2026, year_status = 'confirmed', document_status = 'finale',
  activity_tags = ['manutenzione_impianti'], interference_tags = ['compresenza_imprese']
} = {}) => ({
  archive_id: id, year, year_status, document_status,
  activity_tags, interference_tags
});
const request = {
  job_id: 'FASCICOLO_TEST_SYNTH_001',
  activity_tags: ['manutenzione_impianti'],
  interference_tags: ['compresenza_imprese']
};
const run = (catalog, overrides={}) =>
  findHistoricalReferences({ ...request, ...overrides }, catalog);
const clone = x => structuredClone(x);

test('only confirmed-year 2026 items matching interference are candidates', () => {
  const r=run([
    mk('ARCH_2026_A'), mk('ARCH_2025_A',{year:2025}),
    mk('ARCH_UNKNOWN_A',{year_status:'unverified'}), mk('ARCH_2026_B',{
      activity_tags:['pulizie'], interference_tags:['rumore']
    })
  ]);
  assert.equal(r.ok,true);
  assert.deepEqual(r.references.map(x=>x.archive_id),['ARCH_2026_A']);
  assert.equal(r.excluded_count,3);
});
test('output excludes identities, file paths, source excerpts and content', () => {
  const r=run([mk('ARCH_2026_A')]);
  assert.deepEqual(Object.keys(r.references[0]).sort(),[
    'activity_matches','archive_id','current_job_evidence','document_status',
    'interference_matches','measures_automatically_applicable','requires_human_review',
    'source_type','verification_status'
  ].sort());
  assert.equal(r.references[0].current_job_evidence,false);
  assert.equal(r.references[0].measures_automatically_applicable,false);
  assert.equal(r.references[0].requires_human_review,true);
  assert.equal(r.references[0].verification_status,'historical_example_only');
});
test('any customer name, path or other extra metadata causes fail-closed rejection', () => {
  let r=run([{...mk('ARCH_2026_A'),client_name:'AZIENDA_RISERVATA'}]);
  assert.equal(r.ok,false); assert.deepEqual(r.references,[]);
  r=run([{...mk('ARCH_2026_A'),path:'C:/dati/cliente/DUVRI.docx'}]);
  assert.equal(r.ok,false);
});
test('same archive ID cannot be returned twice', () => {
  const r=run([mk('ARCH_2026_A'),mk('ARCH_2026_A')]);
  assert.equal(r.ok,false);
});
test('unknown document status or unauthorized taxonomy tags block catalog', () => {
  assert.equal(run([mk('ARCH_2026_A',{document_status:'approved_by_ai'})]).ok,false);
  assert.equal(run([mk('ARCH_2026_A',{interference_tags:['nome_cliente']})]).ok,false);
});
test('unknown query tags or unknown keys cannot be used to fish for customer data', () => {
  assert.equal(run([mk('ARCH_2026_A')],{interference_tags:['customer_name']}).ok,false);
  assert.equal(findHistoricalReferences({...request,client:'specific'},[mk('ARCH_2026_A')]).ok,false);
});
test('invalid or blank job identifier is blocked', () => {
  assert.equal(run([mk('ARCH_2026_A')],{job_id:' '}).ok,false);
  assert.equal(run([mk('ARCH_2026_A')],{job_id:'../other_client'}).ok,false);
  assert.equal(findHistoricalReferences(null,[mk('ARCH_2026_A')]).ok,false);
});
test('rank by matched interference, then activity, then document status', () => {
  const r=run([
    mk('ARCH_DRAFT_A',{document_status:'bozza'}),
    mk('ARCH_FINAL_A',{document_status:'finale'}),
    mk('ARCH_FINAL_B',{document_status:'finale',
      activity_tags:['manutenzione_impianti','manutenzione_elettrica'],
      interference_tags:['compresenza_imprese','impianti_elettrici']})
  ], {
    activity_tags:['manutenzione_impianti','manutenzione_elettrica'],
    interference_tags:['compresenza_imprese','impianti_elettrici']
  });
  assert.deepEqual(r.references.map(x=>x.archive_id),
    ['ARCH_FINAL_B','ARCH_FINAL_A','ARCH_DRAFT_A']);
});
test('when no interference criterion is specified, a matching activity is sufficient', () => {
  const r=run([mk('ARCH_2026_A'),mk('ARCH_2026_B',{activity_tags:['pulizie']})],{
    interference_tags:[]
  });
  assert.deepEqual(r.references.map(x=>x.archive_id),['ARCH_2026_A']);
});
test('when interference criteria present, a single activity-only match does not qualify', () => {
  const r=run([mk('ARCH_2026_A',{
    activity_tags:['manutenzione_impianti'],interference_tags:['rumore']})]);
  assert.deepEqual(r.references,[]);
});
test('two strong activity matches may qualify with a differing interference', () => {
  const r=run([mk('ARCH_2026_A',{
    activity_tags:['manutenzione_impianti','manutenzione_elettrica'],
    interference_tags:['rumore']})],{
    activity_tags:['manutenzione_impianti','manutenzione_elettrica']
  });
  assert.equal(r.references.length,1);
});
test('maximum result limit is enforced with a deterministic ID tie-breaker', () => {
  const r=run([mk('ARCH_2026_C'),mk('ARCH_2026_B'),mk('ARCH_2026_A')],{limit:2});
  assert.deepEqual(r.references.map(x=>x.archive_id),['ARCH_2026_A','ARCH_2026_B']);
  assert.equal(run([mk('ARCH_2026_A')],{limit:100}).ok,false);
});
test('cannot use empty or huge catalog to bypass input constraints', () => {
  assert.equal(run([],{}).ok,true);
  assert.equal(run(null).ok,false);
  assert.equal(run([mk('ARCH_2026_A')],{activity_tags:[],interference_tags:[]}).ok,false);
  assert.equal(run([mk('ARCH_2026_A')],{activity_tags:['pulizie','pulizie']}).ok,false);
});
test('neither query nor index is mutated', () => {
  const data=[mk('ARCH_2026_A')], q=clone(request), original=clone(data);
  const r=run(data);
  r.references[0].activity_matches.push('other');
  assert.deepEqual(request,q);
  assert.deepEqual(data,original);
});
test('taxonomy retains all core Colligo interference categories without client-specific agents', () => {
  assert.ok(ACTIVITY_TAGS.includes('lavori_in_quota'));
  assert.ok(ACTIVITY_TAGS.includes('manutenzione_frigoriferi'));
  assert.ok(INTERFERENCE_TAGS.includes('spazi_confinati'));
  assert.ok(INTERFERENCE_TAGS.includes('rischio_incendio'));
  assert.equal(ACTIVITY_TAGS.some(t=>t.includes('coin')),false);
});
