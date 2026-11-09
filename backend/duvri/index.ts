// DUVRI intake API. No client files, corporate templates or secrets in this source.
// Intentionally fail-closed until a private document worker has been deployed.
const cfg = {
  project: Deno.env.get('SAFETYCHECKLIST_FIREBASE_PROJECT_ID') || 'safety-checklist-colligo',
  firebaseKey: Deno.env.get('SAFETYCHECKLIST_FIREBASE_API_KEY') || 'AIzaSyAdgCc8TQ1TVfF8l0NMxtm7NS95ZOl4lCA',
  url: Deno.env.get('SUPABASE_URL') || '',
  serviceKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '',
  enabled: Deno.env.get('DUVRI_INTAKE_ENABLED') === 'true',
  workerEndpoint: Deno.env.get('DUVRI_WORKER_ENDPOINT') || '',
  workerSigningKey: Deno.env.get('DUVRI_WORKER_HMAC_KEY') || '',
  origins: new Set((Deno.env.get('DUVRI_ALLOWED_ORIGINS') || 'https://leo12testa-jpg.github.io').split(','))
};
const BUCKET='colligo-duvri-private';
const fileTypes={docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pdf:'application/pdf',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  zip:'application/zip',png:'image/png',
  jpg:'image/jpeg',jpeg:'image/jpeg',txt:'text/plain',csv:'text/csv'};
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const MAX_FILE=15*1024*1024, MAX_TOTAL=45*1024*1024;
function fail(status,message){throw Object.assign(new Error(message),{status});}
function cors(req){
  const origin=req.headers.get('origin');
  return {'access-control-allow-origin':origin&&cfg.origins.has(origin)?origin:'',
    'access-control-allow-methods':'GET,POST,OPTIONS',
    'access-control-allow-headers':'authorization,content-type',
    'access-control-expose-headers':'x-duvri-sha256,content-disposition',
    'cache-control':'private,no-store','x-content-type-options':'nosniff',vary:'Origin'};
}
function reply(req,body,status=200){
  return new Response(JSON.stringify(body),{status,headers:{...cors(req),'content-type':'application/json'}});
}
function keyHeaders(add={}){
  return {authorization:'Bearer '+cfg.serviceKey,apikey:cfg.serviceKey,...add};
}
async function network(url,opts={}){
  return await fetch(url,{...opts,signal:AbortSignal.timeout(25000)});
}
function decode(v){
  if(!v)return null;
  if('mapValue' in v)return Object.fromEntries(Object.entries(v.mapValue.fields||{}).map(([k,x])=>[k,decode(x)]));
  if('arrayValue' in v)return (v.arrayValue.values||[]).map(decode);
  return v.stringValue??v.booleanValue??v.integerValue??v.timestampValue??null;
}
async function actor(req){
  const auth=req.headers.get('authorization')||'';
  if(!auth.startsWith('Bearer ')||auth.length>10000)fail(401,'Autenticazione richiesta');
  const jwt=auth.slice(7);
  let claims;
  try {
    const v=jwt.split('.')[1];
    claims=JSON.parse(atob(v.replace(/-/g,'+').replace(/_/g,'/')));
  }catch{fail(401,'Sessione non valida');}
  if(claims.aud!==cfg.project||claims.iss!=='https://securetoken.google.com/'+cfg.project||
     typeof claims.sub!=='string'||!claims.sub||!Number.isFinite(claims.exp)||
     !Number.isFinite(claims.iat)||claims.exp<=Date.now()/1000)fail(401,'Sessione non valida');
  // Claims above are ONLY an early rejection filter. Google verifies signature.
  const google=await network('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key='+encodeURIComponent(cfg.firebaseKey),{
    method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({idToken:jwt})});
  if(!google.ok)fail(google.status>=500?503:401,'Sessione non valida');
  const user=(await google.json()).users?.[0];
  if(!user?.localId||user.disabled||user.localId!==claims.sub||
     (user.validSince&&claims.iat<Number(user.validSince))||
     !/^[a-zA-Z0-9_-]{1,128}$/.test(user.localId))fail(401,'Utente non valido');
  const url='https://firestore.googleapis.com/v1/projects/'+cfg.project+
    '/databases/(default)/documents/utenti/'+encodeURIComponent(user.localId);
  const resp=await network(url,{headers:{authorization:'Bearer '+jwt}});
  if(!resp.ok)fail(resp.status>=500?503:403,'Profilo non autorizzato');
  const profile=decode({mapValue:{fields:(await resp.json()).fields}});
  if(profile?.uid!==user.localId||profile?.attivo!==true||
     !['admin','tecnico'].includes(profile?.ruolo))fail(403,'Utente non autorizzato');
  return user.localId;
}
async function sql(method,table,qs,body){
  const resp=await network(cfg.url+'/rest/v1/'+table+qs,{
    method,headers:keyHeaders({'content-type':'application/json','prefer':'return=representation'}),
    ...(body===undefined?{}:{body:JSON.stringify(body)})});
  if(!resp.ok)fail(503,'Archivio fascicoli indisponibile');
  return await resp.json();
}
function uuid(v){if(typeof v!=='string'||!UUID.test(v))fail(400,'Identificativo non valido');return v;}
function extension(name){
  if(typeof name!=='string'||!name||name.length>160||
     /[\x00-\x1f\\\/]/.test(name)||name.includes('..'))fail(400,'Nome documento non valido');
  const ext=name.split('.').pop().toLowerCase();
  if(!(ext in fileTypes))fail(415,'Formato allegato non supportato');
  return ext;
}
function validateManifest(files){
  if(!Array.isArray(files)||files.length<1||files.length>12)fail(400,'Numero file non valido');
  let total=0;
  const manifest=files.map((f,i)=>{
    if(!Number.isSafeInteger(f?.size)||f.size<1||f.size>MAX_FILE)fail(413,'File fuori limite');
    const ext=extension(f.name);total+=f.size;
    if(i===0&&ext!=='docx')fail(415,'La checklist deve essere in Word .docx');
    return {slot:i,name:f.name,size:f.size,extension:ext};
  });
  if(total>MAX_TOTAL)fail(413,'Fascicolo troppo grande');
  return manifest;
}
async function bounded(req,limit){
  const advertised=Number(req.headers.get('content-length')||0);
  if(advertised>limit)fail(413,'Dimensione superata');
  const reader=req.body?.getReader();
  if(!reader)fail(400,'File mancante');
  const chunks=[];let size=0;
  while(true){
    const {done,value}=await reader.read();if(done)break;
    size+=value.byteLength;
    if(size>limit){await reader.cancel();fail(413,'Dimensione superata');}
    chunks.push(value);
  }
  const bytes=new Uint8Array(size);let pos=0;
  for(const chunk of chunks){bytes.set(chunk,pos);pos+=chunk.length;}
  return bytes;
}
function magic(ext,b){
  if(b.length<4)return false;
  if(ext==='docx'||ext==='xlsx'||ext==='zip')return b[0]===80&&b[1]===75&&[3,5,7].includes(b[2]);
  if(ext==='pdf')return new TextDecoder().decode(b.slice(0,5))==='%PDF-';
  if(ext==='png')return [137,80,78,71,13,10,26,10].every((n,i)=>b[i]===n);
  if(ext==='jpg'||ext==='jpeg')return b[0]===255&&b[1]===216&&b[2]===255;
  return true;
}
function workerReady(){
  if(cfg.workerSigningKey.length<32) return false;
  try {
    const target=new URL(cfg.workerEndpoint);
    return target.protocol==='https:' && target.username==='' && target.password==='' &&
      target.pathname.endsWith('/api/process') && !target.hash && !target.search;
  } catch(_) { return false; }
}
async function notifyWorker(id){
  if(!workerReady())return false;
  const stamp=String(Math.floor(Date.now()/1000));
  const secret=await crypto.subtle.importKey('raw',
    new TextEncoder().encode(cfg.workerSigningKey),
    {name:'HMAC',hash:'SHA-256'},false,['sign']);
  const mac=await crypto.subtle.sign('HMAC',secret,
    new TextEncoder().encode(stamp+'.'+id));
  const signature=Array.from(new Uint8Array(mac),b=>b.toString(16).padStart(2,'0')).join('');
  const request=fetch(cfg.workerEndpoint,{
    method:'POST',redirect:'error',
    headers:{'content-type':'application/json','x-colligo-worker-timestamp':stamp,
      'x-colligo-worker-signature':signature},
    body:JSON.stringify({job_id:id}),signal:AbortSignal.timeout(140000)
  }).catch(()=>null);
  // Finish network work outside the short Firebase-authorized upload response.
  if(typeof EdgeRuntime!=='undefined' && typeof EdgeRuntime.waitUntil==='function'){
    EdgeRuntime.waitUntil(request);
  }else{ await request; }
  return true;
}

