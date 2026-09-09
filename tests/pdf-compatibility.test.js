const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function engine(overrides = {}, real = false) {
  const events = [];
  const logs = [];
  const link = { download: '', click: () => events.push('download') };
  const context = {
    console: { log() {}, warn: (...args)=>logs.push(args), error:(...args)=>logs.push(args) }, Blob, ArrayBuffer, Uint8Array,
    btoa: s => Buffer.from(s, 'binary').toString('base64'),
    atob: s => Buffer.from(s, 'base64').toString('binary'),
    navigator: {},
    URL: { createObjectURL: () => 'blob:test', revokeObjectURL: () => events.push('revoke') },
    document: { createElement: () => link, body: { appendChild: () => events.push('append') } },
    setTimeout: fn => { events.push(fn); return 1; }, clearTimeout() {},
    File: class {},
    ...overrides
  };
  context.window = context; context.self = context;
  vm.createContext(context);
  const load = file => vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context);
  if (real) { load('js/vendor/jspdf.umd.min.js'); load('js/vendor/jspdf.plugin.autotable.min.js'); }
  load('js/pdf.js');
  return { pdf: vm.runInContext('pdf', context), context, events, link, logs };
}

test('canShare without share: download works, URL is not revoked before click', async () => {
  const { pdf, events } = engine({ navigator: { canShare: () => true } });
  await pdf.salvaOCondividi(new Blob(['%PDF-']), 'report.pdf');
  assert.deepEqual(events.slice(0,2), ['append','download']);
  assert.ok(!events.includes('revoke'));
  events.filter(v => typeof v === 'function').forEach(fn=>fn());
  assert.ok(events.includes('revoke'));
});

for (const name of ['NotAllowedError','TypeError']) test(`share rejects ${name}: falls back to download`, async () => {
  const { pdf, events } = engine({ navigator: { canShare: () => true, share: async () => { throw { name }; } } });
  await pdf.salvaOCondividi(new Blob(['%PDF-']), 'report.pdf');
  assert.ok(events.includes('download'));
});

test('share cancellation does not cause an unwanted download', async () => {
  const { pdf, events } = engine({ navigator: { canShare: () => true, share: async () => { throw { name:'AbortError' }; } } });
  await pdf.salvaOCondividi(new Blob(), 'report.pdf');
  assert.equal(events.length, 0);
});

test('File absent and URL APIs absent: FileReader data URL download', async () => {
  const { pdf, link, events } = engine({ File: undefined, URL: {}, FileReader: class {
    readAsDataURL() { this.result = 'data:application/pdf;base64,JVBERi0='; this.onload(); }
  } });
  await pdf.salvaOCondividi(new Blob(['%PDF-']), 'report.pdf');
  assert.ok(events.includes('download'));
  assert.ok(link.href.startsWith('data:application/pdf'));
});

test('Blob.arrayBuffer absent: uses FileReader', async () => {
  const bytes = new Uint8Array([37,80,68,70,45]).buffer;
  const { pdf } = engine({ FileReader: class { readAsArrayBuffer() { this.result=bytes; this.onload(); } } });
  assert.equal(await pdf.leggiArrayBuffer({}), bytes);
});

test('window.open absent, nonfunction or throwing: no TypeError escapes', () => {
  for (const open of [undefined, true, () => { throw new Error('blocked'); }]) {
    assert.equal(engine({ open }).pdf.prenotaFinestra(), null);
  }
});

test('unavailable browser API logs its name and reports a readable error if no fallback exists', async () => {
  const { pdf, logs }=engine({ URL:{}, FileReader:undefined });
  await assert.rejects(pdf.scarica(new Blob(),'report.pdf'),/Metodo non disponibile: URL.createObjectURL \/ FileReader/);
  assert.ok(logs.some(args=>args[1].metodo==='URL.createObjectURL'));
  assert.equal(pdf.descriviErrore('aprire',new TypeError('navigator.share is not a function')),
    'Impossibile aprire il PDF su questo dispositivo. Metodo non disponibile: navigator.share.');
});

test('un errore dati .reduce non viene più presentato falsamente come API browser mancante', () => {
  const { pdf } = engine();
  assert.match(pdf.descriviErrore('aprire', new TypeError('sopralluogo.risposte.reduce is not a function')), /formato dati non compatibile/);
  assert.doesNotMatch(pdf.descriviErrore('aprire', new TypeError('sopralluogo.risposte.reduce is not a function')), /Metodo non disponibile/);
});

test('noncallable anchor click leaves a visible manual link without revoking its URL', async()=>{
  const {pdf,events,link}=engine();
  link.click=undefined;
  await pdf.scarica(new Blob(),'report.pdf');
  assert.deepEqual(events,['append']);
  assert.equal(link.href,'blob:test');
});

test('missing jsPDF and missing AutoTable report clear errors', async () => {
  await assert.rejects(engine().pdf.generaReport({},{}), /Motore PDF non disponibile/);
  await assert.rejects(engine({ jspdf: { jsPDF: function() {} } }).pdf.generaReport({},{}), /Modulo tabelle PDF non disponibile/);
});

function table(options) {
  const { context, pdf } = engine({}, true);
  const doc = new context.jspdf.jsPDF({ unit:'mm', format:'a4' });
  doc.text('PRECEDENTE', 15, 200);
  const section = { titolo:'NUOVA-SEZIONE', domande:options.notes.map((_,i)=>({ id:i+1, testo:`DOMANDA-${i+1}` })) };
  const inspection = { risposte:options.notes.map((note,i)=>({ domanda_id:i+1, risposta:'NC', note })) };
  pdf._test.disegnaTabellaSezione(doc,pdf._test.creaLayout(doc),section,inspection,options.y,new Map(),()=>{},options.group ? { titolo:'GRUPPO', configCliente:null } : null);
  return doc.internal.pages.slice(1).map(p=>p.join('\n'));
}

