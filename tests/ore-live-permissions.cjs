// Live API smoke: requires credentials of the explicitly marked test account.
const fs=require('node:fs');
const assert=require('node:assert/strict');
const API='https://twznfiygzzbqdgudpwav.supabase.co/functions/v1/ore-produttivita-api';
async function post(url,body,token){
 const response=await fetch(url,{method:'POST',headers:{'content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body),signal:AbortSignal.timeout(25000)});
 return {status:response.status,data:await response.json()};
}
function adminActions(source){
 const block=source.match(/const ACTION_ROLES[^=]*=\s*\{([\s\S]*?)\n\};/);assert.ok(block,'ACTION_ROLES missing');
 return [...block[1].matchAll(/(\w+):\s*\["admin"\]/g)].map(m=>m[1]);
}
async function run(){
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
module.exports={adminActions};
if(require.main===module)run().catch(error=>{console.error(error.message);process.exitCode=1;});
