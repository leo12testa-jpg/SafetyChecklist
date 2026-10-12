// Current update contract: actual previous main, protected editing screens,
// complete-cache gating, crash/offline recovery and persisted fake photos.
// Run under firebase emulators:exec using firebase.qa.json.
const {spawnSync}=require('node:child_process');
for(const name of ['qa-upgrade-browser.cjs','qa-pwa.cjs']){
  const result=spawnSync(process.execPath,[require.resolve('./'+name)],{stdio:'inherit'});
  if(result.status!==0){process.exitCode=result.status??1;break;}
}
