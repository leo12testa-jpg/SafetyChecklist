const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function carica() {
  const record = {
    id: 'interparking-legacy',
    risposte: [{ domanda_id: '12', risposta: 'C', note: null, foto: [] }]
  };
  const context = {
    console,
    db: {
      salvaChecklistCache: async () => {},
      leggiChecklistCache: async () => null,
      salvaRisposta: async (_id, risposta) => {
        const i = record.risposte.findIndex((r) => String(r.domanda_id) === String(risposta.domanda_id));
        if (i >= 0) record.risposte[i] = { ...record.risposte[i], ...risposta };
        else record.risposte.push(risposta);
        return record;
      },
      leggiSopralluogo: async () => record
    },
    fetch: async () => { throw new Error('not used'); }
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('js/checklist.js','utf8') + ';globalThis.api=checklistEngine;', context);
  return { api: context.api, record };
}

test('Interparking legacy: id risposta stringa equivale all id numerico della checklist', () => {
  const { api, record } = carica();
  api.avvia({
    id: 'interparking_sopralluogo',
    sezioni: [{ titolo:'Test', domande:[
      { id:12, testo:'Già risposta', tipo:'C-PC-NC-NA' },
      { id:13, testo:'Da rispondere', tipo:'C-PC-NC-NA' }
    ]}]
  }, record);
  assert.equal(api.domandaCorrente().domanda.id, 13);
  api.indietro();
  assert.equal(api.domandaCorrente().risposta.risposta, 'C');
});


test('riepilogo riconosce domanda_id numerico salvato come stringa', () => {
  const { api } = carica();
  const checklist = { id:'interparking_sopralluogo', sezioni:[{ titolo:'Test', domande:[
    { id:12, testo:'Domanda 12', tipo:'C-PC-NC-NA' }
  ]}]};
  const riepilogo = api.calcolaRiepilogo(checklist, {
    risposte:[{ domanda_id:'12', risposta:'NC', note:'legacy', foto:[] }]
  });
  assert.equal(riepilogo.nonRisposte, 0);
  assert.equal(riepilogo.conteggi.NC, 1);
  assert.equal(riepilogo.nonConformita.length, 1);
});
