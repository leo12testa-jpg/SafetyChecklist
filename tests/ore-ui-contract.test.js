const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('ore-produttivita/index.html', 'utf8');
const app = fs.readFileSync('ore-produttivita/app.js', 'utf8') + '\n' + fs.readFileSync('ore-produttivita/crm-links.js', 'utf8');
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
  const special = new Set(['loginBtn', 'oreUpdateButton', 'installAppBtn']);
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


test('canonical layout is loaded last and owns breakpoints',()=>{
  const layout=fs.readFileSync('ore-produttivita/layout.css','utf8');
  assert.ok(html.indexOf('layout.css')>html.indexOf('style.css'),'layout.css deve essere caricato dopo style.css');
  assert.match(layout,/--ui-page:1280px/);
  assert.match(layout,/#adminPanel \.admin-kpis\{[\s\S]*grid-template-columns:repeat\(5,minmax\(180px,210px\)\)!important/);
  assert.match(layout,/@media\(max-width:900px\)/);
  assert.match(layout,/@media\(max-width:620px\)/);
  assert.match(layout,/#dayPanel \.issue-main/);
  assert.match(layout,/#economicsPanel \.economics-layout/);
});


test('archive KPI cards are compact, not stretched 1fr',()=>{
  const layout=fs.readFileSync('ore-produttivita/layout.css','utf8');
  assert.match(layout,/#archivePanel \.summary-grid\.four,[\s\S]*grid-template-columns:repeat\(4,minmax\(210px,232px\)\)!important/);
  assert.doesNotMatch(layout,/#archivePanel \.summary-grid\.four[\s\S]{0,180}repeat\(4,minmax\(0,1fr\)\)/);
});


test('legacy layout override layers are removed from style.css',()=>{
  const base=fs.readFileSync('ore-produttivita/style.css','utf8');
  assert.equal(base.includes('Screenshot prototype fidelity pass'),false);
  assert.equal(base.includes('clarity pass: fewer visual distractions'),false);
  assert.equal(base.includes('stable UI foundation v1'),false);
});


test('archive pagination is wired and limited to 25 rows',()=>{
  assert.match(app,/const ARCHIVE_PAGE_SIZE=25/);
  assert.match(app,/pageRows=rows\.slice\(start,start\+ARCHIVE_PAGE_SIZE\)/);
  assert.match(app,/\$\("#archivePrev"\)\?\.addEventListener/);
  assert.match(app,/\$\("#archiveNext"\)\?\.addEventListener/);
  assert.match(html,/id="archivePager"/);
  assert.match(html,/id="archivePageInfo"/);
});


test('CRM agent alert is wired to the permanent installer',()=>{
  assert.match(html,/id="crmAgentAlert"/);
  assert.match(html,/INSTALLA_SYNC_CRM_AUTOMATICA\.bat/);
  assert.match(app,/const heartbeatFresh=heartbeatAge<=15/);
  assert.match(app,/const inactive=!heartbeatFresh\|\|heartbeatError/);
  assert.match(app,/Sincronizzazione CRM automatica non attiva/);
});


test('CRM heartbeat status is rendered from backend agent state',()=>{
  assert.match(html,/id="crmAgentHeartbeatText"/);
  assert.match(app,/const heartbeat=crm\.agent\|\|null/);
  assert.match(app,/heartbeatAge<=15/);
  assert.match(app,/crm\.companySync\?\.completed_at/);
});


test('PWA install and persistent auth are wired',()=>{
  assert.match(html,/rel="manifest" href="\.\/manifest\.json"/);
  assert.match(html,/id="installAppBtn"/);
  assert.match(app,/Auth\.Persistence\.LOCAL/);
  assert.match(app,/await authPersistence/);
  assert.match(app,/beforeinstallprompt/);
  assert.match(app,/appinstalled/);
});
