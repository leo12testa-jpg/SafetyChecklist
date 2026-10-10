const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {root,documents,authOrigin,project}=require('./qa-support.cjs');
(async()=>{
  assert.ok(project.startsWith('demo-'));assert.ok(documents.startsWith('http://127.0.0.1:18085/'));
  const counts={};
  for(const collection of ['sopralluoghi','attivita','utilizzo_app','utenti']){
    const r=await fetch(`${documents}/${collection}?pageSize=1`,{headers:{authorization:'Bearer owner'}});assert.equal(r.status,200);
    counts[collection]=((await r.json()).documents||[]).length;assert.equal(counts[collection],0,collection+' not cleaned');
  }
  const response=await fetch(`${authOrigin}/identitytoolkit.googleapis.com/v1/projects/${project}/accounts:batchGet`,{headers:{authorization:'Bearer owner'}});assert.equal(response.status,200);
  counts.authUsers=((await response.json()).users||[]).length;assert.equal(counts.authUsers,0);
  const folder=path.join(root,'reports/qa-v1');
  for(const dir of ['browser','pwa'])assert.equal(fs.readdirSync(path.join(folder,dir)).filter(f=>f.startsWith('profile-')).length,0);
  const report={status:'PASS',verified:new Date().toISOString(),project,counts,browserProfilesRemaining:0,productionDataServices:'not used: demo configuration and local-only network guard'};
  fs.writeFileSync(path.join(folder,'cleanup.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
})().catch(e=>{console.error(e);process.exitCode=1;});
