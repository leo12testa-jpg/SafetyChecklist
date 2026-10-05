// Run once with ORE_ADMIN_TOKEN and ORE_SMOKE_PASSWORD supplied securely.
// Never prints credentials; never creates real technician accounts.
const assert=require('node:assert/strict');
async function main(){
 assert.ok(process.env.ORE_ADMIN_TOKEN,'An authenticated admin token is required');
 assert.ok(process.env.ORE_SMOKE_PASSWORD?.length>=12,'Test password must have at least 12 characters');
 const response=await fetch('https://twznfiygzzbqdgudpwav.supabase.co/functions/v1/manage-users',{method:'POST',headers:{authorization:`Bearer ${process.env.ORE_ADMIN_TOKEN}`,'content-type':'application/json'},body:JSON.stringify({action:'create',username:'test.tecnico',nome:'TEST',cognome:'Tecnico — smoke API',ruolo:'tecnico',accountTest:true,password:process.env.ORE_SMOKE_PASSWORD}),signal:AbortSignal.timeout(25000)});
 const data=await response.json();assert.equal(response.status,200,data.error||'Account creation failed');assert.equal(data.user.account_test,true);
 console.log('Created test.tecnico, role tecnico, account_test=true. UID:',data.user.uid);
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
