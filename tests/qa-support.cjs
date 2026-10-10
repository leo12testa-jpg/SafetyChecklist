// Dedicated demo namespace + local-only HTTP server. Never use production configuration.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),vm=require('node:vm');
const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const project='demo-safety-qa-v1';
const authOrigin='http://127.0.0.1:19099';
const firestoreOrigin='http://127.0.0.1:18085';
const documents=`${firestoreOrigin}/v1/projects/${project}/databases/(default)/documents`;
function playwright() {
  if(process.env.PLAYWRIGHT_MODULE)return require(process.env.PLAYWRIGHT_MODULE);
  try{return require('playwright');}catch{}
  const cache=path.join(process.env.LOCALAPPDATA||'','npm-cache/_npx');
  const paths=fs.readdirSync(cache).map(d=>path.join(cache,d,'node_modules/playwright')).filter(p=>fs.existsSync(path.join(p,'package.json')));
  paths.sort((a,b)=>require(path.join(b,'package.json')).version.localeCompare(require(path.join(a,'package.json')).version,undefined,{numeric:true}));
  assert.ok(paths.length,'Playwright required');return require(paths[0]);
}
function fields(record) {
  const value=v=>v===null?{nullValue:null}:Array.isArray(v)?{arrayValue:{values:v.map(value)}}:typeof v==='object'?{mapValue:{fields:fields(v)}}:typeof v==='boolean'?{booleanValue:v}:typeof v==='number'?{integerValue:String(v)}:{stringValue:String(v)};
  return Object.fromEntries(Object.entries(record).filter(([,v])=>v!==undefined).map(([k,v])=>[k,value(v)]));
}
async function put(collection,id,record,token='owner') {
  const r=await fetch(`${documents}/${collection}/${id}`,{method:'PATCH',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({fields:fields(record)})});
  assert.equal(r.status,200,await r.text());
}
async function seed(username,role='tecnico') {
  const password='QA-only!Fittizio2026';
  const r=await fetch(`${authOrigin}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=qa-only`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:`${username}@safetychecklist.local`,password,returnSecureToken:true})});
  const data=await r.json();assert.equal(r.status,200,JSON.stringify(data));
  const profile={uid:data.localId,username,nome:'QA',cognome:username,ruolo:role,attivo:true};
  await put('utenti',profile.uid,profile);
  return {...profile,password,token:data.idToken};
}
function edgeHandler() {
  let handler;
  const source=fs.readFileSync(path.join(root,'supabase/functions/manage-users/index.ts'),'utf8').replace('"safety-checklist-colligo"',`"${project}"`);
  const translated=require('node:module').stripTypeScriptTypes(source);
  const guardedFetch=(input,opts)=>{
    let url=String(input);
    if(url.startsWith('https://identitytoolkit.googleapis.com/'))url=url.replace('https://identitytoolkit.googleapis.com',authOrigin+'/identitytoolkit.googleapis.com');
    else if(url.startsWith('https://firestore.googleapis.com/'))url=url.replace('https://firestore.googleapis.com',firestoreOrigin).replace('projects/safety-checklist-colligo/','projects/'+project+'/');
    else throw new Error('QA guard: unexpected outbound request');
    return fetch(url,opts);
  };
  vm.runInNewContext(translated,{Deno:{serve:(opts,h)=>{handler=h||opts;}},Request,Response,fetch:guardedFetch,console,URL,URLSearchParams},{filename:'manage-users.test.js'});
  return handler;
}
function makeServer({emulator=false}={}) {
  const edge=emulator?edgeHandler():null;
  let photoHandler;
  const storage=new Map();let storageDown=false,endpointDown=false,serverDown=false;
  const server=http.createServer(async(req,res)=>{
    try {
      if(serverDown)return req.socket.destroy();
      const u=new URL(req.url,'http://127.0.0.1');
      if(u.pathname==='/qa/manage-users') {
        if(endpointDown){res.writeHead(503,{'content-type':'application/json'});return res.end('{"error":"QA outage"}');}
        let body='';for await(const data of req)body+=data;
        const request=new Request('http://127.0.0.1/qa/manage-users',{method:req.method,headers:req.headers,body:['GET','HEAD'].includes(req.method)?undefined:body});
        const response=process.env.QA_DENO_MANAGE_URL ? await fetch(process.env.QA_DENO_MANAGE_URL,{method:request.method,headers:request.headers,body}) : await edge(request);
        res.writeHead(response.status,Object.fromEntries(response.headers));return res.end(await response.text());
      }
      if(u.pathname==='/functions/v1/photo-access'){
        const chunks=[];for await(const data of req)chunks.push(data);const body=Buffer.concat(chunks);
        if(!photoHandler){
          const env={FIREBASE_PROJECT_ID:project,FIREBASE_API_KEY:'qa-only',FIREBASE_AUTH_EMULATOR_HOST:'127.0.0.1:19099',FIRESTORE_EMULATOR_HOST:'127.0.0.1:18085',SUPABASE_URL:server.origin,SUPABASE_SERVICE_ROLE_KEY:'qa-service-only',PHOTO_ALLOWED_ORIGINS:server.origin};
          const source=require('node:module').stripTypeScriptTypes(fs.readFileSync(path.join(root,'supabase/functions/photo-access/index.ts'),'utf8'));
          const localFetch=(url,opts)=>{assert.ok(String(url).startsWith(server.origin+'/')||String(url).startsWith(authOrigin+'/')||String(url).startsWith(firestoreOrigin+'/'),'No production access');return fetch(url,opts);};
          vm.runInNewContext(source,{Deno:{env:{get:k=>env[k]},serve:(_opts,h)=>{photoHandler=h;}},fetch:localFetch,Request,Response,URL,URLSearchParams,AbortSignal,Uint8Array,atob,console});
        }
        const method=req.method,request=new Request(server.origin+req.url,{method,headers:req.headers,body:['GET','DELETE','HEAD'].includes(method)?undefined:body});
        const response=process.env.QA_DENO_PHOTO_URL ? await fetch(process.env.QA_DENO_PHOTO_URL+u.search,{method,headers:req.headers,body:['GET','DELETE','HEAD'].includes(method)?undefined:body}) : await photoHandler(request);
        res.writeHead(response.status,Object.fromEntries(response.headers));return res.end(Buffer.from(await response.arrayBuffer()));
      }
      if(u.pathname.startsWith('/storage/v1/')) {
        if(req.headers.authorization!=='Bearer qa-service-only'){res.writeHead(403,{'content-type':'application/json'});return res.end('{"error":"Storage access denied"}');}
        if(storageDown){res.writeHead(503);return res.end('QA storage outage');}
        const match=u.pathname.match(/^\/storage\/v1\/object\/(?:authenticated\/|public\/)?([^/]+)\/(.+)$/);
        if(req.method==='DELETE') {let body='';for await(const d of req)body+=d;for(const key of JSON.parse(body||'{}').prefixes||[])storage.delete(u.pathname.split('/').pop()+'/'+key);res.setHeader('content-type','application/json');return res.end('[]');}
        if(!match){res.writeHead(404);return res.end();}
        const key=match[1]+'/'+decodeURIComponent(match[2]);
        if(['POST','PUT'].includes(req.method)) {
          if(storage.has(key)){res.writeHead(409,{'content-type':'application/json'});return res.end('{"statusCode":"409","error":"Duplicate"}');}
          const chunks=[];for await(const d of req)chunks.push(d);let buffer=Buffer.concat(chunks);
          const boundary=/boundary=([^;]+)/.exec(req.headers['content-type']||'')?.[1];
          if(boundary)for(const part of buffer.toString('latin1').split('--'+boundary)){const i=part.indexOf('\r\n\r\n');if(i>=0&&/content-type:\s*image\//i.test(part.slice(0,i)))buffer=Buffer.from(part.slice(i+4).replace(/\r\n$/,''),'latin1');}
          storage.set(key,buffer);res.setHeader('content-type','application/json');return res.end(JSON.stringify({Key:key}));
        }
        if(!storage.has(key)){res.writeHead(404);return res.end();}
        res.setHeader('content-type','image/jpeg');return res.end(storage.get(key));
      }
      const rel=u.pathname.replace(/^\/SafetyChecklist\//,'/').slice(1)||'index.html';
      const file=path.resolve(root,rel);
      if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||fs.statSync(file).isDirectory()){res.writeHead(404);return res.end();}
      let body=fs.readFileSync(file);
      if(emulator&&rel==='js/firebase-config.js')body=body.toString().replace(/projectId: "[^"]+"/,`projectId: "${project}"`).replace(/const USER_ADMIN_ENDPOINT = '[^']+'/,`const USER_ADMIN_ENDPOINT = '${server.origin}/qa/manage-users'`)+`
        firebaseClient.initApp(); firebase.auth().useEmulator('${authOrigin}',{disableWarnings:true});
        firebase.firestore().useEmulator('127.0.0.1',18085);
      `;
      if(emulator&&rel==='js/supabase-config.js')body=body.toString().replace(/const SUPABASE_URL = "[^"]+"/,`const SUPABASE_URL = "${server.origin}"`);
      if(!emulator&&rel==='index.html')body=require('./pdf-local-server.cjs').harness();
      if(server.build){
        if(rel==='index.html'||rel==='service-worker.js'||rel==='js/aggiornamento.js')body=body.toString().replaceAll(JSON.parse(fs.readFileSync(path.join(root,'version.json'),'utf8')).buildId,server.build);
        if(rel==='version.json')body=JSON.stringify({buildId:server.build});
      }
      res.setHeader('content-type',({'.js':'text/javascript','.html':'text/html; charset=utf-8','.css':'text/css','.json':'application/json','.png':'image/png','.webp':'image/webp','.pdf':'application/pdf'})[path.extname(file)]||'application/octet-stream');
      res.setHeader('cache-control','no-store');res.end(body);
    } catch(error){res.writeHead(500);res.end(error.stack);}
  });
  server.storage=storage;server.storageDown=v=>{storageDown=v;};server.endpointDown=v=>{endpointDown=v;};server.serverDown=v=>{serverDown=v;};
  server.start=async()=>{await new Promise(r=>server.listen(Number(process.env.QA_STORAGE_PORT||0),'127.0.0.1',r));server.origin=`http://127.0.0.1:${server.address().port}`;return server.origin+'/SafetyChecklist/';};
  return server;
}
async function guard(context,origin,{emulator=false}={}) {
  const blocked=[];
  await context.route('**/*',route=>{
    const url=route.request().url();
    if(url.startsWith(origin+'/')||/^(blob:|data:)/.test(url)||(emulator&&(url.startsWith(authOrigin+'/')||url.startsWith(firestoreOrigin+'/'))))return route.continue();
    blocked.push(url);return route.abort();
  });return blocked;
}
module.exports={root,project,authOrigin,firestoreOrigin,documents,playwright,seed,put,fields,makeServer,guard};
