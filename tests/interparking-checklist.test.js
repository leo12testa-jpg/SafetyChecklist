const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const checklist = JSON.parse(fs.readFileSync(path.join(root, 'checklists', 'interparking_sopralluogo.json'), 'utf8'));
const domande = checklist.sezioni.flatMap((sezione) => sezione.domande);
const ids = domande.map((domanda) => domanda.id);

test('Interparking rimuove solo gli ID 16 e 17, senza rinumerare gli altri', () => {
  assert.equal(ids.includes(16), false);
  assert.equal(ids.includes(17), false);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(ids.slice(13, 17), [14, 15, 18, 19]);
  assert.ok(ids.includes(28));
});

test('la domanda ID 28 perde solo la parola semestrali', () => {
  assert.equal(domande.find((domanda) => domanda.id === 28).testo,
    'Sono Presenti le registrazioni dei controlli effettuati a: Eventuali altri impianti:');
});

test('risposte storiche agli ID 16 e 17 non interrompono apertura, navigazione o riepilogo', () => {
  const context = vm.createContext({});
  const source = fs.readFileSync(path.join(root, 'js', 'checklist.js'), 'utf8');
  vm.runInContext(`${source}\nglobalThis.engine = checklistEngine;`, context);
  const storico = {
    id: 99,
    risposte: [
      { domanda_id: 16, risposta: 'NC', note: 'Storica' },
      { domanda_id: 17, risposta: 'C' },
      { domanda_id: 15, risposta: 'C' },
    ],
  };
  context.engine.avvia(checklist, storico);
  assert.equal(context.engine.domandaCorrente().domanda.id, 1);
  assert.equal(context.engine.vaiA(15), true);
  assert.equal(context.engine.domandaCorrente().domanda.id, 18);
  const riepilogo = context.engine.calcolaRiepilogo(checklist, storico);
  assert.equal(riepilogo.totale, ids.length);
  assert.equal(riepilogo.conteggi.C, 1);
  assert.equal(riepilogo.conteggi.NC, 0);
  assert.equal(storico.risposte.length, 3);
});
