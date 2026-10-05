const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function loadEngine({ fetchImpl, cached = null } = {}) {
  let saved = null;
  const context = {
    console,
    fetch: fetchImpl,
    encodeURIComponent,
    Set,
    String,
    Array,
    Object,
    db: {
      salvaChecklistCache: async (value) => { saved = value; },
      leggiChecklistCache: async () => cached
    }
  };
  vm.createContext(context);
  const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'checklist.js'), 'utf8');
  vm.runInContext(source + '\nglobalThis.__engine = checklistEngine;', context);
  return { engine: context.__engine, saved: () => saved };
}

test('manifest: tutte le checklist dichiarano la stessa versione del relativo JSON e id univoci', () => {
  const root = path.join(__dirname, '..');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'checklists', 'index.json'), 'utf8'));
  assert.ok(manifest.checklists.length > 0);
  for (const voce of manifest.checklists) {
    assert.ok(voce.versione, `${voce.id}: versione mancante nel manifest`);
    const checklist = JSON.parse(fs.readFileSync(path.join(root, 'checklists', `${voce.id}.json`), 'utf8'));
    assert.equal(checklist.id, voce.id);
    assert.equal(String(checklist.versione), String(voce.versione), `${voce.id}: versione manifest/file diversa`);
    const ids = checklist.sezioni.flatMap((s) => s.domande.map((d) => String(d.id)));
    assert.equal(new Set(ids).size, ids.length, `${voce.id}: id domanda duplicati`);
  }
});

test('carica: usa URL versionata e no-store e sostituisce una cache locale vecchia', async () => {
  const current = { id:'coin_sopralluogo', versione:'1.0', sezioni:[{titolo:'S',domande:[{id:1,testo:'Corrente'}]}] };
  const calls = [];
  const { engine, saved } = loadEngine({
    cached: { ...current, versione:'0.9' },
    fetchImpl: async (url, options) => {
      calls.push({ url:String(url), cache:options?.cache });
      if (String(url).includes('index.json')) {
        return { ok:true, json:async()=>({checklists:[{id:'coin_sopralluogo',versione:'1.0'}]}) };
      }
      return { ok:true, json:async()=>current };
    }
  });
  const result = await engine.carica('coin_sopralluogo');
  assert.equal(result.versione, '1.0');
  assert.ok(calls.some((c) => c.url.includes('coin_sopralluogo.json?v=1.0') && c.cache === 'no-store'));
  assert.equal(saved().versione, '1.0');
});

test('carica: offline non usa una cache con versione diversa da quella attesa', async () => {
  const cached = { id:'interparking_sopralluogo', versione:'1.1', sezioni:[{titolo:'S',domande:[{id:1,testo:'Vecchia'}]}] };
  const { engine } = loadEngine({
    cached,
    fetchImpl: async () => { throw new Error('offline'); }
  });
  await assert.rejects(
    () => engine.carica('interparking_sopralluogo', '1.2'),
    /Versione checklist non sincronizzata/
  );
});

test('carica: offline usa la cache solo quando la versione coincide', async () => {
  const cached = { id:'restage_sopralluogo', versione:'1.1', sezioni:[{titolo:'S',domande:[{id:1,testo:'Ok'}]}] };
  const { engine } = loadEngine({
    cached,
    fetchImpl: async () => { throw new Error('offline'); }
  });
  const result = await engine.carica('restage_sopralluogo', '1.1');
  assert.equal(result, cached);
});
