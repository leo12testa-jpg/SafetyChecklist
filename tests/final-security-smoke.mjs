// Post-deploy negative checks only. Never creates accounts or writes production data.
import fs from 'node:fs';
import assert from 'node:assert/strict';
const config=fs.readFileSync('js/firebase-config.js','utf8');
const project=config.match(/projectId:\s*"([^"]+)"/)?.[1];
const endpoint=config.match(/USER_ADMIN_ENDPOINT\s*=\s*'([^']+)'/)?.[1];
assert.ok(project&&endpoint);
const response=await fetch(`https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents/sopralluoghi?pageSize=1`);
assert.equal(response.status,403,'Firestore must reject anonymous reads');
for(const token of [null,'invalid-token']){
  const r=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},body:JSON.stringify({action:'list'})});
  assert.ok([401,403].includes(r.status),'manage-users must reject absent/invalid Firebase sessions');
}
const storage=fs.readFileSync('js/supabase-config.js','utf8').match(/SUPABASE_URL\s*=\s*"([^"]+)"/)?.[1];
assert.ok(storage);
const now=Math.floor(Date.now()/1000);
const forged=[Buffer.from(JSON.stringify({alg:'RS256',typ:'JWT'})).toString('base64url'),Buffer.from(JSON.stringify({aud:project,iss:`https://securetoken.google.com/${project}`,sub:'qa-readonly-nonexistent',iat:now,exp:now+300})).toString('base64url'),'invalid-signature'].join('.');
for(const token of [null,'invalid-token',forged]){
  const r=await fetch(storage+'/functions/v1/photo-access?sopralluogo_id=qa-readonly-nonexistent&path=qa-readonly-nonexistent%2Fabsent.jpg',{headers:token?{authorization:'Bearer '+token}:{}});
  assert.ok([401,403].includes(r.status),'photo gateway must verify Firebase, not just trust JWT claims');
}
console.log('Read-only deployed negative checks passed; role/account creation tests run only in isolated QA.');
