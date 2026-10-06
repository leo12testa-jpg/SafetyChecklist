const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('sync espone diagnostica della coda pendente', () => {
  const source = fs.readFileSync('js/sync.js','utf8');
  assert.match(source, /async function diagnosticaInAttesa\(\)/);
  assert.match(source, /diagnosticaInAttesa, statoAttuale/);
});

test('telemetria utilizzo invia accesso e stato sincronizzazione', () => {
  const app = fs.readFileSync('js/app.js','utf8');
  const auth = fs.readFileSync('js/auth.js','utf8');
  const account = fs.readFileSync('js/account-screens.js','utf8');
  assert.match(app, /event: evento/);
  assert.match(app, /pendingData: dettaglio\.dati/);
  assert.match(auth, /callEndpoint\('usagePing'/);
  assert.match(account, /api\('usage'\)/);
  assert.match(account, /accessi_30gg/);
});

test('indicatore parziale permette retry manuale', () => {
  const source = fs.readFileSync('js/app.js','utf8');
  assert.match(source, /Clicca per riprovare la sincronizzazione/);
  assert.match(source, /await sync\.sincronizzaCompleto\(\)/);
});
