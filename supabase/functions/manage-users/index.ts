const AUTH_EMULATOR = Deno.env?.get('FIREBASE_AUTH_EMULATOR_HOST');
const DB_EMULATOR = Deno.env?.get('FIRESTORE_EMULATOR_HOST');
// Preserve the already-published telemetry tables and access history. No migration.
const SUPABASE_URL_ENV = Deno.env?.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env?.get('SUPABASE_SERVICE_ROLE_KEY') || '';
// App-scoped configuration must not inherit Firebase settings for another app
// sharing this Supabase project. Generic names are accepted only in demo emulators.
const FIREBASE_API_KEY = Deno.env?.get('SAFETYCHECKLIST_FIREBASE_API_KEY') || (AUTH_EMULATOR ? Deno.env?.get('FIREBASE_API_KEY') : null) || "AIzaSyAdgCc8TQ1TVfF8l0NMxtm7NS95ZOl4lCA";
const FIREBASE_PROJECT_ID = Deno.env?.get('SAFETYCHECKLIST_FIREBASE_PROJECT_ID') || (AUTH_EMULATOR || DB_EMULATOR ? Deno.env?.get('FIREBASE_PROJECT_ID') : null) || "safety-checklist-colligo";
if ((AUTH_EMULATOR || DB_EMULATOR) && !FIREBASE_PROJECT_ID.startsWith('demo-')) throw new Error('Emulators require a demo project');
const FIREBASE_AUTH = AUTH_EMULATOR ? `http://${AUTH_EMULATOR}/identitytoolkit.googleapis.com/v1` : "https://identitytoolkit.googleapis.com/v1";
const FIRESTORE = `${DB_EMULATOR ? `http://${DB_EMULATOR}` : 'https://firestore.googleapis.com'}/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents`;
const ALLOWED_ORIGINS = new Set(["https://leo12testa-jpg.github.io","http://127.0.0.1:4173","http://localhost:4173"]);
function cors(req: Request) { const origin=req.headers.get("origin")||""; return {"access-control-allow-origin":ALLOWED_ORIGINS.has(origin)?origin:"https://leo12testa-jpg.github.io","access-control-allow-headers":"authorization, content-type","access-control-allow-methods":"POST, OPTIONS","content-type":"application/json","vary":"Origin"}; }
function json(req:Request, body:unknown, status=200){return new Response(JSON.stringify(body),{status,headers:cors(req)});}
function text(value:unknown,label:string,max=80){const out=String(value??"").trim(); if(!out||out.length>max) throw Object.assign(new Error(`${label} non valido.`),{status:400}); return out;}
function usernameOf(value:unknown){const out=String(value??"").trim().toLowerCase(); if(!/^[a-z0-9][a-z0-9._-]{1,38}[a-z0-9]$/.test(out)||out.includes("..")) throw Object.assign(new Error("Username non valido."),{status:400}); return out;}
const emailOf=(username:string)=>`${usernameOf(username)}@safetychecklist.local`;
function authHeader(token?:string):Record<string,string>{return token?{authorization:`Bearer ${token}`}:{};}
async function firebaseLookup(idToken:string){const response=await fetch(`${FIREBASE_AUTH}/accounts:lookup?key=${FIREBASE_API_KEY}`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({idToken})}); if(!response.ok) throw Object.assign(new Error("Sessione non valida."),{status:401}); const data=await response.json(); const user=data.users?.[0]; if(!user?.localId) throw Object.assign(new Error("Sessione non valida."),{status:401}); return {uid:user.localId as string,email:String(user.email||"")};}
function fromValue(value:any):any{if(!value||typeof value!=="object")return null;if("stringValue"in value)return value.stringValue;if("booleanValue"in value)return value.booleanValue;if("timestampValue"in value)return value.timestampValue;if("integerValue"in value)return Number(value.integerValue);if("doubleValue"in value)return value.doubleValue;if("nullValue"in value)return null;return null;}
function fromDoc(doc:any){const out:Record<string,any>={};for(const [key,value] of Object.entries(doc?.fields||{}))out[key]=fromValue(value);out.uid ||= String(doc?.name||"").split("/").pop()||"";return out;}
function toFields(obj:Record<string,any>){const fields:Record<string,any>={};for(const [key,value] of Object.entries(obj)){if(typeof value==="string")fields[key]={stringValue:value};else if(typeof value==="boolean")fields[key]={booleanValue:value};else if(typeof value==="number"&&Number.isInteger(value))fields[key]={integerValue:String(value)};else if(value===null)fields[key]={nullValue:null};}return fields;}
async function getProfile(uid:string,token?:string){const response=await fetch(`${FIRESTORE}/utenti/${encodeURIComponent(uid)}`,{headers:authHeader(token)});if([401,403,404].includes(response.status))return null;if(!response.ok)throw Object.assign(new Error("Profilo utente non disponibile."),{status:response.status});return fromDoc(await response.json());}
async function listCollection(collection:string,token:string) {
  const documents:any[]=[];let pageToken="";
  do {
    const query=new URLSearchParams({pageSize:"100"});if(pageToken)query.set("pageToken",pageToken);
    const response=await fetch(`${FIRESTORE}/${collection}?${query}`,{headers:authHeader(token)});
    if(!response.ok)throw Object.assign(new Error("Elenco non disponibile."),{status:response.status});
    const data=await response.json();documents.push(...(data.documents||[]));pageToken=data.nextPageToken||"";
  } while(pageToken);
  return documents.map(fromDoc);
}
async function listProfiles(token:string){return(await listCollection("utenti",token)).sort((a:any,b:any)=>`${a.cognome} ${a.nome}`.localeCompare(`${b.cognome} ${b.nome}`,"it"));}
function clampInt(value:unknown,max=9999){const n=Number(value);return Number.isFinite(n)?Math.max(0,Math.min(max,Math.trunc(n))):0;}
function short(value:unknown,max=160){return String(value??"").slice(0,max);}
function sanitizeDiagnostics(value:unknown){
  if(!Array.isArray(value))return[];
  return value.slice(0,8).map((item:any)=>({id:short(item?.id,120),error:short(item?.error,220)})).filter((item:any)=>item.id||item.error);
}
async function supabaseRest(path:string,init:RequestInit={}){
  if(!SUPABASE_URL_ENV||!SUPABASE_SERVICE_ROLE_KEY)throw Object.assign(new Error("Registro utilizzo non configurato."),{status:503});
  const headers={apikey:SUPABASE_SERVICE_ROLE_KEY,authorization:`Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,"content-type":"application/json",...(init.headers||{})};
  const response=await fetch(`${SUPABASE_URL_ENV}/rest/v1/${path}`,{...init,headers});
  if(!response.ok){const detail=await response.text().catch(()=>"");throw Object.assign(new Error(`Registro utilizzo non disponibile (${response.status}). ${detail.slice(0,180)}`),{status:503});}
  if(response.status===204)return null;
  const raw=await response.text();
  return raw?JSON.parse(raw):null;
}
async function trackUsage(req:Request,user:any,profile:any,body:any){
  const now=new Date().toISOString();
  const event=body.event==="access"?"access":"heartbeat";
  const payload={
    uid:user.uid,username:String(profile.username||""),nome:`${profile.nome||""} ${profile.cognome||""}`.trim(),
    last_seen:now,...(event==="access"?{last_access:now}:{}),
    sync_state:short(body.syncState,32),
    pending_data:clampInt(body.pendingData),pending_photos:clampInt(body.pendingPhotos),
    pending_cloud:clampInt(body.pendingCloud),pending_errors:clampInt(body.pendingErrors),
    client_build:short(body.clientBuild,64),user_agent:short(req.headers.get("user-agent")||"",300),
    diagnostics:sanitizeDiagnostics(body.diagnostics),updated_at:now
  };
  await supabaseRest("safety_app_usage?on_conflict=uid",{method:"POST",headers:{Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify(payload)});
  if(event==="access"){
    await supabaseRest("safety_app_access_events",{method:"POST",headers:{Prefer:"return=minimal"},body:JSON.stringify({uid:user.uid,username:String(profile.username||""),occurred_at:now,client_build:payload.client_build,user_agent:payload.user_agent})});
  }
}
async function usageSummary(){
  const since=new Date(Date.now()-30*24*60*60*1000).toISOString();
  const usage=await supabaseRest("safety_app_usage?select=uid,username,nome,last_seen,last_access,sync_state,pending_data,pending_photos,pending_cloud,pending_errors,client_build,diagnostics&order=last_seen.desc")||[];
  const events=await supabaseRest(`safety_app_access_events?select=uid,occurred_at&occurred_at=gte.${encodeURIComponent(since)}&limit=5000`)||[];
  const counts=new Map<string,number>();
  for(const item of events)counts.set(String(item.uid),1+(counts.get(String(item.uid))||0));
  return usage.map((item:any)=>({...item,accessi_30gg:counts.get(String(item.uid))||0}));
}

async function usagePing(req:Request,body:any) {
  const user=await caller(req),profile=await getProfile(user.uid,user.token);
  if(!profile||profile.attivo!==true||!['admin','tecnico'].includes(profile.ruolo))throw Object.assign(new Error('Account non attivo.'),{status:403});
  await trackUsage(req,user,profile,body);return json(req,{ok:true});
}
async function putProfile(uid:string,profile:Record<string,any>,token?:string){const now=new Date().toISOString();const response=await fetch(`${FIRESTORE}/utenti/${encodeURIComponent(uid)}`,{method:"PATCH",headers:{"content-type":"application/json",...authHeader(token)},body:JSON.stringify({fields:{...toFields(profile),creato_il:{timestampValue:profile.creato_il||now},aggiornato_il:{timestampValue:now}}})});if(!response.ok)throw Object.assign(new Error(`Impossibile salvare il profilo (${response.status}).`),{status:response.status});return fromDoc(await response.json());}
async function setActive(uid:string,active:boolean,token:string){const now=new Date().toISOString();const url=`${FIRESTORE}/utenti/${encodeURIComponent(uid)}?updateMask.fieldPaths=attivo&updateMask.fieldPaths=aggiornato_il`;const response=await fetch(url,{method:"PATCH",headers:{"content-type":"application/json",...authHeader(token)},body:JSON.stringify({fields:{attivo:{booleanValue:active},aggiornato_il:{timestampValue:now}}})});if(!response.ok)throw Object.assign(new Error("Impossibile aggiornare l'utente."),{status:response.status});}
async function setRole(uid:string,role:"admin"|"tecnico",token:string){const now=new Date().toISOString();const url=`${FIRESTORE}/utenti/${encodeURIComponent(uid)}?updateMask.fieldPaths=ruolo&updateMask.fieldPaths=aggiornato_il`;const response=await fetch(url,{method:"PATCH",headers:{"content-type":"application/json",...authHeader(token)},body:JSON.stringify({fields:{ruolo:{stringValue:role},aggiornato_il:{timestampValue:now}}})});if(!response.ok)throw Object.assign(new Error("Impossibile aggiornare il ruolo."),{status:response.status});}
async function signup(username:string,password:string,nome:string,cognome:string){const response=await fetch(`${FIREBASE_AUTH}/accounts:signUp?key=${FIREBASE_API_KEY}`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email:emailOf(username),password,displayName:`${nome} ${cognome}`,returnSecureToken:true})});const data=await response.json();if(!response.ok){const code=String(data?.error?.message||"");const status=code.includes("EMAIL_EXISTS")?409:400;throw Object.assign(new Error(code.includes("EMAIL_EXISTS")?"Username già utilizzato.":"Impossibile creare l'account."),{status,firebase:code});}return{uid:data.localId as string,idToken:data.idToken as string};}
async function deleteSelf(idToken:string){await fetch(`${FIREBASE_AUTH}/accounts:delete?key=${FIREBASE_API_KEY}`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({idToken})}).catch(()=>{});}
async function caller(req:Request){const header=req.headers.get("authorization")||"";if(!header.startsWith("Bearer "))throw Object.assign(new Error("Non autorizzato."),{status:401});const token=header.slice(7);const user=await firebaseLookup(token);return{...user,token};}
async function requireAdmin(req:Request){const user=await caller(req);const profile=await getProfile(user.uid,user.token);if(!profile||profile.attivo!==true||profile.ruolo!=="admin")throw Object.assign(new Error("Operazione riservata agli amministratori."),{status:403});return{...user,profile};}
Deno.serve({port:Number(Deno.env?.get('PORT')||8000),hostname:Deno.env?.get('LISTEN_HOST')||'0.0.0.0'},async(req:Request)=>{if(req.method==="OPTIONS")return new Response(null,{status:204,headers:cors(req)});if(req.method!=="POST")return json(req,{error:"Metodo non consentito."},405);try{const body=await req.json().catch(()=>({}));const action=String(body.action||"");if(action==="sessionStatus"){const user=await caller(req);const profile=await getProfile(user.uid,user.token);return json(req,{active:!!profile&&profile.attivo===true});}if(action==="usagePing")return await usagePing(req,body);const admin=await requireAdmin(req);if(action==="usage")return json(req,{usage:await usageSummary()});if(action==="list")return json(req,{users:await listProfiles(admin.token)});if(action==="create"){const username=usernameOf(body.username),nome=text(body.nome,"Nome"),cognome=text(body.cognome,"Cognome");const ruolo=body.ruolo==="admin"?"admin":body.ruolo==="tecnico"?"tecnico":null;const password=String(body.password||"");if(!ruolo||password.length<12||password.length>128)throw Object.assign(new Error("Ruolo o password non validi (minimo 12 caratteri)."),{status:400});if(body.accountTest===true&&(username!=="test.tecnico"||ruolo!=="tecnico"))throw Object.assign(new Error("Account di test: usare test.tecnico con ruolo tecnico."),{status:400});const existing=await listProfiles(admin.token);if(existing.some((u:any)=>u.username===username))throw Object.assign(new Error("Username già utilizzato."),{status:409});const created=await signup(username,password,nome,cognome);try{const profile=await putProfile(created.uid,{uid:created.uid,username,nome,cognome,ruolo,attivo:true,account_test:body.accountTest===true},admin.token);return json(req,{user:profile});}catch(error){await deleteSelf(created.idToken);throw error;}}if(action==="setActive"){const uid=text(body.uid,"Utente",160),active=body.active===true;if(uid===admin.uid&&!active)throw Object.assign(new Error("Non puoi disattivare il tuo account mentre sei collegato."),{status:400});const users=await listProfiles(admin.token),target=users.find((u:any)=>u.uid===uid);if(!target)throw Object.assign(new Error("Utente non trovato."),{status:404});if(!active&&target.ruolo==="admin"&&target.attivo===true){const activeAdmins=users.filter((u:any)=>u.ruolo==="admin"&&u.attivo===true);if(activeAdmins.length<2)throw Object.assign(new Error("Crea un secondo admin prima di disattivare l'unico amministratore."),{status:400});}await setActive(uid,active,admin.token);return json(req,{uid,active});}
if(action==="setRole"){const uid=text(body.uid,"Utente",160);const role=body.role==="admin"?"admin":body.role==="tecnico"?"tecnico":null;if(!role)throw Object.assign(new Error("Ruolo non valido."),{status:400});if(uid===admin.uid)throw Object.assign(new Error("Per sicurezza non puoi cambiare il ruolo del tuo account mentre sei collegato."),{status:400});const users=await listProfiles(admin.token),target=users.find((u:any)=>u.uid===uid);if(!target)throw Object.assign(new Error("Utente non trovato."),{status:404});if(target.ruolo==="admin"&&role!=="admin"&&target.attivo===true){const activeAdmins=users.filter((u:any)=>u.ruolo==="admin"&&u.attivo===true);if(activeAdmins.length<2)throw Object.assign(new Error("Deve rimanere almeno un amministratore attivo."),{status:400});}await setRole(uid,role,admin.token);return json(req,{uid,role});}
throw Object.assign(new Error("Operazione non riconosciuta."),{status:400});}catch(error:any){return json(req,{error:error?.message||"Richiesta non valida."},Number(error?.status)||400);}});