async function ensureBucket(){
  const url=cfg.url+'/storage/v1/bucket/'+BUCKET;
  const check=await network(url,{headers:keyHeaders()});
  if(check.ok){
    const info=await check.json();
    if(info.public!==false)fail(503,'Archivio non privato');
    return;
  }
  if(check.status!==404)fail(503,'Archivio privato non accessibile');
  const created=await network(cfg.url+'/storage/v1/bucket',{
    method:'POST',headers:keyHeaders({'content-type':'application/json'}),
    body:JSON.stringify({id:BUCKET,name:BUCKET,public:false,file_size_limit:MAX_FILE})});
  if(!created.ok&&created.status!==409)fail(503,'Impossibile preparare archivio privato');
  const verify=await network(url,{headers:keyHeaders()});
  if(!verify.ok||(await verify.json()).public!==false)fail(503,'Archivio non verificato');
}
async function owned(uid,id){
  const qs='?id=eq.'+encodeURIComponent(id)+'&owner_uid=eq.'+encodeURIComponent(uid)+
    '&select=id,state,manifest,result_path,result_sha256';
  const rows=await sql('GET','duvri_jobs',qs);
  if(!Array.isArray(rows)||rows.length!==1)fail(404,'Fascicolo non trovato');
  return rows[0];
}
async function upload(req,uid,id,slot){
  if(!/^(0|[1-9]|1[01])$/.test(slot||''))fail(400,'Allegato non previsto');
  const index=Number(slot),job=await owned(uid,id);
  if(job.state!=='collecting')fail(409,'Fascicolo già chiuso');
  const meta=job.manifest[index];
  if(!meta||meta.slot!==index)fail(400,'Allegato non previsto');
  const prev=await sql('GET','duvri_job_files','?job_id=eq.'+id+
    '&slot=eq.'+index+'&select=sha256');
  if(prev.length)fail(409,'Allegato già caricato');
  const bytes=await bounded(req,Math.min(MAX_FILE,meta.size));
  if(bytes.length!==meta.size||!magic(meta.extension,bytes))fail(422,'Contenuto o dimensione non valida');
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  const sha=Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join('');
  const objectPath=uid+'/'+id+'/'+index+'.'+meta.extension;
  const storage=await network(cfg.url+'/storage/v1/object/'+BUCKET+'/'+objectPath,{
    method:'POST',headers:keyHeaders({'content-type':fileTypes[meta.extension],'x-upsert':'false'}),body:bytes});
  if(!storage.ok)fail(storage.status===409?409:503,'Allegato non archiviato');
  await sql('POST','duvri_job_files','?select=slot',{
    job_id:id,slot:index,object_path:objectPath,length_bytes:bytes.length,sha256:sha});
  return {slot:index,received:true,sha256:sha};
}
async function handle(req){
  const origin=req.headers.get('origin');
  if(origin&&!cfg.origins.has(origin))return reply(req,{error:'Origine non autorizzata'},403);
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors(req)});
  try{
    if(!['POST','GET'].includes(req.method))fail(405,'Metodo non consentito');
    if(!cfg.url||!cfg.serviceKey||!cfg.enabled)fail(503,'Generatore cloud non ancora disponibile');
    const uid=await actor(req);
    const route=new URL(req.url),action=route.searchParams.get('action');
    if(req.method==='POST'&&action==='create'){
      const bytes=await bounded(req,8192);
      let data;try{data=JSON.parse(new TextDecoder().decode(bytes));}catch{fail(400,'Manifest non valido');}
      if(!workerReady())fail(503,'Compilatore Word online non ancora configurato');
      const manifest=validateManifest(data?.files),reqId=uuid(data?.request_id);
      await ensureBucket();
      const previous=await sql('GET','duvri_jobs','?owner_uid=eq.'+encodeURIComponent(uid)+
        '&request_id=eq.'+reqId+'&select=id,state,manifest');
      if(previous.length){
        if(JSON.stringify(previous[0].manifest)!==JSON.stringify(manifest))fail(409,'Richiesta duplicata con file differenti');
        return reply(req,{job:{id:previous[0].id,state:previous[0].state},word_generated:false,issuance_allowed:false});
      }
      const created=await sql('POST','duvri_jobs','?select=id,state',{
        owner_uid:uid,request_id:reqId,manifest,state:'collecting'});
      return reply(req,{job:{id:created[0].id,state:'collecting'},word_generated:false,issuance_allowed:false},201);
    }
    if(req.method==='GET'&&action==='list') {
      // Caller identity is server-verified; never enumerate other technicians' work.
      const recent=await sql('GET','duvri_jobs','?owner_uid=eq.'+
        encodeURIComponent(uid)+'&order=created_at.desc&limit=20&select=id,state,created_at,result_sha256');
      if(!Array.isArray(recent)||recent.length>20)fail(503,'Elenco fascicoli non valido');
      const jobs=recent.map(j=>({
        id:j.id,state:j.state,created_at:j.created_at,
        download_ready:j.state==='needs_review'&&typeof j.result_sha256==='string'&&
          /^[a-f0-9]{64}$/.test(j.result_sha256)
      }));
      return reply(req,{jobs,issuance_allowed:false});
    }
    const id=uuid(route.searchParams.get('job'));
    if(req.method==='POST'&&action==='upload')return reply(req,await upload(req,uid,id,route.searchParams.get('slot')),201);
    const job=await owned(uid,id);
    if(req.method==='POST'&&action==='finalize'){
      if(job.state!=='collecting')fail(409,'Fascicolo non modificabile');
      const rows=await sql('GET','duvri_job_files','?job_id=eq.'+id+'&select=slot,length_bytes');
      if(rows.length!==job.manifest.length||
         !rows.every(x=>job.manifest[x.slot]?.size===x.length_bytes))fail(409,'Allegati mancanti o non validi');
      const changed=await sql('PATCH','duvri_jobs','?id=eq.'+id+'&owner_uid=eq.'+
        encodeURIComponent(uid)+'&state=eq.collecting&select=id,state',
        {state:'awaiting_worker',updated_at:new Date().toISOString()});
      if(changed.length!==1)fail(409,'Fascicolo aggiornato da altro processo');
      // A signed, single-job trigger; the worker must atomically claim its job.
      // No corporate bytes or Firebase credentials are sent in this request.
      await notifyWorker(id);
      return reply(req,{job:{id,state:'awaiting_worker'},word_generated:false,issuance_allowed:false});
    }
    if(req.method==='GET'&&action==='status'){
      return reply(req,{job:{id,state:job.state},
        word_generated:job.state==='needs_review'&&!!job.result_path,
        download_ready:job.state==='needs_review'&&!!job.result_sha256,
        issuance_allowed:false});
    }
    if(req.method==='GET'&&action==='download'){
      // No signed/public URL, no cross-user access, no provisional file.
      const path=uid+'/'+id+'/draft.docx';
      if(job.state!=='needs_review'||job.result_path!==path||
         typeof job.result_sha256!=='string'||!/^[a-f0-9]{64}$/.test(job.result_sha256))
        fail(409,'Word non ancora disponibile per revisione');
      const url=cfg.url+'/storage/v1/object/authenticated/'+BUCKET+'/'+path;
      const blob=await network(url,{headers:keyHeaders()});
      if(!blob.ok)fail(503,'Word non accessibile');
      const bytes=new Uint8Array(await blob.arrayBuffer());
      if(bytes.length<100||bytes.length>MAX_FILE||bytes[0]!==80||bytes[1]!==75)
        fail(422,'Formato Word non valido');
      const digest=await crypto.subtle.digest('SHA-256',bytes);
      const sha=Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join('');
      if(sha!==job.result_sha256)fail(422,'Impronta Word non valida');
      return new Response(bytes,{status:200,headers:{...cors(req),
        'content-type':'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'content-disposition':'attachment; filename="DUVRI_BOZZA_NON_EMETTIBILE.docx"',
        'x-duvri-sha256':sha}});
    }
    fail(404,'Funzione non disponibile');
  }catch(error){
    return reply(req,{error:error?.status?error.message:'Servizio documentale non disponibile'},error?.status||503);
  }
}
Deno.serve(handle);
