const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function caricaNavigatore() {
  const context = {};
  vm.createContext(context);
  vm.runInContext(`${fs.readFileSync('js/question-navigator.js', 'utf8')}\nglobalThis.api = questionNavigator;`, context);
  return context.api;
}

function caricaMotore() {
  const context = {
    db: {
      salvaRisposta: async (_id, risposta) => {
        const indice = context.sopralluogo.risposte.findIndex((r) => r.domanda_id === risposta.domanda_id);
        if (indice >= 0) context.sopralluogo.risposte[indice] = { ...context.sopralluogo.risposte[indice], ...risposta };
        else context.sopralluogo.risposte.push(risposta);
        return context.sopralluogo;
      }
    },
    fetch: async () => ({ ok: false })
  };
  vm.createContext(context);
  vm.runInContext(`${fs.readFileSync('js/checklist.js', 'utf8')}\nglobalThis.api = checklistEngine;`, context);
  return context;
}

function checklistConDomande(totale) {
  return {
    sezioni: [{ titolo: 'Sezione', domande: Array.from({ length: totale }, (_, i) => ({ id: i + 1, testo: `Domanda ${i + 1}` })) }]
  };
}

test('click e touch sulla barra selezionano la domanda corrispondente', () => {
  const api = caricaNavigatore();
  assert.equal(api.indiceDaPosizione(50, 0, 100, 10), 5);
  assert.equal(api.indiceDaPosizione(0, 0, 100, 10), 0);
  assert.equal(api.indiceDaPosizione(100, 0, 100, 10), 9);
});

test('drag avanti, indietro e salto domanda 5 → 50', () => {
  const api = caricaNavigatore();
  assert.equal(api.classificaMovimento(40, 2), 'orizzontale');
  assert.equal(api.classificaMovimento(-40, 2), 'orizzontale');
  assert.equal(api.indiceDaPosizione(49.5, 0, 82, 82), 49);
});

test('scroll touch verticale non viene interpretato come navigazione', () => {
  const api = caricaNavigatore();
  assert.equal(api.classificaMovimento(3, 30), 'verticale');
  assert.equal(api.classificaMovimento(3, 4), 'tap');
});

test('motore salta e ritorna a una domanda conservando risposta, note e foto', async () => {
  const context = caricaMotore();
  context.sopralluogo = { id: 's1', risposte: [] };
  context.api.avvia(checklistConDomande(82), context.sopralluogo);
  context.api.vaiA(4);
  await context.api.rispondi({ valore: 'PC', note: 'Nota domanda 5', foto: ['foto-5'] });
  context.api.vaiA(49);
  assert.equal(context.api.domandaCorrente().domanda.id, 50);
  context.api.vaiA(4);
  const salvata = context.api.domandaCorrente().risposta;
  assert.equal(salvata.risposta, 'PC');
  assert.equal(salvata.note, 'Nota domanda 5');
  assert.deepEqual(Array.from(salvata.foto), ['foto-5']);
});

test('pulsanti avanti e indietro restano compatibili con il salto diretto', () => {
  const context = caricaMotore();
  context.sopralluogo = { id: 's1', risposte: [] };
  context.api.avvia(checklistConDomande(10), context.sopralluogo);
  context.api.vaiA(5);
  assert.equal(context.api.indietro(), true);
  assert.equal(context.api.domandaCorrente().indice, 4);
  assert.equal(context.api.avanti(), true);
  assert.equal(context.api.domandaCorrente().indice, 5);
});
