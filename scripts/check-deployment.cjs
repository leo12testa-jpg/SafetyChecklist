// Read-only verification of Pages assets. No login, account creation or production data requests.
const fs=require('node:fs'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const base='https://leo12testa-jpg.github.io/SafetyChecklist/',local=JSON.parse(fs.readFileSync('version.json'));
(async()=>{
  const response=await fetch(base+'version.json?t='+Date.now(),{cache:'no-store'});assert.equal(response.status,200);const live=await response.json();assert.equal(live.buildId,local.buildId,'Pages build differs from candidate');
  const html=await(await fetch(base+'?t='+Date.now(),{cache:'no-store'})).text();assert.ok(html.includes(local.buildId));assert.ok(html.includes('riepilogo-dvr'));
  for(const asset of ['service-worker.js','js/aggiornamento.js','js/app.js']){const r=await fetch(base+asset+'?t='+Date.now(),{cache:'no-store'});assert.equal(r.status,200,asset);assert.equal(await r.text(),execFileSync('git',['show','HEAD:'+asset],{encoding:'utf8'}),asset+' bytes differ');}
  console.log(JSON.stringify({url:base,version:live.version||null,build:live.buildId,assets:'exact match'}));
})().catch(e=>{console.error(e.message);process.exitCode=1;});
