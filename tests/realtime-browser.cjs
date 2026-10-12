// Current authenticated replacement for the pre-login anonymous Storage harness.
// Run under firebase emulators:exec using firebase.qa.json. Never use production.
if(process.env.LIVE||process.env.REAL_CLOUD)throw Error('Production QA is forbidden: use the dedicated demo emulators');
const {spawnSync}=require('node:child_process');
const result=spawnSync(process.execPath,[require.resolve('./qa-browser.cjs')],{
  stdio:'inherit',env:{...process.env,QA_DEVICE_MATRIX:'chromium,firefox,webkit'}
});
process.exitCode=result.status??1;
