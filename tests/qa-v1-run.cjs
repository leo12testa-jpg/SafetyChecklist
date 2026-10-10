// Run under `firebase emulators:exec` with firebase.qa.json and demo-safety-qa-v1.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');process.chdir(root);
const out=path.join(root,'reports/qa-v1');fs.mkdirSync(out,{recursive:true});
const report={started:new Date().toISOString(),baseCommit:'aa67eec93768168cc72cb8c9126bf07bcc08963e',build:JSON.parse(fs.readFileSync('version.json','utf8')).buildId,groups:[],notExecutable:[
  {name:'Safari/iOS e WebKit reali, fotocamera fisica e installazione su telefono',reason:'Nessun dispositivo fisico; WebKit non installato. Desktop/tablet/smartphone verificati con Chromium.'},
]};
function record(name,fn){try{fn();report.groups.push({name,total:1,pass:1,fail:0});console.log('PASS '+name);}catch(e){report.groups.push({name,total:1,pass:0,fail:1,error:e.stack});console.error('FAIL '+name+' '+e.message);}}
record('sintassi JavaScript SafetyChecklist',()=>{
  for(const file of [...fs.readdirSync('js').filter(f=>f.endsWith('.js')).map(f=>'js/'+f),'service-worker.js']){
    const r=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});assert.equal(r.status,0,file+' '+r.stderr);
  }
});
record('manifest, checklist, loghi e build coerenti',()=>{
  const manifest=JSON.parse(fs.readFileSync('checklists/index.json','utf8')),ids=new Set();
  for(const entry of manifest.checklists){const cl=JSON.parse(fs.readFileSync('checklists/'+entry.id+'.json','utf8'));assert.equal(cl.id,entry.id);assert.equal(cl.versione,entry.versione);assert.ok(!ids.has(cl.id));ids.add(cl.id);const questions=cl.sezioni.flatMap(s=>s.domande).map(q=>String(q.id));assert.equal(new Set(questions).size,questions.length);}
  for(const logo of ['logo_coin.webp','logo_interparking.webp','logo_restage.png','logo_melluso.png','logo_carrefour.png'])assert.ok(fs.statSync('assets/'+logo).size>0);
  for(const file of ['index.html','service-worker.js','js/aggiornamento.js'])assert.ok(fs.readFileSync(file,'utf8').includes(report.build),file);
  assert.ok(!spawnSync('git',['diff','--name-only','origin/main'],{encoding:'utf8'}).stdout.split(/\r?\n/).some(f=>f.startsWith('ore-produttivita/')||f.startsWith('supabase/functions/ore-')||f.startsWith('tests/ore-')));
});
const files=fs.readdirSync('tests').filter(f=>f.endsWith('.test.js')&&!f.startsWith('ore-')).map(f=>'tests/'+f);
console.log('Running '+files.length+' SafetyChecklist unit/regression files');
const unit=spawnSync(process.execPath,['--test','--test-reporter=tap',...files],{encoding:'utf8',maxBuffer:20*1024*1024});
fs.writeFileSync(path.join(out,'unit-final.tap'),unit.stdout+unit.stderr);
const value=field=>Number(new RegExp('# '+field+' (\\d+)').exec(unit.stdout)?.[1]||0);
report.groups.push({name:'regressioni unitarie SafetyChecklist',total:value('tests'),pass:value('pass'),fail:value('fail'),skipped:value('skipped'),exit:unit.status});
console.log('Unit: '+value('pass')+'/'+value('tests')+' passed');
const scenarios=[['qa-pdf-browser.cjs','pdf'],['qa-browser.cjs','browser'],['qa-pwa.cjs','pwa']];
for(const [script,folder] of scenarios){
  console.log('Running '+script);const r=spawnSync(process.execPath,['tests/'+script],{encoding:'utf8',maxBuffer:10*1024*1024});
  fs.writeFileSync(path.join(out,folder+'-final.log'),r.stdout+r.stderr);
  const result=JSON.parse(fs.readFileSync(path.join(out,folder,'results.json'),'utf8'));
  const tests=result.tests||[];report.groups.push({name:folder,total:tests.length,pass:tests.filter(t=>t.status==='PASS').length,fail:tests.filter(t=>t.status==='FAIL').length,exit:r.status,fatal:result.fatal||null,cleaned:result.cleaned});
  console.log(folder+': '+tests.filter(t=>t.status==='PASS').length+'/'+tests.length+' passed');
}
if(process.env.QA_CROSS_BROWSER==='1')for(const engine of ['firefox','webkit']){
  const r=spawnSync(process.execPath,['tests/qa-browser.cjs'],{encoding:'utf8',env:{...process.env,QA_BROWSER:engine},maxBuffer:10*1024*1024});
  fs.writeFileSync(path.join(out,engine+'-final.log'),r.stdout+r.stderr);
  const result=JSON.parse(fs.readFileSync(path.join(out,'browser-'+engine,'results.json'),'utf8')),tests=result.tests||[];
  report.groups.push({name:engine,total:tests.length,pass:tests.filter(t=>t.status==='PASS').length,fail:tests.filter(t=>t.status==='FAIL').length,exit:r.status,fatal:result.fatal||null});
}
const historical=spawnSync(process.execPath,['tests/qa-historical-pdf.cjs'],{encoding:'utf8',maxBuffer:10*1024*1024});
const historyResult=JSON.parse(fs.readFileSync('reports/qa-historical/results.json','utf8')),historyTests=historyResult.tests||[];
report.groups.push({name:'historical PDF',total:historyTests.length,pass:historyTests.filter(t=>t.status==='PASS').length,fail:historyTests.filter(t=>t.status==='FAIL').length,exit:historical.status});
const cleanup=spawnSync(process.execPath,['tests/qa-cleanup-audit.cjs'],{encoding:'utf8'});
if(cleanup.status!==0){console.error(cleanup.stderr);process.exitCode=1;report.cleanupError=cleanup.stderr;}
else report.cleanup=JSON.parse(cleanup.stdout.trim());
report.total=report.groups.reduce((n,g)=>n+g.total,0);report.passed=report.groups.reduce((n,g)=>n+g.pass,0);report.failed=report.groups.reduce((n,g)=>n+g.fail,0);
report.verdict='CANDIDATA — richiede anche il gate Storage/Deno';report.reason='Firma grafica esclusa dai requisiti V1.0; nessun merge o deploy autorizzato.';report.finished=new Date().toISOString();
fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({total:report.total,passed:report.passed,failed:report.failed,notExecutable:report.notExecutable.length,verdict:report.verdict}));
if(report.failed||report.groups.some(g=>g.exit!=null&&g.exit!==0))process.exitCode=1;
