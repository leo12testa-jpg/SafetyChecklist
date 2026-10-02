const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

const html=fs.readFileSync('ore-produttivita/index.html','utf8');
const app=fs.readFileSync('ore-produttivita/app.js','utf8');
const updater=fs.readFileSync('ore-produttivita/aggiornamento.js','utf8');

function hasListener(id){
  const escaped=id.replace(/[.*+?^$\\{\\}()|[\\]\\\\]/g,'\\\\$&');
  return new RegExp('\\\\$\\\\(\"#'+escaped+'\"\\\\)\\\\??\\\\.addEventListener').test(app);
}

test('frontend never launches CRM/browser protocol',()=>{
  assert.doesNotMatch(html,/id=\"syncCrmNow\"/);
  assert.doesNotMatch(app,/colligoore:\\/\\//i);
  assert.match(app,/frontend non apre mai il CRM/i);
});

test('main static buttons are wired',()=>{
  const ids=[...html.matchAll(/<button[^>]*\\bid=\"([^\"]+)\"/g)].map(m=>m[1]);
  const special=new Set(['loginBtn','oreUpdateButton']);
  const missing=ids.filter(id=>!special.has(id)&&!hasListener(id));
  assert.deepEqual(missing,[],`Pulsanti senza handler: ${missing.join(', ')}`);
  assert.match(app,/loginForm\\.addEventListener\\(\"submit\"/);
  assert.match(updater,/button\\?\\.addEventListener\\(\"click\"/);
});

test('reload is data-only and update is version-only',()=>{
  assert.match(app,/\\$\\(\"#refreshDay\"\\)\\.addEventListener\\(\"click\",loadDay\\)/);
  assert.match(html,/id=\"loadAdmin\"[^>]*>Applica filtri<\\/button>/);
  assert.match(html,/id=\"oreUpdateButton\"[^>]*>Aggiorna<\\/button>/);
});

test('dynamic control families are wired',()=>{
  assert.match(app,/\\[data-quick-minutes\\]/);
  assert.match(app,/\\[data-admin-jump\\]/);
  assert.match(app,/\\[data-admin-tab\\]/);
  assert.match(app,/\\.archive-open/);
  assert.match(app,/\\.assignment-edit/);
});
