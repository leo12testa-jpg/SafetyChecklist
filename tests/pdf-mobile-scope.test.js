const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function app(risposte, missing = false, synced = true) {
  const nodes = new Map(), calls = [];
  function element(id) {
    if (!nodes.has(id)) nodes.set(id, { value: '', dataset: {}, hidden: true,
      addEventListener(name, fn) { this[name] = fn; }, querySelectorAll: () => [],
      querySelector: () => element(id + '-child'), classList: { add() {}, remove() {} } });
    return nodes.get(id);
  }
  const record = { id: 's1', risposte };
  const context = { console, Blob, setTimeout, clearTimeout, navigator: { onLine: true }, window: { addEventListener() {} },
    document: { getElementById: element, querySelector: element, querySelectorAll: () => [], addEventListener() {} },
    checklistEngine: { getChecklist: () => ({}), sopralluogoCorrente: () => record },
    sync: { sincronizzaTutto: async () => { calls.push('sync'); record.foto_url = { a: { path: 'remote/a' } }; return synced; } },
    fotoSync: { riprovaInSospeso: async () => calls.push('upload'), risolviFoto: async (id) => missing ? null : { id, blob: new Blob(['jpg']) } },
    db: { leggiSopralluogo: async () => { calls.push('read'); return record; },
      aggiornaSopralluogo: async () => calls.push('complete'), salvaPdfReport: async r => calls.push(r) },
    pdf: { generaReport: async (_, r) => {
      assert.ok(r.foto_url); calls.push('generate');
      if (missing) throw new Error('2 foto mancanti');
      return new Blob(['%PDF-']);
    }, nomeFile: () => 'report.pdf', descriviErrore: (_, e) => e.message }
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('js/app.js', 'utf8'), context);
  vm.runInContext('riepilogoScreen.init()', context);
  return { nodes, calls, context };
}

for (const legacy of [false, true]) test(`Genera PDF riepilogo: scope reale e risposte ${legacy ? 'Object legacy' : 'Array'}`, async () => {
  const answer = { domanda_id: 17, risposta: 'NC', foto: ['a', 'b'] };
  const { nodes, calls, context } = app(legacy ? { 17: answer } : [answer]);
  await nodes.get('btn-genera-pdf').click();
  assert.deepEqual(calls.slice(0, 3), ['sync', 'read', 'generate']);
  assert.equal(calls.at(-1).firma_foto, 'complete-v2:a|b');
  assert.equal(vm.runInContext('typeof preparaDatiPdfCrossDevice', context), 'function');
  assert.equal(vm.runInContext('typeof firmaFotoSopralluogo', context), 'function');
});

test('riepilogo non salva né completa il sopralluogo se mancano foto', async () => {
  const { nodes, calls } = app([], true);
  await nodes.get('btn-genera-pdf').click();
  assert.ok(!calls.includes('complete'));
  assert.ok([...nodes.values()].some(n => n.textContent === '2 foto mancanti'));
});

test('sincronizzazione fallita lascia aprire PDF con dati locali', async () => {
  const { nodes, calls } = app([], false, false);
  await nodes.get('btn-genera-pdf').click();
  assert.ok(calls.includes('generate'));
  assert.equal(calls.at(-1).filename, 'report.pdf');
});

test('cache: firma precedente non certifica un PDF completo, firma nuova consente il riuso', () => {
  const { context } = app([]);
  const source = fs.readFileSync('js/app.js', 'utf8');
  const start = source.indexOf('  function pdfSalvatoAncoraValido(');
  const end = source.indexOf('\n  /**', start);
  vm.runInContext(source.slice(start, end), context);
  assert.equal(vm.runInContext("pdfSalvatoAncoraValido({ blob: true, firma_foto: '' }, { checklist_id: 'melluso_sopralluogo', risposte: [] })", context), false);
  assert.equal(vm.runInContext("pdfSalvatoAncoraValido({ blob: true, firma_foto: 'melluso-layout-2:' }, { checklist_id: 'melluso_sopralluogo', risposte: [] })", context), false);
  assert.equal(vm.runInContext("pdfSalvatoAncoraValido({ blob: true, firma_foto: 'melluso-layout-3:' }, { checklist_id: 'melluso_sopralluogo', risposte: [] })", context), true);
  assert.equal(vm.runInContext("pdfSalvatoAncoraValido({ blob: true, firma_foto: 'a|b' }, { risposte: [{ foto: ['a','b'] }] })", context), false);
  assert.equal(vm.runInContext("pdfSalvatoAncoraValido({ blob: true, firma_foto: 'complete-v2:a|b' }, { risposte: [{ foto: ['a','b'] }] })", context), true);
});


test('foto mancante non blocca: il PDF viene generato, il sopralluogo completato e compare un avviso non bloccante', async () => {
  const answer = { domanda_id: 17, risposta: 'NC', foto: ['a'] };
  const { nodes, calls, context } = app([answer], false, true);
  context.fotoSync.risolviFoto = async () => null; // foto non recuperabile né in locale né da Supabase
  let alerts = 0; context.alert = () => alerts++;
  await nodes.get('btn-genera-pdf').click();
  assert.ok(calls.includes('generate'));
  assert.ok(calls.includes('complete'));
  assert.equal(calls.at(-1).foto_incomplete, true);
  assert.equal(alerts, 0);
  assert.equal(nodes.get('avviso-non-bloccante').textContent, 'PDF generato. 1 foto è ancora in sincronizzazione.');
});
