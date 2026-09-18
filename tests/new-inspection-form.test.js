const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const source = fs.readFileSync(path.join(root, 'js', 'app.js'), 'utf8');
const checklists = JSON.parse(fs.readFileSync(path.join(root, 'checklists', 'index.json'), 'utf8')).checklists;
const clienti = JSON.parse(fs.readFileSync(path.join(root, 'checklists', 'clients.json'), 'utf8')).clienti;

function elemento(id) {
  const el = {
    id, value: '', hidden: false, disabled: false, required: false, textContent: '',
    dataset: {}, options: [], listeners: {},
    addEventListener(event, callback) { this.listeners[event] = callback; },
    appendChild(child) { this.options.push(child); },
    closest() { return this.label || (this.label = elemento(`${id}-label`)); },
  };
  Object.defineProperty(el, 'innerHTML', {
    get() { return ''; },
    set() { this.options = []; },
  });
  return el;
}

function creaForm() {
  const ids = [...source.matchAll(/document\.getElementById\('([^']+)'\)/g)].map((match) => match[1]);
  const elementi = new Map(ids.map((id) => [id, elemento(id)]));
  const get = (id) => elementi.get(id);
  const etichette = {
    'label-input-punto-vendita-testo': 'Punto vendita',
    'label-input-indirizzo-testo': 'Indirizzo punto vendita',
    'label-input-responsabile-testo': 'Responsabile del punto vendita',
    'label-select-presenza-responsabile-testo': 'Il sopralluogo è fatto alla presenza del responsabile del punto vendita?',
  };
  for (const [id, testo] of Object.entries(etichette)) get(id).textContent = testo;
  get('form-nuovo-sopralluogo').reset = () => {
    for (const el of elementi.values()) el.value = '';
  };

  const router = { onEnter(_route, callback) { this.enter = callback; } };
  const storico = { id: 77, checklist_id: 'restage_sopralluogo', punto_vendita: 'Sede storica' };
  const scritture = [];
  const context = vm.createContext({
    console, Date, Promise, Array, Object, Set,
    document: { getElementById: get, createElement: (tag) => elemento(tag) },
    router,
    db: { elencaSopralluoghi: async () => [storico], creaSopralluogo: async (...args) => { scritture.push(args); } },
    fetch: async (url) => ({ json: async () => url.endsWith('index.json') ? { checklists } : { clienti } }),
    popolaSuggerimentiAnagrafica: async () => {},
    popolaSelectTecnico: async () => {},
    aggiornaVisibilitaTecnicoAltro: (select, label, input) => {
      label.hidden = select.value !== '__altro__';
      input.required = !label.hidden;
    },
    leggiValoreTecnico: (select, input) => select.value === '__altro__' ? input.value : select.value,
    precompilaTecnico: () => {},
    anteprimaImportazionePendente: null,
    pdfImport: { estraiRighe: async () => ({ formatoRilevato: 'storico', righe: [{}], anagrafica: {}, immagini: [] }) },
    checklistEngine: { carica: async (id) => ({ id }) },
    importMatching: {
      rilevaChecklist: () => ({ checklistId: 'interparking_sopralluogo', automatico: true, confidenza: 1 }),
      abbinaRighe: () => ({ righe: [], riepilogo: { totaleRighe: 1 } }),
      collegaImmaginiAlleDomande: () => [],
    },
    pdf: { calcolaPuntoDivisioneGruppi: () => 0 },
  });
  const inizioRegole = source.indexOf('const ETICHETTE_PERSONALIZZATE_PER_CHECKLIST =');
  const fineRegole = source.indexOf('/** Riempie una <datalist>', inizioRegole);
  const inizioForm = source.indexOf('const nuovoSopralluogoScreen =');
  const fineForm = source.indexOf('const importPreviewScreen =', inizioForm);
  assert.ok(inizioRegole >= 0 && fineRegole > inizioRegole && inizioForm >= 0 && fineForm > inizioForm);
  vm.runInContext(source.slice(inizioRegole, fineRegole), context);
  vm.runInContext(source.slice(inizioForm, fineForm) + '\nnuovoSopralluogoScreen.init();', context);
  return { get, router, storico, scritture, context };
}

async function formPronto() {
  const form = creaForm();
  await form.router.enter();
  return form;
}

function seleziona(form, id) {
  form.get('select-checklist').value = id;
  form.get('select-checklist').listeners.change();
}

test('Checklist è il primo campo e tutte le checklist sono disponibili prima degli altri dati', async () => {
  const formHtml = html.slice(html.indexOf('<form id="form-nuovo-sopralluogo">'));
  assert.ok(formHtml.indexOf('for="select-checklist"') < formHtml.indexOf('for="input-punto-vendita"'));
  const form = await formPronto();
  assert.equal(form.get('select-checklist').value, '');
  assert.deepEqual(form.get('select-checklist').options.map((option) => option.value), ['', ...checklists.map((item) => item.id)]);
});

test('REGRESSIONE: la prima opzione della select checklist è sempre vuota, non disabilitata, e nessuna checklist è selezionata di default', async () => {
  const form = await formPronto();
  const opzioni = form.get('select-checklist').options;
  assert.equal(opzioni[0].value, '', 'la prima opzione deve avere value=""');
  assert.ok(!opzioni[0].disabled, 'la prima opzione non deve essere disabled, altrimenti l\'utente non può più riselezionarla per nascondere di nuovo il form');
  assert.equal(form.get('select-checklist').value, '', 'nessuna checklist deve risultare selezionata di default (es. Coin) all\'apertura del form');
  assert.equal(form.get('dati-sopralluogo').hidden, true, 'il resto del form deve restare nascosto finché non si sceglie una checklist');
});

test('Selezionare una checklist mostra il resto del form; tornare a "Seleziona checklist…" lo nasconde di nuovo', async () => {
  const form = await formPronto();
  assert.equal(form.get('dati-sopralluogo').hidden, true);
  seleziona(form, 'coin_sopralluogo');
  assert.equal(form.get('dati-sopralluogo').hidden, false);
  seleziona(form, '');
  assert.equal(form.get('dati-sopralluogo').hidden, true);
});

test('Ogni ingresso manuale nella schermata riparte da checklist vuota e form nascosto, anche dopo una scelta precedente', async () => {
  const form = await formPronto();
  seleziona(form, 'coin_sopralluogo');
  assert.equal(form.get('dati-sopralluogo').hidden, false);
  await form.router.enter();
  assert.equal(form.get('select-checklist').value, '', 'rientrando manualmente non deve restare selezionata la checklist della visita precedente');
  assert.equal(form.get('dati-sopralluogo').hidden, true);
});

test('Interparking cambia subito etichette e visibilità senza digitare Punto vendita', async () => {
  const form = await formPronto();
  seleziona(form, 'interparking_sopralluogo');
  assert.equal(form.get('input-punto-vendita').value, '');
  assert.equal(form.get('label-input-punto-vendita-testo').textContent, 'Struttura / Parcheggio');
  assert.equal(form.get('label-input-indirizzo-testo').textContent, 'Indirizzo struttura');
  assert.equal(form.get('label-input-responsabile-testo').textContent, 'Responsabile della struttura');
  assert.equal(form.get('input-numero-dipendenti').closest('label').hidden, true);
  assert.equal(form.get('input-area-manager').closest('label').hidden, true);
  assert.equal(form.get('label-input-tecnico-3').hidden, false);
  assert.equal(form.get('label-input-tecnico-4').hidden, false);
  form.get('select-presenza-rls').value = 'Sì';
  form.get('select-presenza-rls').listeners.change();
  assert.equal(form.get('label-input-nome-rls').hidden, false);
});

test('Interparking → Coin → Interparking ripristina i campi senza perdere valori', async () => {
  const form = await formPronto();
  seleziona(form, 'interparking_sopralluogo');
  form.get('input-punto-vendita').value = 'Parcheggio prova';
  form.get('input-indirizzo-punto-vendita').value = 'Via prova';
  form.get('input-area-manager').value = 'Valore già inserito';
  form.get('input-tecnico-3').value = '__altro__';
  form.get('input-tecnico-3-altro').value = 'Tecnico prova';
  seleziona(form, 'coin_sopralluogo');
  assert.equal(form.get('label-input-punto-vendita-testo').textContent, 'Punto vendita');
  assert.equal(form.get('label-input-indirizzo-testo').textContent, 'Indirizzo punto vendita');
  assert.equal(form.get('input-numero-dipendenti').closest('label').hidden, false);
  assert.equal(form.get('input-area-manager').closest('label').hidden, false);
  assert.equal(form.get('label-input-tecnico-3').hidden, true);
  assert.equal(form.get('label-input-tecnico-3-altro').hidden, true);
  assert.equal(form.get('input-tecnico-3').value, '__altro__');
  assert.equal(form.get('input-tecnico-3-altro').value, 'Tecnico prova');
  seleziona(form, 'interparking_sopralluogo');
  assert.equal(form.get('label-input-punto-vendita-testo').textContent, 'Struttura / Parcheggio');
  assert.equal(form.get('label-input-tecnico-3-altro').hidden, false);
  assert.equal(form.get('input-punto-vendita').value, 'Parcheggio prova');
  assert.equal(form.get('input-indirizzo-punto-vendita').value, 'Via prova');
  assert.equal(form.get('input-area-manager').value, 'Valore già inserito');
  assert.equal(form.get('input-tecnico-3-altro').value, 'Tecnico prova');
});

test('Restage e Melluso conservano le regole esistenti', async () => {
  const form = await formPronto();
  seleziona(form, 'restage_sopralluogo');
  assert.equal(form.get('label-input-punto-vendita-testo').textContent, 'Unità produttiva');
  assert.equal(form.get('input-numero-dipendenti').closest('label').hidden, false);
  seleziona(form, 'melluso_sopralluogo');
  assert.equal(form.get('label-input-punto-vendita-testo').textContent, 'Punto vendita');
  assert.equal(form.get('input-numero-dipendenti').closest('label').hidden, true);
  assert.equal(form.get('input-area-manager').closest('label').hidden, false);
});

test('PDF riconosciuto seleziona la checklist e aggiorna subito il form; vecchi sopralluoghi invariati', async () => {
  const form = await formPronto();
  seleziona(form, 'coin_sopralluogo');
  const input = form.get('input-importa-pdf');
  input.files = [{ name: 'storico.pdf' }];
  await input.listeners.change({ target: input });
  assert.equal(form.get('select-checklist').value, 'interparking_sopralluogo');
  assert.equal(form.get('label-input-punto-vendita-testo').textContent, 'Struttura / Parcheggio');
  assert.equal(form.get('input-numero-dipendenti').closest('label').hidden, true);
  assert.equal(form.storico.checklist_id, 'restage_sopralluogo');
  assert.equal(form.storico.punto_vendita, 'Sede storica');
  assert.equal(form.scritture.length, 0);
});

test('Importazione PDF dallo stato iniziale (nessuna checklist scelta a mano) mostra comunque subito il form riconosciuto', async () => {
  const form = await formPronto();
  assert.equal(form.get('select-checklist').value, '');
  assert.equal(form.get('dati-sopralluogo').hidden, true);
  const input = form.get('input-importa-pdf');
  input.files = [{ name: 'storico.pdf' }];
  await input.listeners.change({ target: input });
  assert.equal(form.get('select-checklist').value, 'interparking_sopralluogo');
  assert.equal(form.get('dati-sopralluogo').hidden, false);
});
