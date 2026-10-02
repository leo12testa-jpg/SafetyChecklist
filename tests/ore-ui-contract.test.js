const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('ore-produttivita/index.html', 'utf8');
const app = fs.readFileSync('ore-produttivita/app.js', 'utf8');
const updater = fs.readFileSync('ore-produttivita/aggiornamento.js', 'utf8');

function hasListener(id) {
  return app.includes(`$("#${id}").addEventListener`) ||
         app.includes(`$("#${id}")?.addEventListener`);
}

test('frontend never launches CRM/browser protocol', () => {
  assert.equal(html.includes('id="syncCrmNow"'), false);
  assert.equal(app.toLowerCase().includes('colligoore://'), false);
  assert.equal(app.toLowerCase().includes('frontend non apre mai il crm'), true);
});

test('main static buttons are wired', () => {
  const ids = [...html.matchAll(/<button[^>]*\bid="([^"]+)"/g)].map((m) => m[1]);
  const special = new Set(['loginBtn', 'oreUpdateButton']);
  const missing = ids.filter((id) => !special.has(id) && !hasListener(id));
  assert.deepEqual(missing, [], `Pulsanti senza handler: ${missing.join(', ')}`);
  assert.equal(app.includes('loginForm.addEventListener("submit"'), true);
  assert.equal(updater.includes('button?.addEventListener("click"'), true);
});

test('reload is data-only and update is version-only', () => {
  assert.equal(app.includes('$("#refreshDay").addEventListener("click",loadDay)'), true);
  assert.equal(html.includes('id="loadAdmin"'), true);
  assert.equal(html.includes('>Applica filtri</button>'), true);
  assert.equal(html.includes('id="oreUpdateButton"'), true);
  assert.equal(html.includes('>Aggiorna</button>'), true);
});

test('dynamic control families are wired', () => {
  assert.equal(app.includes('[data-quick-minutes]'), true);
  assert.equal(app.includes('[data-admin-jump]'), true);
  assert.equal(app.includes('[data-admin-tab]'), true);
  assert.equal(app.includes('.archive-open'), true);
  assert.equal(app.includes('.assignment-edit'), true);
});
