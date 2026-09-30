const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function closureHelper() {
  const source = fs.readFileSync('js/app.js', 'utf8');
  const match = source.match(/function sopralluogoChiuso\(sopralluogo\) \{([\s\S]*?)\n\}/);
  assert.ok(match, 'sopralluogoChiuso helper missing');
  const context = {};
  vm.createContext(context);
  vm.runInContext(`globalThis.fn = function sopralluogoChiuso(sopralluogo) {${match[1]}\n}`, context);
  return context.fn;
}

test('completed legacy inspections are closed consistently', () => {
  const closed = closureHelper();
  assert.equal(closed({ stato: 'completato' }), true);
  assert.equal(closed({ stato: 'in corso' }), false);
  assert.equal(closed({ stato: 'in corso', stato_chiusura: 'chiuso' }), true);
  assert.equal(closed({ stato: 'completato', stato_chiusura: 'aperto' }), false);
});

test('PDF completion explicitly persists closed state', () => {
  const source = fs.readFileSync('js/app.js', 'utf8');
  assert.match(source, /stato:\s*'completato',[\s\S]{0,180}stato_chiusura:\s*'chiuso'/);
});