test('24mm remain: title + header + entire first row move to next page', () => {
  const pages = table({ y:258, notes:['Nota prima riga '.repeat(45)+'FINE-PRIMA'] });
  assert.equal(pages.length,2);
  assert.ok(!pages[0].includes('NUOVA-SEZIONE'));
  assert.ok(!pages[0].includes('(Note)'));
  for (const marker of ['NUOVA-SEZIONE','DOMANDA-1','FINE-PRIMA','(X)']) assert.ok(pages[1].includes(marker),marker);
});

test('3mm remain: group + title + header + first row stay together', () => {
  const pages=table({ y:279, notes:['FINE-PRIMA'], group:true });
  assert.equal(pages.length,2);
  assert.ok(!pages[0].includes('(GRUPPO)'));
  for (const marker of ['(GRUPPO)','NUOVA-SEZIONE','DOMANDA-1','FINE-PRIMA']) assert.ok(pages[1].includes(marker),marker);
});

test('first row near full-page height never leaves a header-only page after a group banner',()=>{
  for(let length=600;length<=1200;length+=10) {
    const pages=table({y:70,notes:['RIGA '.repeat(length)+' FINE'],group:true});
    for(const page of pages) if(page.includes('NUOVA-SEZIONE')) assert.ok(page.includes('RIGA') || page.includes('FINE'),`orphan header with ${length} words`);
  }
});

test('ordinary subsequent row moves intact, including note and state', () => {
  const pages=table({ y:220, notes:['BREVE', 'INIZIO-NOTA '+ 'Nota lunga '.repeat(100)+' FINE-NOTA'] });
  assert.equal(pages.length,2);
  assert.ok(pages[0].includes('DOMANDA-1'));
  assert.ok(!pages[0].includes('DOMANDA-2'));
  for (const marker of ['DOMANDA-2','INIZIO-NOTA','FINE-NOTA','(X)']) assert.ok(pages[1].includes(marker),marker);
});

test('row taller than a page continues without losing or duplicating note text', () => {
  const tokens=Array.from({ length:500 },(_,i)=>`TOKEN${String(i).padStart(4,'0')}`);
  const pages=table({ y:50, notes:[tokens.join(' ')] });
  assert.ok(pages.length > 2);
  const text=pages.join('\n');
  for (const token of tokens) assert.equal(text.split(token).length-1,1,token);
});

test('PWA update preserves pending PDF import on automatic and manual refresh', () => {
  const handlers={}; let reloads=0, alerts=0;
  const banner={ hidden:true }, button={ addEventListener:(name,fn)=>{handlers.click=fn;} };
  const context={
    anteprimaImportazionePendente:{ immagini:[{}] },
    document:{
      getElementById:id=>id==='banner-aggiornamento'?banner:id==='banner-aggiornamento-bottone'?button:null,
      querySelector:()=>({dataset:{screen:'home'}}), addEventListener(){}
    },
    navigator:{ serviceWorker:{ addEventListener:(name,fn)=>{handlers[name]=fn;} } },
    window:{addEventListener(){}}, location:{reload:()=>reloads++}, alert:()=>alerts++, console
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/aggiornamento.js'),'utf8')+';aggiornamentoApp.init();',context);
  handlers.controllerchange(); handlers.click();
  assert.equal(reloads,0); assert.equal(alerts,1); assert.equal(banner.hidden,false);
  context.anteprimaImportazionePendente=null;
  handlers.click(); assert.equal(reloads,1);
});

test('compatibilità mobile legacy: il codice applicativo non richiede Array.prototype.flatMap', () => {
  for (const file of ['js/app.js','js/pdf.js','js/foto-sync.js','js/import-matching.js','js/pdf-import.js']) {
    const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    assert.doesNotMatch(source, /\.flatMap\s*\(/, `${file} non deve dipendere da flatMap`);
  }
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const posizioneReduce = html.indexOf("if (!Array.prototype.reduce)");
  const posizioneFlat = html.indexOf("if (!Array.prototype.flat)");
  const posizioneFlatMap = html.indexOf("if (!Array.prototype.flatMap)");
  const posizionePrimaLibreria = html.indexOf('js/vendor/jspdf.umd.min.js');
  assert.ok(posizioneReduce >= 0 && posizioneReduce < posizionePrimaLibreria, 'polyfill reduce deve caricarsi prima delle librerie');
  assert.ok(posizioneFlat >= 0 && posizioneFlat < posizionePrimaLibreria, 'polyfill flat deve caricarsi prima delle librerie');
  assert.ok(posizioneFlatMap >= 0 && posizioneFlatMap < posizionePrimaLibreria, 'polyfill flatMap deve caricarsi prima delle librerie');
  assert.ok(posizioneReduce < posizioneFlatMap, 'reduce deve essere disponibile prima di flatMap');
});

test('barra domande: quelle senza risposta hanno un indicatore rosso dedicato', () => {
  const appSource = fs.readFileSync(path.join(__dirname, '..', 'js/app.js'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '..', 'css/style.css'), 'utf8');
  assert.match(appSource, /is-incomplete/);
  assert.match(css, /\.progress-marker\.is-incomplete/);
  assert.match(css, /#d90429/);
});
