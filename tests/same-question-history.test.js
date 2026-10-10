const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const c=vm.createContext({});vm.runInContext(fs.readFileSync('js/sync.js','utf8')+';globalThis.api=sync._test;',c);
const a={domanda_id:7,risposta:'NC',note:'NOTA ALPHA',foto:['foto-alpha'],aggiornato_il:'2026-10-09T10:00:00Z'};
const b={domanda_id:7,risposta:'PC',note:'NOTA BETA',foto:['foto-beta'],aggiornato_il:'2026-10-09T10:00:01Z'};
test('same question divergent values preserve losing answer note and photos durably',()=>{
  const merged=c.api.unisciRisposte([a],{7:b},0,0).array[0];
  assert.equal(merged.note,b.note);assert.equal(merged.versioni_precedenti[0].note,a.note);
  assert.deepEqual(Array.from(merged.versioni_precedenti[0].foto),['foto-alpha']);
});
test('same question history is commutative and idempotent on repeated snapshots',()=>{
  const ab=c.api.unisciRisposte([a],{7:b},0,0).array[0];const ba=c.api.unisciRisposte([b],{7:a},0,0).array[0];
  assert.equal(c.api.stabile(ab),c.api.stabile(ba));
  const again=c.api.unisciRisposte([ab],{7:ab},0,0).array[0];assert.equal(c.api.stabile(ab),c.api.stabile(again));
});
test('identical content with different timestamps does not create redundant history',()=>{
  const merged=c.api.unisciRisposte([a],{7:{...a,aggiornato_il:b.aggiornato_il}},0,0).array[0];
  assert.equal(merged.versioni_precedenti,undefined);
});
test('normal sequential edits do not accumulate typing snapshots as concurrent conflicts',()=>{
  const next={...b,_base_aggiornato_il:a.aggiornato_il};
  const merged=c.api.unisciRisposte([a],{7:next},0,0).array[0];
  assert.equal(merged.note,b.note);assert.equal(merged.versioni_precedenti,undefined);
});
