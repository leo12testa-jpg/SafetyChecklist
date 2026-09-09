const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function caricaDb() {
  const context = { console, crypto: undefined, indexedDB: {} };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/db.js'), 'utf8'), context);
  return vm.runInContext('db', context);
}

test('DB: risposte Firestore in formato mappa vengono normalizzate in array locale', () => {
  const db = caricaDb();
  const risultato = db._normalizzaRisposte({
    '4': { risposta: 'NC', note: 'nota', foto: ['foto-1'] },
    '8': { domanda_id: 8, risposta: 'C', foto: [] }
  });
  assert.ok(Array.isArray(risultato));
  assert.equal(risultato.length, 2);
  assert.equal(risultato.find((r) => r.domanda_id === 4).risposta, 'NC');
  assert.deepEqual(Array.from(risultato.find((r) => r.domanda_id === 4).foto), ['foto-1']);
  assert.equal(risultato.find((r) => r.domanda_id === 8).risposta, 'C');
});

test('DB: null e formati inattesi diventano array vuoto senza .reduce/.find su oggetti', () => {
  const db = caricaDb();
  assert.deepEqual(Array.from(db._normalizzaRisposte(null)), []);
  assert.deepEqual(Array.from(db._normalizzaRisposte('non valido')), []);
});
