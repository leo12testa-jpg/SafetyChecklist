const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

test('service-worker.js è JavaScript valido e precachea il logo Carrefour', () => {
  const source = fs.readFileSync(path.join(root, 'service-worker.js'), 'utf8');
  assert.doesNotThrow(() => new vm.Script(source));
  assert.equal(source.includes("'./assets/logo_melluso.png',\\n"), false, 'escape \\n letterale rimasto nell APP_SHELL');
  assert.match(source, /['"]\.\/assets\/logo_carrefour\.png['"]/);
  assert.ok(fs.statSync(path.join(root, 'assets', 'logo_carrefour.png')).size > 1000);
});

test('tutti i clienti configurati puntano a checklist esistenti e versionate', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'checklists', 'index.json'), 'utf8'));
  const clients = JSON.parse(fs.readFileSync(path.join(root, 'checklists', 'clients.json'), 'utf8'));
  const byId = new Map(manifest.checklists.map(c => [c.id, c]));
  for (const client of clients.clienti) {
    assert.ok(Array.isArray(client.checklist_ids) && client.checklist_ids.length, client.nome + ': checklist_ids assenti');
    for (const id of client.checklist_ids) {
      const entry = byId.get(id);
      assert.ok(entry, client.nome + ': checklist non presente nel manifest: ' + id);
      assert.ok(entry.versione, id + ': versione assente');
      const file = JSON.parse(fs.readFileSync(path.join(root, 'checklists', id + '.json'), 'utf8'));
      assert.equal(file.id, id);
      assert.equal(String(file.versione), String(entry.versione));
    }
  }
  assert.deepEqual(clients.clienti.find(c => c.nome === 'Carrefour').checklist_ids, ['carrefour_sopralluogo']);
});

test('Carrefour ha logo PDF e firma cache dedicata', () => {
  const pdf = fs.readFileSync(path.join(root, 'js', 'pdf.js'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'js', 'app.js'), 'utf8');
  assert.match(pdf, /carrefour:\s*\{[\s\S]*?assets\/logo_carrefour\.png[\s\S]*?forzaJpeg:\s*true/);
  assert.match(app, /carrefour_sopralluogo['"]\) return ['"]carrefour-logo-2:/);
});

test('browser PDF regression include Carrefour', () => {
  const browser = fs.readFileSync(path.join(root, 'tests', 'pdf-browser.cjs'), 'utf8');
  assert.match(browser, /\['coin', 'interparking', 'restage', 'melluso', 'carrefour'\]/);
});
