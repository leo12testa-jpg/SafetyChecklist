// Live API smoke: requires credentials of the explicitly marked test account.
const fs=require('node:fs');
const assert=require('node:assert/strict');
const path=require('node:path');const {spawnSync}=require('node:child_process');
const protectedFile=process.env.ORE_SMOKE_CREDENTIAL_FILE||path.join(process.env.USERPROFILE||process.env.HOME||'','.cache/ore-reports/test-tecnico-protected.json');
function configured(){return !!(process.env.ORE_SMOKE_PASSWORD&&process.env.ORE_SMOKE_FOREIGN_SESSION)||(process.platform==='win32'&&fs.existsSync(protectedFile));}
function localCredentials(){
 if(process.env.ORE_SMOKE_PASSWORD)return;
 assert.equal(process.platform,'win32','Supply GitHub secrets on non-Windows systems');
 const saved=JSON.parse(fs.readFileSync(protectedFile,'utf8'));
 const result=spawnSync('C:/windows/System32/WindowsPowerShell/v1.0/powershell.exe',['-NoProfile','-Command','Add-Type -AssemblyName System.Security; $value=[Console]::In.ReadToEnd(); [Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($value),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser))'],{input:saved.password_dpapi,encoding:'utf8'});
 assert.equal(result.status,0,'Cannot decrypt local test credentials');
 process.env.ORE_SMOKE_PASSWORD=result.stdout.trim();process.env.ORE_SMOKE_FOREIGN_SESSION=saved.foreignSession;
}
const API='https://twznfiygzzbqdgudpwav.supabase.co/functions/v1/ore-produttivita-api';
async function post(url,body,token){
 const response=await fetch(url,{method:'POST',headers:{'content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body),signal:AbortSignal.timeout(25000)});
 return {status:response.status,data:await response.json()};
}
function adminActions(source){
 const block=source.match(/const ACTION_ROLES[^=]*=\s*\{([\s\S]*?)\n\};/);assert.ok(block,'ACTION_ROLES missing');
 return [...block[1].matchAll(/(\w+):\s*\[([^\]]+)\]/g)].filter(m=>!m[2].includes('"tecnico"')).map(m=>m[1]);
}
async function run(){
 localCredentials();
 assert.ok(process.env.ORE_SMOKE_PASSWORD,'ORE_SMOKE_PASSWORD required');
 assert.ok(process.env.ORE_SMOKE_FOREIGN_SESSION,'ORE_SMOKE_FOREIGN_SESSION required');
 const auth=await post('https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=AIzaSyAdgCc8TQ1TVfF8l0NMxtm7NS95ZOl4lCA',{email:'test.tecnico@safetychecklist.local',password:process.env.ORE_SMOKE_PASSWORD,returnSecureToken:true});
 assert.equal(auth.status,200,'Test login failed');const token=auth.data.idToken;
 const me=await post(API,{action:'me'},token);assert.equal(me.status,200);assert.equal(me.data.profile.ruolo,'tecnico');assert.equal(me.data.profile.account_test,true,'Account must be explicitly marked as test');
 const actions=adminActions(fs.readFileSync('supabase/functions/ore-produttivita-api/index.ts','utf8'));
 for(const action of actions){const r=await post(API,{action,ruolo:'admin'},token);assert.equal(r.status,403,`${action}: expected 403`);console.log('PASS 403',action);}
 const foreign=await post(API,{action:'saveSession',id:process.env.ORE_SMOKE_FOREIGN_SESSION,minutiEffettivi:0,commessaId:'00000000-0000-0000-0000-000000000000'},token);
 // Invalid destination also prevents writes if authorization regresses.
 assert.equal(foreign.status,403,'Foreign session ownership');console.log('PASS 403 saveSession foreign');
 const all=await post(API,{action:'missingDays',scope:'all'},token);assert.equal(all.status,403);console.log('PASS 403 missingDays all');
 console.log(`LIVE PERMISSIONS PASSED: ${actions.length+2} checks`);
}
module.exports={adminActions,configured};
if(require.main===module){if(process.argv.includes('--check-config'))process.exitCode=configured()?0:1;else run().catch(error=>{console.error(error.message);process.exitCode=1;});}
