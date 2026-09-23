const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const context = { console, pdfjsLib: { GlobalWorkerOptions: {} } };
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/pdf-import.js'), 'utf8'), context);
const classify = vm.runInContext('pdfImport._test.classificaHeader', context);
const region = (overrides = {}) => ({ pagina:1, indice:1, impronta:'pixels-A', x:40, right:150,
  y:730, top:810, distanzaTop:30, larghezza:110, altezza:80, larghezzaPagina:595,
  sopraDati:false, didascaliaFoto:false, ...overrides });

test('same decoded image and header geometry across pages: both copies excluded', () => {
  const result = classify([region(), region({pagina:2,indice:8,x:54,distanzaTop:37})]);
  assert.ok(result.get(1).has(1));
  assert.ok(result.get(2).has(8));
});
test('unique portrait or landscape at top is retained, including page one', () => {
  assert.equal(classify([region({larghezza:40,altezza:100}),region({pagina:2,impronta:'pixels-B',larghezza:120,altezza:40})]).size,0);
});
test('identical geometry or page-local XObject reference alone is insufficient', () => {
  assert.equal(classify([region({ref:'img_1'}),region({pagina:2,ref:'img_1',impronta:'pixels-B'})]).size,0);
  assert.equal(classify([region({impronta:null}),region({pagina:2,impronta:null})]).size,0);
});
test('reused image at a different header position or size is retained', () => {
  for (const change of [{x:90},{distanzaTop:50},{larghezza:160},{altezza:120}]) {
    assert.equal(classify([region(),region({pagina:2,...change})]).size,0);
  }
});
test('two copies on the same page are not evidence of a repeated header', () => {
  assert.equal(classify([region(),region({indice:2})]).size,0);
});
test('paired letterhead above general-data block excludes both graphics without ratio rule', () => {
  const result=classify([region({sopraDati:true}),region({indice:2,x:440,right:565,sopraDati:true})]);
  assert.equal(result.get(1).size,2);
});
test('a single first-page image or a captioned photograph above metadata is retained', () => {
  assert.equal(classify([region({sopraDati:true})]).size,0);
  assert.equal(classify([region({sopraDati:true,didascaliaFoto:true}),region({indice:2,x:440,right:565,sopraDati:true})]).size,0);
});
