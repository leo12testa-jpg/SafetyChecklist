const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ctx = vm.createContext({ console });
vm.runInContext(fs.readFileSync('js/import-matching.js', 'utf8') + ';globalThis.m=importMatching;', ctx);
const m = ctx.m;
const checklist = { id:'qa', sezioni:[{ titolo:'QA', domande:[
  { id:1, testo:'Gli estintori sono mantenuti accessibili e visibili?' },
  { id:2, testo:'Gli idranti sono mantenuti accessibili e visibili?' }
] }] };
const row = (text, id=1) => ({ formato:'nostro', id_originale:id, numero_originale:id, testo_originale:text, stato_originale:'NC', nota_originale:'NOTA-SORGENTE' });

test('deleted question sharing generic words with reused number requires confirmation', () => {
  const [r] = m.abbinaRighe([row('Le uscite sono mantenute accessibili e visibili?')], checklist).righe;
  assert.equal(r.automatico, false);
  assert.equal(m.rigaImportabile(r), false);
  assert.equal(r.note, 'NOTA-SORGENTE');
});
test('renumbered similar questions cannot use the old id to break textual ambiguity', () => {
  const [r] = m.abbinaRighe([row('Sono mantenuti accessibili e visibili?')], checklist).righe;
  assert.equal(r.automatico, false);
});
test('Interparking count alone does not certify ownership or silently retire rows', () => {
  const current = JSON.parse(fs.readFileSync('checklists/interparking_sopralluogo.json','utf8'));
  const rows = Array.from({length:75}, (_,i)=>row('Voce sconosciuta revisione alternativa '+i,i+1));
  const result = m.abbinaRighe(rows,current);
  assert.equal(result.righe.some(r=>r.automatico),false);
  assert.equal(result.riepilogo.ritirate,0);
});
test('photo of removed question with reused caption number stays unassigned', () => {
  const [photo] = m.collegaImmaginiAlleDomande([{didascalia:'Foto 1 - Domanda 1: Le uscite sono mantenute accessibili e visibili?'}],[],checklist);
  assert.equal(photo.domanda_id_collegata,null);
});
test('photo must not inherit an unconfirmed row through caption id', () => {
  const matched = m.abbinaRighe([row('Le uscite sono mantenute accessibili e visibili?')],checklist).righe;
  matched[0].automatico=false; matched[0].stato_riga='da_verificare';
  const [photo] = m.collegaImmaginiAlleDomande([{didascalia:'Foto 1 - Domanda 1'}],matched,checklist);
  assert.equal(photo.domanda_id_collegata,null);
});
