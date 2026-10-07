const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const context = { String, Array };
vm.createContext(context);
vm.runInContext(
  fs.readFileSync(path.join(__dirname, '..', 'js', 'storico-filtri.js'), 'utf8') +
  '\nglobalThis.__filtri = storicoFiltri;',
  context
);
const filtri = context.__filtri;
const clienti = [
  { nome: 'Coin', checklist_ids: ['coin_sopralluogo'] },
  { nome: 'Interparking', checklist_ids: ['interparking_sopralluogo'] },
  { nome: 'Restage', checklist_ids: ['restage_sopralluogo'] },
  { nome: 'Melluso', checklist_ids: ['melluso_sopralluogo'] },
  { nome: 'Carrefour', checklist_ids: ['carrefour_sopralluogo'] }
];

test('filtro cliente riconosce gli id correnti', () => {
  assert.equal(filtri.corrispondeCliente({ checklist_id:'coin_sopralluogo', punto_vendita:'5 Giornate' }, 'Coin', clienti), true);
  assert.equal(filtri.corrispondeCliente({ checklist_id:'interparking_sopralluogo', punto_vendita:'Rho' }, 'Interparking', clienti), true);
  assert.equal(filtri.corrispondeCliente({ checklist_id:'carrefour_sopralluogo', punto_vendita:'Bologna Matteotti' }, 'Carrefour', clienti), true);
});

test('filtro cliente recupera gli id legacy che contengono il nome cliente', () => {
  assert.equal(filtri.corrispondeCliente({ checklist_id:'coin_checklist_v1', punto_vendita:'Mestre' }, 'Coin', clienti), true);
  assert.equal(filtri.corrispondeCliente({ checklist_id:'interparking_old', punto_vendita:'Quinto Alpini' }, 'Interparking', clienti), true);
  assert.equal(filtri.corrispondeCliente({ checklist_id:'melluso_2026', punto_vendita:'Via Roma' }, 'Melluso', clienti), true);
});

test('filtro cliente usa la sede come fallback per record storici non classificati', () => {
  assert.equal(filtri.corrispondeCliente({ checklist_id:'legacy_001', punto_vendita:'Coin - Varese' }, 'Coin', clienti), true);
  assert.equal(filtri.corrispondeCliente({ punto_vendita:'Carrefour Daily Bologna' }, 'Carrefour', clienti), true);
  assert.equal(filtri.corrispondeCliente({ checklist_id:'legacy_001', punto_vendita:'Rho' }, 'Coin', clienti), false);
});

test('Altro non ingloba gli id correnti dei clienti configurati', () => {
  assert.equal(filtri.corrispondeCliente({ checklist_id:'coin_sopralluogo', punto_vendita:'Mestre' }, '__altro__', clienti), false);
  assert.equal(filtri.corrispondeCliente({ checklist_id:'cliente_sconosciuto', punto_vendita:'Sede X' }, '__altro__', clienti), true);
});
