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
console.log('Read-only deployed negative checks passed; role/account creation tests run only in isolated QA.');
