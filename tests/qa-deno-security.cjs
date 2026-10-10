const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process'),assert=require('node:assert/strict');
const {root,project,authOrigin,documents,seed,put,makeServer}=require('./qa-support.cjs');
const out=path.join(root,'reports/qa-security');fs.mkdirSync(out,{recursive:true});
const report={runtime:'Deno real',storage:process.env.QA_REAL_STORAGE_URL?'Supabase local real':'isolated HTTP mock',tests:[]};
const server=makeServer({emulator:true}),children=[],users=[],paths=[];let storage,key,inspectionId,allowed,admin;
function deno(){if(process.env.DENO_BIN)return process.env.DENO_BIN;if(process.platform!=='win32')return'deno';const cache=path.join(process.env.LOCALAPPDATA,'npm-cache/_npx');for(const d of fs.readdirSync(cache)){const p=path.join(cache,d,'node_modules/deno/deno.exe');if(fs.existsSync(p))return p;}throw Error('Deno not installed');}
async function launch(file,port){const env={...process.env,FIREBASE_PROJECT_ID:project,FIREBASE_API_KEY:'qa-only',FIREBASE_AUTH_EMULATOR_HOST:'127.0.0.1:19099',FIRESTORE_EMULATOR_HOST:'127.0.0.1:18085',SUPABASE_URL:storage,SUPABASE_SERVICE_ROLE_KEY:key,PHOTO_ALLOWED_ORIGINS:server.origin,PORT:String(port),LISTEN_HOST:'127.0.0.1'};
  const hosts=['127.0.0.1:19099','127.0.0.1:18085',new URL(storage).host,'127.0.0.1:'+port];
  const child=spawn(deno(),['run','--allow-env','--allow-net='+hosts.join(','),file],{cwd:root,env,windowsHide:true});children.push(child);
  let errors='';child.stderr.on('data',d=>{errors+=d;});child.on('error',e=>{errors+=e.message;});
  const address='http://127.0.0.1:'+port;for(let n=0;n<100;n++){if(child.exitCode!==null)throw Error(errors);try{const r=await fetch(address,{method:'OPTIONS'});if(r.status===204)return address;}catch{}await new Promise(r=>setTimeout(r,100));}throw Error('Deno start timeout '+errors);
}
async function check(name,fn){try{await fn();report.tests.push({name,status:'PASS'});console.log('PASS '+name);}catch(e){report.tests.push({name,status:'FAIL',error:e.stack});console.error('FAIL '+name+' '+e.message);}fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(report,null,2));}
const objectUrl=p=>storage+'/storage/v1/object/foto-sopralluoghi/'+p;
const secretHeaders=()=>({authorization:'Bearer '+key,apikey:key,'content-type':'image/png','x-upsert':'false'});
(async()=>{
  await server.start();storage=process.env.QA_REAL_STORAGE_URL||server.origin;key=process.env.QA_REAL_STORAGE_KEY||'qa-service-only';assert.equal(new URL(storage).hostname,'127.0.0.1','Only local Storage is allowed');
  if(process.env.QA_REAL_STORAGE_URL){const r=await fetch(storage+'/storage/v1/bucket',{method:'POST',headers:{...secretHeaders(),'content-type':'application/json'},body:JSON.stringify({id:'foto-sopralluoghi',name:'foto-sopralluoghi',public:false})});assert.ok(r.ok||r.status===400,'Local bucket setup');}
  const suffix=Date.now().toString(36);admin=await seed('qa.security.admin.'+suffix,'admin');allowed=await seed('qa.security.allowed.'+suffix);const denied=await seed('qa.security.denied.'+suffix),inactive=await seed('qa.security.inactive.'+suffix);users.push(admin,allowed,denied,inactive);
  await put('utenti',inactive.uid,{...inactive,token:undefined,password:undefined,attivo:false});
  inspectionId='qa-security-'+suffix;const oldPath=inspectionId+'/17_20200101_legacy-photo.jpg';paths.push(oldPath);
  const original=fs.readFileSync(path.join(root,'reports/qa-v1/browser/qa-photo.png'));
  assert.ok((await fetch(objectUrl(oldPath),{method:'POST',headers:secretHeaders(),body:original})).ok);
  const record={id:inspectionId,checklist_id:'coin_sopralluogo',foto_accesso_uids:[allowed.uid],foto_url:{legacy:{path:oldPath,url:'https://legacy.invalid/public/unchanged.jpg'}}};await put('sopralluoghi',inspectionId,record);
  const photo=await launch('supabase/functions/photo-access/index.ts',18092),manage=await launch('supabase/functions/manage-users/index.ts',18091);
  const photoCall=(method,user,p=oldPath,body=undefined,extra={})=>fetch(photo+'?'+new URLSearchParams({sopralluogo_id:inspectionId,path:p,...extra}),{method,headers:{...(user?{authorization:'Bearer '+user.token}:{}),'content-type':'image/png'},body});
  const manageCall=(action,user,body={})=>fetch(manage,{method:'POST',headers:{...(user?{authorization:'Bearer '+user.token}:{}),'content-type':'application/json'},body:JSON.stringify({action,...body})});
  await check('existing legacy path remains readable byte-for-byte through authorized Deno gateway',async()=>{const r=await photoCall('GET',allowed);assert.equal(r.status,200);assert.deepEqual(Buffer.from(await r.arrayBuffer()),original);assert.equal(r.headers.get('cache-control'),'private, no-store');});
  for(const [label,user] of [['anonymous',null],['inactive',inactive],['unauthorized inspection',denied]])for(const method of ['GET','POST','DELETE'])await check(label+' denied '+method,async()=>{const r=await photoCall(method,user,oldPath,method==='POST'?original:undefined,{foto_id:'attempt'});assert.ok([401,403].includes(r.status));});
  await check('invalid Firebase token rejected',async()=>{assert.equal((await photoCall('GET',{token:'not-a-token'})).status,401);});
  await check('unreferenced path, other inspection prefix and traversal rejected',async()=>{for(const p of [inspectionId+'/unknown.jpg','other/17_image.jpg',inspectionId+'/../secret.jpg',inspectionId+'/%2e%2e-secret.jpg'])assert.ok([400,403].includes((await photoCall('GET',allowed,p)).status));});
  const uploadPath=inspectionId+'/17_immutable.jpg';paths.push(uploadPath);
  await check('authorized immutable upload and identical retry succeed',async()=>{for(let n=0;n<2;n++)assert.equal((await photoCall('POST',allowed,uploadPath,original,{foto_id:'immutable',domanda_id:'17'})).status,200);});
  await put('sopralluoghi',inspectionId,{...record,foto_url:{...record.foto_url,immutable:{path:uploadPath}}});
  await check('replacement/upsert cannot overwrite an existing photo',async()=>{const other=fs.readFileSync(path.join(root,'reports/qa-v1/pdf/carrefour-page-1.png'));assert.equal((await photoCall('POST',allowed,uploadPath,other,{foto_id:'immutable',domanda_id:'17'})).status,409);assert.equal((await fetch(photo,{method:'PUT',headers:{authorization:'Bearer '+allowed.token},body:other})).status,405);const r=await photoCall('GET',allowed,uploadPath);assert.deepEqual(Buffer.from(await r.arrayBuffer()),original);});
  await check('technician cannot remove the photo ACL by direct Firestore mutation',async()=>{const r=await fetch(documents+'/sopralluoghi/'+inspectionId+'?updateMask.fieldPaths=foto_accesso_uids&updateMask.fieldPaths=ultimo_aggiornamento_da_uid&updateMask.fieldPaths=ultimo_aggiornamento_da_username&updateMask.fieldPaths=ultimo_aggiornamento_da_nome',{method:'PATCH',headers:{authorization:'Bearer '+denied.token,'content-type':'application/json'},body:JSON.stringify({fields:{foto_accesso_uids:{arrayValue:{values:[{stringValue:denied.uid}]}},ultimo_aggiornamento_da_uid:{stringValue:denied.uid},ultimo_aggiornamento_da_username:{stringValue:denied.username},ultimo_aggiornamento_da_nome:{stringValue:denied.nome+' '+denied.cognome}}})});assert.equal(r.status,403);});
  await check('deactivation blocks an already issued token immediately',async()=>{await put('utenti',allowed.uid,{...allowed,token:undefined,password:undefined,attivo:false});assert.equal((await photoCall('GET',allowed)).status,403);await put('utenti',allowed.uid,{...allowed,token:undefined,password:undefined,attivo:true});});
  await check('authorized deletion and legacy object remain isolated',async()=>{assert.equal((await photoCall('DELETE',allowed,uploadPath)).status,200);assert.equal((await photoCall('GET',allowed,uploadPath)).status,404);assert.equal((await photoCall('GET',allowed)).status,200);});
  await check('direct anon access to Storage is denied for GET INSERT DELETE and replacement',async()=>{
    const anon=process.env.QA_REAL_STORAGE_ANON||'anon';const headers={authorization:'Bearer '+anon,apikey:anon,'content-type':'image/png','x-upsert':'true'};
    for(const [url,method,body] of [[objectUrl(oldPath),'GET',undefined],[objectUrl(inspectionId+'/anon.jpg'),'POST',original],[objectUrl(oldPath),'PUT',original],[storage+'/storage/v1/object/foto-sopralluoghi','DELETE',JSON.stringify({prefixes:[oldPath]})]]){
      const r=await fetch(url,{method,headers:method==='DELETE'?{...headers,'content-type':'application/json'}:headers,body});assert.ok(!r.ok,'Unauthorized direct Storage '+method+' succeeded');
    }
    assert.deepEqual(Buffer.from(await(await photoCall('GET',allowed)).arrayBuffer()),original);
  });
  await check('Deno manage-users authentication/admin authorization/error validation',async()=>{assert.equal((await manageCall('list',null)).status,401);assert.equal((await manageCall('list',allowed)).status,403);assert.equal((await manageCall('list',admin)).status,200);assert.equal((await manageCall('create',admin,{username:'invalid..name',password:'short'})).status,400);assert.equal((await manageCall('setActive',admin,{uid:admin.uid,active:false})).status,400);});
  let created;
  await check('Deno real creates an Auth account/profile and changes role/active state',async()=>{
    const username='qa.deno.created.'+suffix,r=await manageCall('create',admin,{username,nome:'QA',cognome:'Fittizio',ruolo:'tecnico',password:'QA-only!Fittizio2026'});assert.equal(r.status,200);created=(await r.json()).user;
    const login=await fetch(authOrigin+'/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=qa-only',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:username+'@safetychecklist.local',password:'QA-only!Fittizio2026',returnSecureToken:true})});assert.equal(login.status,200);created.token=(await login.json()).idToken;users.push(created);
    assert.equal((await manageCall('setRole',admin,{uid:created.uid,role:'admin'})).status,200);assert.equal((await manageCall('list',created)).status,200);
    assert.equal((await manageCall('setActive',admin,{uid:created.uid,active:false})).status,200);assert.equal((await manageCall('list',created)).status,403);assert.equal((await manageCall('setActive',admin,{uid:created.uid,active:true})).status,200);
    assert.equal((await manageCall('setRole',admin,{uid:created.uid,role:'tecnico'})).status,200);assert.equal((await manageCall('list',created)).status,403);
  });
})().catch(e=>{report.fatal=e.stack;console.error(e);process.exitCode=1;}).finally(async()=>{
  for(const child of children)child.kill();
  for(const p of paths)if(storage)await fetch(storage+'/storage/v1/object/foto-sopralluoghi',{method:'DELETE',headers:{...secretHeaders(),'content-type':'application/json'},body:JSON.stringify({prefixes:[p]})}).catch(()=>{});
  if(inspectionId)await fetch(documents+'/sopralluoghi/'+inspectionId,{method:'DELETE',headers:{authorization:'Bearer owner'}});
  for(const u of users){await fetch(documents+'/utenti/'+u.uid,{method:'DELETE',headers:{authorization:'Bearer owner'}});await fetch(authOrigin+'/identitytoolkit.googleapis.com/v1/accounts:delete?key=qa-only',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({idToken:u.token})});}
  server.storage.clear();server.close();report.cleaned=true;fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(report,null,2));if(report.tests.some(t=>t.status==='FAIL'))process.exitCode=1;
});
