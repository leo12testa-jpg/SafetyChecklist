const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const app=fs.readFileSync('ore-produttivita/app.js','utf8');
function grab(name){
  const i=app.indexOf(`function ${name}(`);assert.ok(i>=0,`${name} mancante`);
  let depth=0,j=app.indexOf('{',i);
  for(let k=j;k<app.length;k++){if(app[k]==='{')depth++;if(app[k]==='}'){depth--;if(depth===0)return app.slice(i,k+1)}}
}
const ctx={};vm.createContext(ctx);
vm.runInContext(['class SafeHTML{constructor(v){this.v=String(v)}toString(){return this.v}}',grab('esc'),grab('raw'),grab('html'),grab('fmtMinutes'),grab('inputMinutes'),'this.r={esc,raw,html,inputMinutes}'].join('\n'),ctx);
const {esc,raw,html,inputMinutes}=ctx.r;

test('durate: formati comuni interpretati correttamente',()=>{
  const cases={'2h30m':150,'2h30':150,'1h30':90,'1h05':65,'2:30':150,'0:45':45,'1,5':90,'1.5':90,'2':120,'8':480,
    '1,5h':90,'0.25h':15,'90m':90,'45 min':45,'45min':45,'2 ore':120,'1 ora':60,'3h':180,'15':15,'90':90,'0':0};
  for(const [inp,exp] of Object.entries(cases))assert.equal(inputMinutes(inp),exp,`"${inp}"`);
});
test('durate: input non validi rifiutati, mai interpretati a caso',()=>{
  for(const inp of ['', 'abc','2h75','25:00','1h30x','-1','12,5,3','99999','2.5m'])assert.equal(inputMinutes(inp),null,`"${inp}"`);
});
test('regressione: "1h30" non perde più i 30 minuti',()=>assert.equal(inputMinutes('1h30'),90));
test('escaping: i testi del CRM non diventano HTML',()=>{
  const evil='<img src=x onerror=alert(1)> & "C"';
  assert.equal(String(html`<b>${evil}</b>`),'<b>&lt;img src=x onerror=alert(1)&gt; &amp; &quot;C&quot;</b>');
  assert.equal(String(html`<td>${raw('<br>')}</td>`),'<td><br></td>');
  assert.equal(String(html`<p>${html`<i>${'<x>'}</i>`}</p>`),'<p><i>&lt;x&gt;</i></p>','niente doppio escaping');
  assert.equal(esc(null),'');assert.equal(esc(0),'0');
});
test('nessun alert() bloccante e nessun innerHTML con template non protetto',()=>{
  assert.equal(/\balert\(/.test(app),false);
  assert.equal(/innerHTML=`/.test(app),false);
});
test('produttività per tipologia calcolata sullo storico completo della pratica',()=>{
  assert.match(app,/async function renderProductivity\(\)/);
  assert.equal(app.includes('for(const job of jobs.values()){\n      if(job.status!=="completata"'),false);
});
