const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {stripTypeScriptTypes}=require('node:module'),{webcrypto}=require('node:crypto');
const source=fs.readFileSync('supabase/functions/ore-produttivita-api/index.ts','utf8').replace(/^import .*;\n/,'');
test('Firebase: firma RSA, audience, issuer, scadenza e UID verificati',async()=>{
 const pair=await webcrypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
 const jwk=await webcrypto.subtle.exportKey('jwk',pair.publicKey);jwk.kid='test-key';
 const context=vm.createContext({crypto:webcrypto,atob,TextEncoder,TextDecoder,Uint8Array,Response,fetch:async()=>new Response(JSON.stringify({keys:[jwk]})),Deno:{serve(){}}});
 vm.runInContext(stripTypeScriptTypes(source,{mode:'transform'}),context);
 const now=Math.floor(Date.now()/1000),base={aud:'safety-checklist-colligo',iss:'https://securetoken.google.com/safety-checklist-colligo',iat:now-10,exp:now+60,sub:'u1'};
 const b64=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
 async function token(claims){const body=b64({alg:'RS256',kid:'test-key'})+'.'+b64(claims);const signature=await webcrypto.subtle.sign('RSASSA-PKCS1-v1_5',pair.privateKey,new TextEncoder().encode(body));return body+'.'+Buffer.from(signature).toString('base64url');}
 context.token=await token(base);assert.equal(await vm.runInContext('verifyFirebaseJwt(token)',context),'u1');
 for(const claims of [{...base,exp:now-1},{...base,aud:'altro-progetto'},{...base,iss:'https://attacker.example'},{...base,iat:now+600}]){context.token=await token(claims);await assert.rejects(vm.runInContext('verifyFirebaseJwt(token)',context),e=>e.status===401);}
 context.token=(await token(base)).split('.').slice(0,2).join('.')+'.'+Buffer.alloc(256).toString('base64url');await assert.rejects(vm.runInContext('verifyFirebaseJwt(token)',context),e=>e.status===401);
});
