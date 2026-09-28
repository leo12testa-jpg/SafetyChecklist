import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';

const firebaseConfig = fs.readFileSync('js/firebase-config.js', 'utf8');
const apiKey = firebaseConfig.match(/apiKey:\s*"([^"]+)"/)?.[1];
const projectId = firebaseConfig.match(/projectId:\s*"([^"]+)"/)?.[1];
const adminEndpoint = firebaseConfig.match(/USER_ADMIN_ENDPOINT\s*=\s*'([^']+)'/)?.[1];
assert.ok(apiKey && projectId && adminEndpoint, 'Configurazione Firebase/admin endpoint non trovata');

const firestore = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/sopralluoghi?pageSize=1`;
const unauth = await fetch(firestore);
assert.equal(unauth.status, 403, 'Firestore deve rifiutare letture anonime');

const adminNoToken = await fetch(adminEndpoint, {
  method:'POST',
  headers:{'content-type':'application/json'},
  body:JSON.stringify({action:'list'})
});
assert.ok([401,403].includes(adminNoToken.status), 'manage-users deve rifiutare richieste senza token');

const stamp = Date.now();
const email = `final-smoke-${stamp}@safetychecklist.local`;
const password = `Tmp!${crypto.randomUUID()}Aa9`;
let token = null;
try {
  const signup = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${apiKey}`, {
    method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify({email,password,returnSecureToken:true})
  });
  const signupBody = await signup.json().catch(() => ({}));
  assert.equal(signup.status, 200, 'Creazione account Auth temporaneo fallita: ' + JSON.stringify(signupBody));
  token = signupBody.idToken;
  assert.ok(token, 'Token temporaneo mancante');

  // Un account Firebase creato fuori dall'area admin non ha profilo utenti/{uid} attivo:
  // le rules devono impedirgli di leggere i sopralluoghi.
  const rogueRead = await fetch(firestore, { headers:{ authorization:`Bearer ${token}` } });
  assert.equal(rogueRead.status, 403, 'Account Auth senza profilo attivo non deve leggere Firestore');

  const rogueAdmin = await fetch(adminEndpoint, {
    method:'POST',
    headers:{'content-type':'application/json', authorization:`Bearer ${token}`},
    body:JSON.stringify({action:'list'})
  });
  assert.equal(rogueAdmin.status, 403, 'Account non admin non deve usare manage-users');
} finally {
  if (token) {
    const deleted = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:delete?key=${apiKey}`, {
      method:'POST',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({idToken:token})
    });
    assert.equal(deleted.status, 200, 'Pulizia account temporaneo fallita');
  }
}
console.log('FINAL SECURITY SMOKE PASS');
