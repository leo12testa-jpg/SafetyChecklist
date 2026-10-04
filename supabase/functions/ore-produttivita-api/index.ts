import { createClient } from "npm:@supabase/supabase-js@2.95.0";

const FIREBASE_API_KEY = "AIzaSyAdgCc8TQ1TVfF8l0NMxtm7NS95ZOl4lCA";
const FIREBASE_PROJECT_ID = "safety-checklist-colligo";
const FIREBASE_AUTH = "https://identitytoolkit.googleapis.com/v1";
const FIRESTORE = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents`;
const ALLOWED_ORIGINS = new Set([
  "https://leo12testa-jpg.github.io",
  "http://127.0.0.1:4173",
  "http://localhost:4173",
  "http://127.0.0.1:5500",
  "http://localhost:5500"
]);

function cors(req: Request) {
  const origin = req.headers.get("origin") || "";
  return {
    "access-control-allow-origin": ALLOWED_ORIGINS.has(origin) ? origin : "https://leo12testa-jpg.github.io",
    "access-control-allow-headers": "authorization, content-type",
    "access-control-allow-methods": "POST, OPTIONS",
    "content-type": "application/json",
    "vary": "Origin"
  };
}
function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: cors(req) });
}
function bad(message: string, status = 400) {
  throw Object.assign(new Error(message), { status });
}
function dateOnly(v: unknown) {
  const s = String(v || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || !Number.isFinite(Date.parse(s+"T12:00:00Z")) || new Date(s+"T12:00:00Z").toISOString().slice(0,10)!==s) bad("Data non valida.");
  return s;
}
function easterDate(year:number){
  const a=year%19,b=Math.floor(year/100),c=year%100,d=Math.floor(b/4),e=b%4,f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3);
  const h=(19*a+b-d-g+15)%30,i=Math.floor(c/4),k=c%4,l=(32+2*e+2*i-h-k)%7,m=Math.floor((a+11*h+22*l)/451);
  const value=h+l-7*m+114,month=Math.floor(value/31),day=value%31+1;
  return `${year}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
}
function italianHoliday(day:string){
  const year=Number(day.slice(0,4));
  const fixed:Record<string,string>={"01-01":"Capodanno","01-06":"Epifania","04-25":"Liberazione","05-01":"Festa del lavoro","06-02":"Festa della Repubblica","08-15":"Ferragosto","11-01":"Ognissanti","12-08":"Immacolata","12-25":"Natale","12-26":"Santo Stefano"};
  if(fixed[day.slice(5)])return fixed[day.slice(5)];
  // L. 151/2025, effective 2026; no retroactive national holiday.
  if(year>=2026&&day.slice(5)==="10-04")return "San Francesco d’Assisi";
  const easter=easterDate(year);if(day===easter)return "Pasqua";
  const monday=new Date(easter+"T12:00:00Z");monday.setUTCDate(monday.getUTCDate()+1);
  return day===monday.toISOString().slice(0,10)?"Lunedì dell’Angelo":null;
}
function expectedWork(day:string,schedules:any[]){
  const holiday=italianHoliday(day);
  const applicable=schedules.filter(s=>s.valido_dal<=day).sort((a,b)=>String(b.valido_dal).localeCompare(String(a.valido_dal)))[0];
  const weekday=(new Date(day+"T12:00:00Z").getUTCDay()+6)%7;
  const week=applicable?.settimana_minuti||[480,480,480,480,480,0,0];
  return {minutes:holiday?0:week[weekday],holiday,source:applicable?"configurato":"default",validFrom:applicable?.valido_dal||null};
}
function minutes(v: unknown) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 1440) bad("Durata non valida.");
  return n;
}
let firebaseKeyCache:{keys:JsonWebKey[],until:number}|null=null;
function jwtBytes(value:string){return Uint8Array.from(atob(value.replace(/-/g,"+").replace(/_/g,"/")),c=>c.charCodeAt(0));}
async function verifyFirebaseJwt(token:string){
  try{
    const parts=token.split(".");if(parts.length!==3||token.length>16384)throw new Error();
    const header=JSON.parse(new TextDecoder().decode(jwtBytes(parts[0]))),claims=JSON.parse(new TextDecoder().decode(jwtBytes(parts[1])));
    const now=Math.floor(Date.now()/1000);
    if(header.alg!=="RS256"||typeof header.kid!=="string"||claims.aud!==FIREBASE_PROJECT_ID||claims.iss!==`https://securetoken.google.com/${FIREBASE_PROJECT_ID}`||typeof claims.exp!=="number"||claims.exp<=now||typeof claims.iat!=="number"||claims.iat>now||typeof claims.sub!=="string"||!claims.sub||claims.sub.length>128)throw new Error();
    if(!firebaseKeyCache||firebaseKeyCache.until<=Date.now()){
      const response=await fetch("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com");
      if(!response.ok)throw new Error();const body=await response.json();
      if(!Array.isArray(body.keys))throw new Error();
      const seconds=Number(response.headers.get("cache-control")?.match(/max-age=(\d+)/)?.[1]||300);
      firebaseKeyCache={keys:body.keys,until:Date.now()+Math.min(seconds,3600)*1000};
    }
    const jwk=firebaseKeyCache.keys.find((k:any)=>k.kid===header.kid&&k.kty==="RSA");if(!jwk)throw new Error();
    const key=await crypto.subtle.importKey("jwk",jwk,{name:"RSASSA-PKCS1-v1_5",hash:"SHA-256"},false,["verify"]);
    if(!await crypto.subtle.verify("RSASSA-PKCS1-v1_5",key,jwtBytes(parts[2]),new TextEncoder().encode(parts[0]+"."+parts[1])))throw new Error();
    return claims.sub;
  }catch{bad("Sessione non valida.",401);}
}
async function firebaseLookup(idToken: string) {
  const verifiedUid=await verifyFirebaseJwt(idToken);
  const response = await fetch(`${FIREBASE_AUTH}/accounts:lookup?key=${FIREBASE_API_KEY}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ idToken })
  });
  if (!response.ok) bad("Sessione non valida.", 401);
  const data = await response.json();
  const user = data.users?.[0];
  if (!user?.localId || user.localId!==verifiedUid) bad("Sessione non valida.", 401);
  return { uid: String(user.localId), email: String(user.email || "") };
}
function fromValue(value: any): any {
  if (!value || typeof value !== "object") return null;
  if ("stringValue" in value) return value.stringValue;
  if ("booleanValue" in value) return value.booleanValue;
  if ("timestampValue" in value) return value.timestampValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return value.doubleValue;
  if ("nullValue" in value) return null;
  return null;
}
function fromDoc(doc: any) {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(doc?.fields || {})) out[k] = fromValue(v);
  out.uid ||= String(doc?.name || "").split("/").pop() || "";
  return out;
}
async function caller(req: Request) {
  const h = req.headers.get("authorization") || "";
  if (!h.startsWith("Bearer ")) bad("Non autorizzato.", 401);
  const token = h.slice(7);
  const user = await firebaseLookup(token);
  const p = await fetch(`${FIRESTORE}/utenti/${encodeURIComponent(user.uid)}`, { headers: { authorization: `Bearer ${token}` } });
  if (!p.ok) bad("Profilo non disponibile.", 403);
  const profile = fromDoc(await p.json());
  if (profile.attivo !== true || !["admin", "tecnico"].includes(profile.ruolo)) bad("Account non attivo.", 403);
  return { ...user, token, profile };
}
function adminClient() {
  const url = Deno.env.get("SUPABASE_URL")!;
  const secretJson = Deno.env.get("SUPABASE_SECRET_KEYS");
  const key = secretJson ? JSON.parse(secretJson).default : Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
function requireAdmin(user: any) {
  if (user.profile.ruolo !== "admin") bad("Operazione riservata agli amministratori.", 403);
}
// Role is always read from the server-side Firebase profile. Unknown actions fail closed.
const ACTION_ROLES: Record<string, readonly string[]> = {
  me: ["admin", "tecnico"], myCrmResource: ["admin", "tecnico"],
  crmDebug: ["admin", "tecnico"], catalog: ["admin", "tecnico"],
  commesse: ["admin", "tecnico"], day: ["admin", "tecnico"],
  recentPersonal: ["admin", "tecnico"], saveSession: ["admin", "tecnico"],
  addManual: ["admin", "tecnico"], confirmDay: ["admin", "tecnico"],
  ingestAgenda: ["admin", "tecnico"], syncStatus: ["admin", "tecnico"],
  resolveSyncIssue: ["admin", "tecnico"],
  importPlanner: ["admin"], importHistoryBatch: ["admin"],
  crmResources: ["admin"], crmAgentHeartbeat: ["admin"], ingestAgendaCompany: ["admin"],
  economicsCatalog: ["admin"], saveTechnicianCost: ["admin"], saveJobEconomics: ["admin"],
  adminEconomics: ["admin"], archiveJobs: ["admin"], archiveJobDetail: ["admin"],
  adminSummary: ["admin"], crmLinks: ["admin"], previewCrmLink: ["admin"], approveCrmLink: ["admin"],
  saveInternal: ["admin", "tecnico"], workSchedules: ["admin"], saveWorkSchedule: ["admin"],
  savePhase: ["admin", "tecnico"], previewIdentity: ["admin"], approveIdentity: ["admin"]
};
function authorizeAction(user: any, action: string) {
  if (!Object.hasOwn(ACTION_ROLES, action)) bad("Operazione non riconosciuta.");
  if (!ACTION_ROLES[action].includes(user.profile.ruolo)) bad("Operazione riservata agli amministratori.", 403);
}
const INTERNAL_CATEGORIES = new Set(["formazione_interna","amministrazione","commerciale_preventivi","aggiornamento_normativo","riunioni_interne","altro_interno","assenza"]);
const WORK_PHASES = new Set(["sopralluogo","trasferta","redazione","revisione","riunione_cliente","misurazioni","formazione_erogata","altro"]);
function attributeIdentity(rows:any[],aliases:any[]){
  const byUid=new Map(aliases.map(a=>[a.uid_storico,a]));
  return rows.map(row=>{const alias:any=byUid.get(row.tecnico_uid);return alias?{...row,tecnico_uid_originale:row.tecnico_uid,tecnico_uid:alias.tecnico_uid,tecnico_nome:alias.tecnico_nome||row.tecnico_nome}:row;});
}
async function readAll(builder:()=>any){
 const rows:any[]=[];
 for(let offset=0;;offset+=1000){const {data,error}=await builder().order("id").range(offset,offset+999);if(error)return {data:null,error};rows.push(...(data||[]));if((data||[]).length<1000)break;}
 return {data:rows,error:null};
}
function billability(rows:any[]) {
  const byTech=new Map<string,any>();
  let billable=0,denominator=0,absence=0;
  for(const r of rows){
    const m=Number(r.minuti_effettivi||0);
    const t=byTech.get(r.tecnico_uid)||{tecnico_uid:r.tecnico_uid,tecnico_nome:r.tecnico_nome||r.tecnico_uid,billableMinutes:0,reportedExcludingAbsence:0,absenceMinutes:0};
    if(r.assenza){absence+=m;t.absenceMinutes+=m;}else{denominator+=m;t.reportedExcludingAbsence+=m;}
    if(r.fatturabile){billable+=m;t.billableMinutes+=m;}
    byTech.set(r.tecnico_uid,t);
  }
  return {billableMinutes:billable,reportedExcludingAbsence:denominator,absenceMinutes:absence,percent:denominator?100*billable/denominator:null,
    technicians:[...byTech.values()].map(t=>({...t,percent:t.reportedExcludingAbsence?100*t.billableMinutes/t.reportedExcludingAbsence:null})).sort((a,b)=>String(a.tecnico_nome).localeCompare(String(b.tecnico_nome),"it"))};
}
async function writeAudit(db: any, uid: string, action: string, entity: string, entityId: string | null, details: any = {}) {
  await db.from("ore_audit").insert({ tecnico_uid: uid, azione: action, entita: entity, entita_id: entityId, dettagli: details });
}
async function bindCallerResource(db:any,user:any) {
  // Never infer ownership from names or move/delete historical sessions during a read.
  const { data: resources, error } = await db.from("ore_risorse_crm")
    .select("id,sigla_crm,nome_crm,tecnico_uid,tecnico_nome")
    .eq("attiva", true).eq("tecnico_uid", user.uid);
  if (error) bad("Impossibile verificare il collegamento CRM.", 500);
  return resources?.length === 1 ? resources[0] : null;
}


Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });
  if (req.method !== "POST") return json(req, { error: "Metodo non consentito." }, 405);
  try {
    const user = await caller(req);
    const db = adminClient();
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "");
    authorizeAction(user, action);

    if(action === "previewIdentity"||action === "approveIdentity"){
      const {data:resource,error}=await db.from("ore_risorse_crm").select("*").eq("id",String(body.resourceId||"")).eq("attiva",true).maybeSingle();
      if(error||!resource)bad("Risorsa non trovata.",404);
      const legacyUid="legacy:"+resource.sigla_crm;
      const {data:alias}=await db.from("ore_identita_alias").select("*").eq("uid_storico",legacyUid).maybeSingle();
      if(action==="previewIdentity"){
        let sessions=0,minutes=0;
        for(let offset=0;;offset+=1000){const {data,error}=await db.from("ore_sessioni").select("minuti_effettivi").eq("tecnico_uid",legacyUid).order("id").range(offset,offset+999);if(error)bad("Impossibile leggere lo storico.",500);sessions+=(data||[]).length;minutes+=(data||[]).reduce((sum:number,s:any)=>sum+s.minuti_effettivi,0);if((data||[]).length<1000)break;}
        return json(req,{resource,alias,legacyUid,sessions,minutes});
      }
      const uid=String(body.tecnicoUid||"");if(!uid||uid.startsWith("legacy:")||uid.includes("/"))bad("Account non valido.");
      const response=await fetch(`${FIRESTORE}/utenti/${encodeURIComponent(uid)}`,{headers:{authorization:`Bearer ${user.token}`}});
      if(!response.ok)bad("Account non trovato.",404);const target=fromDoc(await response.json());
      if(target.attivo!==true||!["admin","tecnico"].includes(target.ruolo))bad("Account non attivo.");
      const {data,error:saveError}=await db.rpc("ore_collega_identita",{p_resource:resource.id,p_uid:uid,p_name:`${target.nome||""} ${target.cognome||""}`.trim(),p_actor:user.uid,p_previous_uid:body.previousUid??null,p_previous_approval:body.previousApproval??null,p_previous_alias:body.previousAlias??null});
      if(saveError)bad(saveError.message,409);return json(req,data);
    }

    if (action === "savePhase") {
      const id=String(body.id||""),phase=body.fase===null||body.fase===""?null:String(body.fase||"");
      if(!id||(phase!==null&&!WORK_PHASES.has(phase)))bad("Fase di lavoro non valida.");
      const {data:current,error}=await db.from("ore_sessioni").select("tecnico_uid,confermata").eq("id",id).maybeSingle();
      if(error||!current)bad("Sessione non trovata.",404);
      if(current.tecnico_uid!==user.uid&&user.profile.ruolo!=="admin")bad("Non autorizzato.",403);
      if(current.confermata&&user.profile.ruolo!=="admin")bad("Giornata confermata: serve sblocco amministratore.",403);
      if(!body.updatedAt||!Number.isFinite(Date.parse(String(body.updatedAt))))bad("Versione della sessione non valida: ricarica.");
      const {data,error:saveError}=await db.rpc("ore_salva_fase",{p_id:id,p_phase:phase,p_actor:user.uid,p_admin:user.profile.ruolo==="admin",p_expected:body.updatedAt,p_reason:String(body.motivo||"").trim().slice(0,300)||null});
      if(saveError)bad(saveError.message||"Impossibile salvare la fase.",409);
      return json(req,data);
    }

    if (action === "workSchedules") {
      const {data:schedules,error}=await db.from("ore_orari_tecnici").select("*").order("valido_dal",{ascending:false});
      if(error)bad("Impossibile caricare gli orari previsti.",500);
      const response=await fetch(`${FIRESTORE}/utenti?pageSize=1000`,{headers:{authorization:`Bearer ${user.token}`}});
      if(!response.ok)bad("Impossibile caricare gli account tecnici.",500);
      const body=await response.json();if(body.nextPageToken)bad("Elenco account troppo lungo: serve paginazione.",500);
      const technicians=(body.documents||[]).map(fromDoc).filter((p:any)=>p.attivo===true&&["tecnico","admin"].includes(p.ruolo)).map((p:any)=>({uid:p.uid,nome:`${p.nome||""} ${p.cognome||""}`.trim()}));
      return json(req,{schedules:schedules||[],technicians});
    }
    if (action === "saveWorkSchedule") {
      const uid=String(body.tecnicoUid||"").trim(),from=dateOnly(body.validoDal);
      const week=body.settimanaMinuti;if(!uid||!Array.isArray(week)||week.length!==7)bad("Orario settimanale non valido.");
      if(week.some((value:any)=>typeof value!=="number"))bad("I minuti settimanali devono essere numeri interi.");
      week.forEach(minutes);
      const response=await fetch(`${FIRESTORE}/utenti/${encodeURIComponent(uid)}`,{headers:{authorization:`Bearer ${user.token}`}});
      if(!response.ok)bad("Account tecnico non trovato.",404);
      const target=fromDoc(await response.json());if(target.attivo!==true||!["admin","tecnico"].includes(target.ruolo))bad("Account tecnico non attivo.");
      const {data,error}=await db.rpc("ore_aggiungi_orario",{p_uid:uid,p_name:`${target.nome||""} ${target.cognome||""}`.trim(),p_from:from,p_week:week,p_actor:user.uid});
      if(error)bad(error.message||"Impossibile salvare l'orario.",409);
      return json(req,data);
    }

    if (action === "saveInternal") {
      const category=String(body.categoria||"");
      if(!INTERNAL_CATEGORIES.has(category))bad("Categoria interna non valida.");
      const duration=minutes(body.minutiEffettivi), day=dateOnly(body.date);
      let targetUid=String(body.tecnicoUid||user.uid), targetName=`${user.profile.nome||""} ${user.profile.cognome||""}`.trim();
      const id=body.id?String(body.id):null;
      if(id){
        const {data:current,error}=await db.from("ore_attivita_interne").select("tecnico_uid,tecnico_nome,data_lavoro").eq("id",id).maybeSingle();
        if(error||!current)bad("Attività interna non trovata.",404);
        if(current.tecnico_uid!==user.uid&&user.profile.ruolo!=="admin")bad("Non autorizzato.",403);
        targetUid=current.tecnico_uid;targetName=current.tecnico_nome||"";
        if(current.data_lavoro!==day)bad("La data dell'attività non è modificabile.");
      }
      if(targetUid!==user.uid){
        requireAdmin(user);
        const response=await fetch(`${FIRESTORE}/utenti/${encodeURIComponent(targetUid)}`,{headers:{authorization:`Bearer ${user.token}`}});
        if(!response.ok)bad("Account tecnico non trovato.",404);
        const target=fromDoc(await response.json());
        if(target.attivo!==true||!["admin","tecnico"].includes(target.ruolo))bad("Account tecnico non attivo.");
        targetName=`${target.nome||""} ${target.cognome||""}`.trim();
      }
      const {data,error}=await db.rpc("ore_salva_attivita_interna",{p_id:id,p_uid:targetUid,p_name:targetName,p_day:day,p_category:category,p_minutes:duration,p_actor:user.uid,p_admin:user.profile.ruolo==="admin"});
      if(error)bad(error.message||"Impossibile salvare l'attività interna.",409);
      return json(req,data);
    }

    if (action === "crmLinks") {
      const { data: resources, error } = await db.from("ore_risorse_crm").select("*").order("sigla_crm");
      if (error) bad("Impossibile caricare i collegamenti CRM.", 500);
      const usersResponse = await fetch(`${FIRESTORE}/utenti?pageSize=1000`, { headers: { authorization: `Bearer ${user.token}` } });
      if (!usersResponse.ok) bad("Impossibile caricare gli account tecnici.", 500);
      const usersBody = await usersResponse.json();
      if (usersBody.nextPageToken) bad("Elenco account troppo lungo: serve paginazione.", 500);
      const technicians = (usersBody.documents || []).map(fromDoc).filter((p:any)=>p.attivo===true && ["tecnico","admin"].includes(p.ruolo))
        .map((p:any)=>({uid:p.uid,nome:`${p.nome || ""} ${p.cognome || ""}`.trim()}));
      const sessions:any[]=[];
      for(let offset=0;;offset+=1000){
        const {data,error}=await db.from("ore_sessioni").select("id,tecnico_uid,crm_risorsa_id,origine,confermata").order("id").range(offset,offset+999);
        if(error)bad("Impossibile contare le sessioni dei collegamenti.",500);
        sessions.push(...(data||[]));if((data||[]).length<1000)break;
      }
      const {data:history,error:historyError}=await db.from("ore_audit").select("tecnico_uid,azione,entita_id,created_at,dettagli")
        .in("azione",["collega_risorsa_crm","approva_collegamento_crm"]).order("created_at",{ascending:false}).limit(1000);
      const {data:pending,error:pendingError}=await db.from("ore_sync_issues").select("id,tecnico_uid,data_lavoro,titolo,minuti,candidati")
        .like("tecnico_uid","unassigned:%").eq("stato","aperta").order("data_lavoro").limit(1000);
      if(historyError||pendingError)bad("Impossibile caricare lo storico CRM.",500);
      const normalize=(v:any)=>String(v||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().split(/\s+/).filter(Boolean);
      const rows=(resources||[]).map((r:any)=>{
        const real=Boolean(r.tecnico_uid&&!String(r.tecnico_uid).startsWith("legacy:"));
        const own=sessions.filter(s=>s.crm_risorsa_id===r.id);
        const historic=sessions.filter(s=>s.crm_risorsa_id===null&&s.tecnico_uid===r.tecnico_uid);
        const events=(history||[]).filter((a:any)=>a.entita_id===r.id);
        return {...r,stato_collegamento:r.collegamento_approvato_at?"confermato":"da confermare",
          account_reale:real,sessioni_risorsa:own.length,sessioni_uid_storiche:historic.length,
          storico:events,origine_collegamento:events.length?events[events.length-1].azione:"non indicato",
          data_collegamento:events.length?events[events.length-1].created_at:null};
      });
      const similar:any[]=[];
      for(let i=0;i<rows.length;i++)for(let j=i+1;j<rows.length;j++){
        const a=normalize(rows[i].nome_crm),b=normalize(rows[j].nome_crm);
        if(a.some((word:string)=>b.includes(word)))similar.push({a:rows[i].sigla_crm,b:rows[j].sigla_crm,motivo:"parole del nome in comune: da verificare"});
      }
      const multiple=technicians.map((t:any)=>({...t,risorse:rows.filter((r:any)=>r.tecnico_uid===t.uid).map((r:any)=>r.sigla_crm)})).filter((t:any)=>t.risorse.length>1);
      return json(req,{rows,technicians,ambigui:{nomi_simili:similar,senza_tecnico:rows.filter((r:any)=>!r.account_reale).map((r:any)=>r.sigla_crm),tecnici_con_piu_risorse:multiple},pending:pending||[],limiti:{storico:(history||[]).length===1000,attivita:(pending||[]).length===1000}});
    }

    if (action === "previewCrmLink" || action === "approveCrmLink") {
      const resourceId=String(body.resourceId||"");
      const {data:resource,error}=await db.from("ore_risorse_crm").select("*").eq("id",resourceId).eq("attiva",true).maybeSingle();
      if(error||!resource)bad("Risorsa non trovata.",404);
      if(action==="previewCrmLink"){
        const {data:sessions,error:sessionError}=await db.from("ore_sessioni")
          .select("id,data_lavoro,tecnico_uid,tecnico_nome,minuti_effettivi,confermata,updated_at,ore_commesse(descrizione)")
          .eq("crm_risorsa_id",resourceId).eq("confermata",false).order("data_lavoro").limit(501);
        if(sessionError)bad("Impossibile caricare l'anteprima.",500);
        if((sessions||[]).length>500)bad("Oltre 500 sessioni: restringere prima la riassegnazione.");
        return json(req,{resource,sessions:sessions||[],nota:"Le sessioni storiche senza risorsa indicata e le sessioni confermate non vengono spostate."});
      }
      const targetUid=String(body.tecnicoUid||"").trim();
      if(!targetUid||targetUid.startsWith("legacy:")||targetUid.includes("/"))bad("Scegli un account tecnico attivo.");
      const response=await fetch(`${FIRESTORE}/utenti/${encodeURIComponent(targetUid)}`,{headers:{authorization:`Bearer ${user.token}`}});
      if(!response.ok)bad("Account tecnico non trovato.",404);
      const target=fromDoc(await response.json());
      if(target.attivo!==true||!["admin","tecnico"].includes(target.ruolo))bad("Account tecnico non attivo.");
      const sessions=Array.isArray(body.sessions)?body.sessions:[];
      if(sessions.length>500||sessions.some((s:any)=>!s.id||!s.updated_at))bad("Anteprima non valida.");
      const {data,error:saveError}=await db.rpc("ore_approva_collegamento_crm",{
        p_resource:resourceId,p_uid:targetUid,p_name:`${target.nome||""} ${target.cognome||""}`.trim(),p_actor:user.uid,
        p_previous_uid:body.previousUid??null,p_previous_approval:body.previousApproval??null,
        p_sessions:sessions.map((s:any)=>({id:s.id,updated_at:s.updated_at}))
      });
      if(saveError)bad(saveError.message||"Impossibile approvare il collegamento.",409);
      return json(req,data);
    }

    const identityAliases:any[]=[];
    if(["adminSummary","archiveJobs","archiveJobDetail","adminEconomics","economicsCatalog"].includes(action)){
      const {data,error}=await db.from("ore_identita_alias").select("*");
      if(error)bad("Impossibile attribuire le identita approvate.",500);identityAliases.push(...(data||[]));
    }
    const ensureTrackingJob = async (clienteIdRaw:any, tipologiaIdRaw:any, workDayRaw:any) => {
      const clienteId = String(clienteIdRaw || "").trim();
      const tipologiaId = String(tipologiaIdRaw || "").trim();
      if (!clienteId || !tipologiaId) bad("Seleziona cliente e tipologia.");

      const [{ data: client, error: clientErr }, { data: type, error: typeErr }] = await Promise.all([
        db.from("ore_clienti").select("id,codice_breve,ragione_sociale").eq("id", clienteId).eq("attivo", true).maybeSingle(),
        db.from("ore_tipologie").select("id,codice,nome").eq("id", tipologiaId).eq("attiva", true).maybeSingle()
      ]);
      if (clientErr || !client || typeErr || !type) bad("Cliente o tipologia non validi.", 404);

      const { data: matching, error: matchErr } = await db.from("ore_commesse")
        .select("id,codice_breve,codice_lavoro,codice_commessa_crm,descrizione,stato,cliente_id,tipologia_id")
        .eq("cliente_id", client.id)
        .eq("tipologia_id", type.id)
        .neq("stato", "archiviata")
        .order("stato", { ascending: false })
        .limit(10);
      if (matchErr) bad("Impossibile verificare le commesse esistenti.", 500);
      if ((matching || []).length === 1) return matching[0];

      const day = dateOnly(workDayRaw);
      const year = Number(String(day).slice(0,4)) || new Date().getFullYear();
      const workCode = String(Number(client.codice_breve)) + String(type.codice || "").toUpperCase();
      const internalCode = `AUTO-${workCode}-${year}`;

      const { data: existing, error: existingErr } = await db.from("ore_commesse")
        .select("id,codice_breve,codice_lavoro,codice_commessa_crm,descrizione,stato,cliente_id,tipologia_id")
        .eq("codice_breve", internalCode)
        .maybeSingle();
      if (existingErr) bad("Impossibile verificare la classificazione interna.", 500);
      if (existing) return existing;

      const { data: created, error: createErr } = await db.from("ore_commesse").insert({
        cliente_id: client.id,
        codice_breve: internalCode,
        codice_lavoro: workCode,
        codice_commessa_crm: null,
        descrizione: `Rendicontazione ${type.nome}`,
        tipologia_id: type.id,
        stato: "in_lavorazione",
        anno: year,
        data_apertura: day,
        note: "Voce interna creata da Ore & Produttività per classificare attività CRM senza commessa specifica.",
        updated_at: new Date().toISOString()
      }).select("id,codice_breve,codice_lavoro,codice_commessa_crm,descrizione,stato,cliente_id,tipologia_id").single();
      if (createErr || !created) {
        const { data: raced } = await db.from("ore_commesse")
          .select("id,codice_breve,codice_lavoro,codice_commessa_crm,descrizione,stato,cliente_id,tipologia_id")
          .eq("codice_breve", internalCode).maybeSingle();
        if (raced) return raced;
        bad("Impossibile creare la classificazione interna.", 500);
      }
      return created;
    };

    if (action === "me") return json(req, { profile: user.profile });

    if (action === "myCrmResource") {
      const resource:any = await bindCallerResource(db,user);
      return json(req, {
        resource: resource ? {
          id: resource.id,
          sigla: resource.sigla_crm,
          nome: resource.nome_crm,
          tecnico_uid: resource.tecnico_uid,
          tecnico_nome: resource.tecnico_nome
        } : null
      });
    }

    if (action === "crmDebug") {
      const day = body.date ? dateOnly(body.date) : null;
      const samples = Array.isArray(body.samples)
        ? body.samples.slice(0, 30).map((x:any)=>String(x||"").slice(0, 1200))
        : [];
      const details = {
        date: day,
        event_count: Math.max(0, Math.min(500, Number(body.eventCount || 0))),
        frame_count: Math.max(0, Math.min(100, Number(body.frameCount || 0))),
        network_count: Math.max(0, Math.min(100, Number(body.networkCount || 0))),
        samples
      };
      await writeAudit(db, user.uid, "crm_debug", "agenda", day, details);
      return json(req, { ok: true });
    }

    if (action === "catalog") {
      const [{ data: clienti, error: e1 }, { data: tipologie, error: e2 }] = await Promise.all([
        db.from("ore_clienti").select("id,codice_breve,codice_crm,ragione_sociale").eq("attivo", true).order("codice_breve"),
        db.from("ore_tipologie").select("id,codice,nome,categoria").eq("attiva", true).order("codice")
      ]);
      if (e1 || e2) bad("Impossibile caricare l'anagrafica.", 500);
      return json(req, { clienti, tipologie });
    }

    if (action === "commesse") {
      let q = db.from("ore_commesse").select("id,codice_breve,codice_lavoro,codice_commessa_crm,descrizione,stato,cliente_id,tipologia_id").neq("stato", "archiviata").order("codice_breve").limit(250);
      if (body.clienteId) q = q.eq("cliente_id", String(body.clienteId));
      const { data, error } = await q;
      if (error) bad("Impossibile caricare le commesse.", 500);
      return json(req, { commesse: data });
    }

    if (action === "day") {
      await bindCallerResource(db,user);
      const day = dateOnly(body.date);
      const { data, error } = await db.from("ore_sessioni")
        .select("id,data_lavoro,inizio,fine,minuti_agenda,minuti_effettivi,origine,crm_event_id,crm_oggetto,attivita_rilevata,modificata_manualmente,motivo_modifica,confermata,commessa_id,fase,updated_at,ore_commesse(codice_breve,codice_lavoro,codice_commessa_crm,descrizione,stato,ore_clienti(codice_breve,ragione_sociale),ore_tipologie(codice,nome))")
        .eq("tecnico_uid", user.uid).eq("data_lavoro", day).order("inizio", { ascending: true });
      if (error) bad("Impossibile caricare la giornata.", 500);
      const {data:activities,error:activitiesError}=await db.from("ore_rendicontazioni").select("*").eq("tecnico_uid",user.uid).eq("data_lavoro",day);
      if(activitiesError)bad("Impossibile caricare le attività interne.",500);
      const {data:schedules,error:scheduleError}=await db.from("ore_orari_tecnici").select("valido_dal,settimana_minuti").eq("tecnico_uid",user.uid).lte("valido_dal",day).order("valido_dal",{ascending:false}).limit(1);
      if(scheduleError)bad("Impossibile caricare l'orario previsto.",500);
      const work=expectedWork(day,schedules||[]);
      const total = (activities || []).reduce((s: number, x: any) => s + Number(x.minuti_effettivi || 0), 0);
      const { data: giornata } = await db.from("ore_giornate").select("stato,confermata_at").eq("tecnico_uid", user.uid).eq("data", day).maybeSingle();
      return json(req, { date: day, sessions: data || [], internalActivities:(activities||[]).filter((r:any)=>r.tipo_record==="interna"),billability:billability(activities||[]),totalMinutes: total,expectedMinutes:work.minutes,workSchedule:work,dayStatus: giornata || { stato: "da_verificare", confermata_at: null } });
    }

    if (action === "recentPersonal") {
      await bindCallerResource(db,user);
      const { data, error } = await db.from("ore_sessioni")
        .select("commessa_id,data_lavoro,minuti_effettivi,crm_oggetto,attivita_rilevata,ore_commesse(cliente_id,codice_lavoro,codice_commessa_crm,descrizione,ore_clienti(codice_breve,ragione_sociale),ore_tipologie(codice,nome))")
        .eq("tecnico_uid",user.uid)
        .order("data_lavoro",{ascending:false})
        .limit(80);
      if(error) bad("Impossibile caricare le attività recenti.",500);
      const seen=new Set<string>();
      const rows:any[]=[];
      for(const s of data||[]){
        const id=String(s.commessa_id||"");
        if(!id||seen.has(id)) continue;
        seen.add(id);
        rows.push(s);
        if(rows.length>=6) break;
      }
      return json(req,{rows});
    }

    if (action === "saveSession") {
      const id = String(body.id || "");
      if (!id) bad("Sessione non valida.");
      const m = minutes(body.minutiEffettivi);
      const { data: current, error: findError } = await db.from("ore_sessioni")
        .select("id,tecnico_uid,data_lavoro,minuti_effettivi,commessa_id,crm_oggetto,attivita_rilevata,confermata")
        .eq("id", id).maybeSingle();
      if (findError || !current) bad("Sessione non trovata.", 404);
      if (current.tecnico_uid !== user.uid && user.profile.ruolo !== "admin") bad("Non autorizzato.", 403);

      const requestedCommessaId = String(body.commessaId || "").trim();
      let commessa:any = null;
      if (requestedCommessaId) {
        const { data: found, error: jobError } = await db.from("ore_commesse")
          .select("id,codice_lavoro,codice_commessa_crm,descrizione,cliente_id,tipologia_id")
          .eq("id", requestedCommessaId).maybeSingle();
        if (jobError || !found) bad("Commessa non valida.", 404);
        commessa = found;
      } else if (body.clienteId && body.tipologiaId) {
        commessa = await ensureTrackingJob(body.clienteId, body.tipologiaId, current.data_lavoro);
      } else {
        const { data: found, error: jobError } = await db.from("ore_commesse")
          .select("id,codice_lavoro,codice_commessa_crm,descrizione,cliente_id,tipologia_id")
          .eq("id", current.commessa_id).maybeSingle();
        if (jobError || !found) bad("Commessa non valida.", 404);
        commessa = found;
      }

      const motivo = String(body.motivo || "").trim().slice(0, 300) || null;
      const oggetto = body.oggetto === undefined ? current.crm_oggetto : String(body.oggetto || "").trim().slice(0, 500) || null;
      const attivita = body.attivitaRilevata === undefined ? current.attivita_rilevata : String(body.attivitaRilevata || "").trim().slice(0, 120) || null;

      const { error } = await db.from("ore_sessioni").update({
        commessa_id: commessa.id,
        minuti_effettivi: m,
        crm_oggetto: oggetto,
        attivita_rilevata: attivita,
        modificata_manualmente: true,
        motivo_modifica: motivo,
        confermata: false,
        confermata_at: null,
        updated_at: new Date().toISOString()
      }).eq("id", id);
      if (error) bad("Impossibile aggiornare la sessione.", 500);
      await writeAudit(db, user.uid, "modifica_sessione", "sessione", id, {
        minuti_prima: current.minuti_effettivi,
        minuti_dopo: m,
        commessa_prima: current.commessa_id,
        commessa_dopo: commessa.id,
        motivo
      });
      return json(req, { ok: true, commessa });
    }

    if (action === "addManual") {
      const day = dateOnly(body.date);
      const commessaId = String(body.commessaId || "");
      if (!commessaId) bad("Seleziona una commessa.");
      const m = minutes(body.minutiEffettivi);
      if (m === 0) bad("Inserisci una durata.");
      const { data, error } = await db.from("ore_sessioni").insert({
        commessa_id: commessaId,
        tecnico_uid: user.uid,
        tecnico_nome: `${user.profile.nome || ""} ${user.profile.cognome || ""}`.trim(),
        data_lavoro: day,
        minuti_agenda: 0,
        minuti_effettivi: m,
        origine: "manuale",
        crm_oggetto: String(body.oggetto || "Attività aggiunta manualmente").slice(0, 300),
        modificata_manualmente: true
      }).select("id").single();
      if (error) bad("Impossibile aggiungere l'attività.", 500);
      await writeAudit(db, user.uid, "aggiunta_manuale", "sessione", data.id, { minuti: m });
      return json(req, { ok: true, id: data.id });
    }

    if (action === "confirmDay") {
      const day=dateOnly(body.date);
      const {data,error}=await db.rpc("ore_conferma_giornata",{p_uid:user.uid,p_name:`${user.profile.nome||""} ${user.profile.cognome||""}`.trim(),p_day:day});
      if(error)bad(error.message||"Impossibile confermare la giornata.",409);
      return json(req,data);
    }

    if (action === "importPlanner") {
      requireAdmin(user);
      const rows = Array.isArray(body.commesse) ? body.commesse : [];
      if (!rows.length || rows.length > 600) bad("Export Planner non valido.");
      const classify = (value: unknown) => {
        const s = String(value || "").toUpperCase();
        if (s.includes("AGG DVR") || s.includes("AGGIORNAMENTO DVR")) return "B";
        if (s.includes("MMC") || s.includes("MOVIMENTAZIONE MANUALE")) {
          const hits = ["RUMORE","VIBRA","CHIMIC","VDT","MMC"].filter(k => s.includes(k)).length;
          return hits === 1 ? "C" : "P";
        }
        if (s.includes("CHIMIC")) return "D";
        if (s.includes("RUMORE")) return "E";
        if (s.includes("VIBRA")) return "F";
        if (s.includes("DUVRI") || s.includes("INFORMATIVA") || s.includes("ART.26") || s.includes("ART. 26")) return "G";
        if (s.includes("PEM") || s.includes("PIANO DI EMERGENZA") || s.includes("PIANO EMERGENZA")) return "H";
        if (s.includes("PLANIMETR")) return "I";
        if (s.includes("SOPRALLUOGO")) return "L";
        if (s.includes("SEGRETERIA") && (s.includes("FORMAZ") || s.includes("HACCP"))) return "N";
        if (["FORMAZIONE","ANTINCENDIO","PREPOSTI","RLS ","LAVORATORI 81/08","HACCP"].some(k => s.includes(k))) return "M";
        if (s.includes("FORFAIT") || s.includes("CONSULENZA")) return "O";
        if (/\\bDVR\\b/.test(s)) {
          if (["MACCHIN","VIDEOTERMIN","VDT","SLC","STRESS","CEM","MICROCLIMA","BIOLOGIC","TRAINO","SPINTA","MOV RIP"].some(k => s.includes(k))) return "P";
          return "A";
        }
        return "P";
      };

      const { data: currentClients, error: clientsError } = await db.from("ore_clienti").select("id,codice_breve,codice_crm,ragione_sociale");
      if (clientsError) bad("Impossibile leggere i clienti.", 500);
      const byCrm = new Map((currentClients || []).map((c:any) => [c.codice_crm, c]));
      let nextClient = Math.max(0, ...(currentClients || []).map((c:any) => Number(c.codice_breve)).filter(Number.isFinite)) + 1;
      let createdClients = 0, createdJobs = 0, updatedJobs = 0;

      const uniqueClientCodes = [...new Set(rows.map((r:any) => String(r.codiceCliente || "").trim()).filter(Boolean))];
      for (const codiceCrm of uniqueClientCodes) {
        if (byCrm.has(codiceCrm)) continue;
        const sample = rows.find((r:any) => String(r.codiceCliente || "").trim() === codiceCrm);
        const short = String(nextClient++).padStart(2, "0");
        const { data: inserted, error } = await db.from("ore_clienti").insert({
          codice_breve: short,
          codice_crm: codiceCrm,
          ragione_sociale: String(sample?.ragioneSociale || codiceCrm).trim() || codiceCrm
        }).select("id,codice_breve,codice_crm,ragione_sociale").single();
        if (error) bad("Impossibile creare un nuovo cliente.", 500);
        byCrm.set(codiceCrm, inserted);
        createdClients++;
      }

      for (const row of rows) {
        const codiceComm = String(row.codiceComm || "").trim();
        const codiceCliente = String(row.codiceCliente || "").trim();
        const descrizione = String(row.descrizioneComm || "").trim();
        if (!codiceComm || !codiceCliente || !descrizione) continue;
        const cliente = byCrm.get(codiceCliente);
        if (!cliente) continue;

        const { data: existingJob } = await db.from("ore_commesse").select("id,codice_breve").eq("codice_commessa_crm", codiceComm).maybeSingle();
        const tipCode = classify(descrizione);
        const { data: tip } = await db.from("ore_tipologie").select("id").eq("codice", tipCode).maybeSingle();
        const stato = String(row.statoComm || "").toUpperCase() === "CHIUSA" ? "completata" : "in_lavorazione";
        const codiceLavoro = String(Number(cliente.codice_breve)) + tipCode;
        const annoRaw = Number(String(row.data || "").slice(0,4));
        const anno = Number.isInteger(annoRaw) && annoRaw > 2000 ? annoRaw : null;

        if (existingJob) {
          const { error } = await db.from("ore_commesse").update({
            cliente_id: cliente.id,
            descrizione,
            tipologia_id: tip?.id || null,
            codice_lavoro: codiceLavoro,
            stato,
            anno,
            updated_at: new Date().toISOString()
          }).eq("id", existingJob.id);
          if (error) bad("Errore aggiornando una commessa.", 500);
          updatedJobs++;
          continue;
        }

        const { data: jobsForClient, error: listError } = await db.from("ore_commesse").select("codice_breve").eq("cliente_id", cliente.id);
        if (listError) bad("Impossibile assegnare il codice commessa.", 500);
        const seq = Math.max(0, ...(jobsForClient || []).map((j:any) => Number(String(j.codice_breve || "").split(".")[1])).filter(Number.isFinite)) + 1;
        const shortJob = `${cliente.codice_breve}.${String(seq).padStart(2,"0")}`;
        const { error } = await db.from("ore_commesse").insert({
          cliente_id: cliente.id,
          codice_breve: shortJob,
          codice_commessa_crm: codiceComm,
          descrizione,
          tipologia_id: tip?.id || null,
          codice_lavoro: codiceLavoro,
          stato,
          anno
        });
        if (error) bad("Errore creando una commessa.", 500);
        createdJobs++;
      }

      await writeAudit(db, user.uid, "import_planner", "planner", null, { rows: rows.length, createdClients, createdJobs, updatedJobs });
      return json(req, { ok: true, received: rows.length, createdClients, createdJobs, updatedJobs });
    }

    if (action === "importHistoryBatch") {
      requireAdmin(user);
      const rows = Array.isArray(body.rows) ? body.rows : [];
      if (!rows.length || rows.length > 600) bad("Lotto storico non valido.");
      let saved = 0, skipped = 0;
      for (const row of rows) {
        const codiceComm = String(row.codiceComm || "").trim();
        const dataLavoro = dateOnly(row.data);
        if (!codiceComm) { skipped++; continue; }
        const { data: job } = await db.from("ore_commesse").select("id").eq("codice_commessa_crm", codiceComm).maybeSingle();
        if (!job) { skipped++; continue; }

        const sigla = String(row.siglaRisorsa || row.nomeRisorsa || "storico").trim();
        const nome = String(row.nomeRisorsa || sigla).trim();
        const minsRaw = Number(row.minuti);
        const mins = Number.isFinite(minsRaw) ? Math.max(0, Math.round(minsRaw)) : 0;
        const eventId = String(row.eventId || "").trim();
        if (!eventId || mins <= 0) { skipped++; continue; }

        const start = row.inizio ? new Date(String(row.inizio)).toISOString() : null;
        const end = row.fine ? new Date(String(row.fine)).toISOString() : null;
        const payload = {
          commessa_id: job.id,
          tecnico_uid: `legacy:${sigla}`,
          tecnico_nome: nome,
          data_lavoro: dataLavoro,
          inizio: start,
          fine: end,
          minuti_agenda: mins,
          minuti_effettivi: mins,
          origine: "import_storico",
          crm_event_id: eventId,
          crm_oggetto: String(row.oggetto || row.descrizioneRiga || "").slice(0, 500) || null,
          modificata_manualmente: false,
          confermata: true,
          confermata_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };
        const { error } = await db.from("ore_sessioni").upsert(payload, { onConflict: "tecnico_uid,crm_event_id" });
        if (error) { skipped++; continue; }
        saved++;
      }
      await writeAudit(db, user.uid, "import_storico", "planner", null, { received: rows.length, saved, skipped });
      return json(req, { ok: true, received: rows.length, saved, skipped });
    }

    if (action === "crmResources") {
      requireAdmin(user);
      const [{ data, error }, { data: auditRows, error: auditErr }] = await Promise.all([
        db.from("ore_risorse_crm")
          .select("id,sigla_crm,nome_crm,tecnico_uid,tecnico_nome,attiva,ultima_sync")
          .eq("attiva", true)
          .order("nome_crm"),
        db.from("ore_audit")
          .select("azione,created_at,dettagli")
          .in("azione", ["crm_agent_heartbeat","sync_agende_azienda"])
          .order("created_at", { ascending: false })
          .limit(30)
      ]);
      if (error) bad("Impossibile caricare le risorse CRM.", 500);
      if (auditErr) bad("Impossibile caricare lo stato dell'agente CRM.", 500);

      const heartbeat:any = (auditRows || []).find((r:any)=>r.azione === "crm_agent_heartbeat") || null;
      const companySync:any = (auditRows || []).find((r:any)=>r.azione === "sync_agende_azienda") || null;
      return json(req, {
        resources: data || [],
        agent: heartbeat ? {
          heartbeat_at: heartbeat.created_at,
          state: heartbeat.dettagli?.state || "unknown",
          message: heartbeat.dettagli?.message || null,
          scanned: Number(heartbeat.dettagli?.scanned || 0),
          events: Number(heartbeat.dettagli?.events || 0),
          saved: Number(heartbeat.dettagli?.saved || 0),
          failures: Number(heartbeat.dettagli?.failures || 0),
          failure_details: Array.isArray(heartbeat.dettagli?.failure_details) ? heartbeat.dettagli.failure_details : [],
          agent_version: String(heartbeat.dettagli?.agent_version || "") || null
        } : null,
        companySync: companySync ? {
          completed_at: companySync.created_at,
          received: Number(companySync.dettagli?.received || 0),
          saved: Number(companySync.dettagli?.saved || 0),
          unmatched: Number(companySync.dettagli?.unmatched || 0),
          ambiguous: Number(companySync.dettagli?.ambiguous || 0),
          scanned_resources: Array.isArray(companySync.dettagli?.scanned_resources) ? companySync.dettagli.scanned_resources.length : 0
        } : null
      });
    }

    if (action === "crmAgentHeartbeat") {
      requireAdmin(user);
      const state = String(body.state || "").trim().toLowerCase();
      const allowed = new Set(["starting","running","ok","login_required","error"]);
      if (!allowed.has(state)) bad("Stato agente CRM non valido.");
      const details = {
        state,
        message: String(body.message || "").trim().slice(0, 300) || null,
        scanned: Math.max(0, Number(body.scanned || 0) || 0),
        events: Math.max(0, Number(body.events || 0) || 0),
        saved: Math.max(0, Number(body.saved || 0) || 0),
        failures: Math.max(0, Number(body.failures || 0) || 0),
        failure_details: (Array.isArray(body.failureDetails) ? body.failureDetails : []).slice(0, 12).map((x:any)=>({
          sigla: String(x?.sigla || "").trim().slice(0, 20),
          reason: String(x?.reason || "").trim().slice(0, 180)
        })).filter((x:any)=>x.sigla || x.reason),
        agent_version: String(body.agentVersion || "").trim().slice(0, 40) || null
      };
      await writeAudit(db,user.uid,"crm_agent_heartbeat","agent","company",details);
      return json(req,{ok:true,heartbeatAt:new Date().toISOString(),...details});
    }

    if (action === "ingestAgendaCompany") {
      requireAdmin(user);
      const events = Array.isArray(body.events) ? body.events : [];
      if (events.length > 1500) bad("Troppi eventi in una singola sincronizzazione aziendale.");

      const [
        { data: resources, error: resErr },
        { data: allClients, error: clientsErr },
        { data: allJobs, error: jobsErr }
      ] = await Promise.all([
        db.from("ore_risorse_crm")
          .select("id,sigla_crm,nome_crm,tecnico_uid,tecnico_nome,attiva")
          .eq("attiva", true),
        db.from("ore_clienti")
          .select("id,codice_breve,ragione_sociale")
          .eq("attivo", true)
          .limit(500),
        db.from("ore_commesse")
          .select("id,cliente_id,codice_breve,codice_lavoro,codice_commessa_crm,descrizione,stato,ore_tipologie(codice,nome)")
          .neq("stato","archiviata")
          .limit(2000)
      ]);
      if (resErr) bad("Impossibile caricare le risorse CRM.", 500);
      if (clientsErr || jobsErr) bad("Impossibile caricare l'anagrafica per la classificazione automatica.", 500);

      const norm = (v:any) => String(v || "").toLocaleLowerCase("it-IT")
        .normalize("NFD").replace(/[\u0300-\u036f]/g," ")
        .replace(/[^a-z0-9]+/g," ").replace(/\s+/g," ").trim();

      const words = (v:any) => norm(v).split(" ").filter(Boolean);
      const tokenSet = (v:any) => new Set(words(v));

      const CLIENT_ALIASES:Record<string,string[]> = {
        "01":["pam panorama","pam"], "02":["colligo"], "03":["stef"], "04":["interparking italia","interparking"],
        "05":["penske"], "06":["coin"], "07":["sipral","sipra"], "08":["loca top"], "09":["centro leonardo"],
        "10":["gb group"], "11":["people design"], "12":["centrolame","centro lame"], "13":["coop alleanza"],
        "14":["gemini"], "15":["melluso"], "16":["nuova darsena","darsena"], "17":["casa della mandorla","cdm"],
        "18":["pralinato"], "19":["zero3","zero 3"], "20":["centro cone","cone"], "21":["unione parmense"],
        "22":["millennium"], "23":["centroborgo"], "24":["centronova"], "25":["uni consulting"],
        "26":["coopit","studio eventi"], "27":["the crew"], "28":["hz"], "29":["truck top","trucktop"],
        "30":["igd"], "31":["devup"], "32":["gruppo pam"], "33":["autovanti"], "34":["vanti race"],
        "35":["daily"], "36":["micci"], "37":["act events"], "38":["unilog"], "39":["proloco casalecchio"],
        "40":["gksd"], "41":["teddy"], "42":["casa della solidarieta"], "43":["we love casalecchio"],
        "44":["re development"], "45":["alingi"], "46":["preven"], "47":["anaunia"], "48":["hz bijoux"],
        "49":["4 torri","autocarrozzeria 4 torri"], "50":["auto zatti","zatti"]
      };

      const CLIENT_STOP = new Set([
        "spa","srl","s","r","l","societa","soc","cooperativa","consorzio","proprietari","centro","commerciale",
        "italia","sede","di","del","dei","della","degli","group","gruppo","unico","unipersonale"
      ]);

      const detectType = (raw:string) => {
        const s = norm(raw);
        if (/\b(agg|aggiornamento|aggiornare)\b/.test(s) && /\bdvr\b/.test(s)) return "B";
        if (/\bmmc\b|movimentazione manuale/.test(s)) return "C";
        if (/chimic/.test(s)) return "D";
        if (/rumore/.test(s)) return "E";
        if (/vibraz/.test(s)) return "F";
        if (/\bduvri\b|informativa|art\s*26/.test(s)) return "G";
        if (/\bpem\b|piano .*emergenza|emergenza.*evacuazione/.test(s)) return "H";
        if (/planimetr/.test(s)) return "I";
        if (/sopralluog/.test(s)) return "L";
        if (/segreteria/.test(s) && /(formaz|haccp|corso)/.test(s)) return "N";
        if (/(formaz|docenza|corso|antincendio|prepost|\brls\b|haccp|lavoratori 81|dirigenti 81)/.test(s)) return "M";
        if (/forfait|consulenza|gestione cliente/.test(s)) return "O";
        if (/\bdvr\b/.test(s)) return "A";
        if (/\b(call|meeting|riunione)\b/.test(s)) return "O";
        return "";
      };

      const detectActivity = (raw:string,typeCode:string) => {
        const s = norm(raw);
        if (/trasfert|spostament|\bviaggi?\b|percorrenza/.test(s)) return "Trasferta";
        if (/riunione|meeting|call/.test(s)) return "Riunione";
        if (/sopralluog/.test(s)) return "Sopralluogo";
        if (typeCode === "M" || /formaz|docenza|corso/.test(s)) return "Formazione";
        if (/redaz|stesura|aggiornamento documento/.test(s)) return "Redazione documento";
        if (/segreteria/.test(s)) return "Segreteria";
        if (/consulenza|assistenza cliente|gestione cliente/.test(s)) return "Gestione cliente";
        return "";
      };

      const clientScore = (client:any, source:string) => {
        const s = " " + norm(source) + " ";
        let score = 0;
        const aliases = CLIENT_ALIASES[String(Number(client.codice_breve || 0)).padStart(2,"0")] || [];
        for (const alias of aliases) {
          const a = norm(alias);
          if (a && s.includes(" " + a + " ")) score = Math.max(score, a.includes(" ") ? 14 : 9);
        }
        const distinct = words(client.ragione_sociale).filter((w:string)=>w.length >= 4 && !CLIENT_STOP.has(w));
        for (const w of distinct) if (s.includes(" " + w + " ")) score += w.length >= 7 ? 6 : 4;
        return score;
      };

      const resolveClient = (source:string) => {
        const ranked = (allClients || []).map((c:any)=>({client:c,score:clientScore(c,source)}))
          .filter((x:any)=>x.score>0).sort((a:any,b:any)=>b.score-a.score);
        if (!ranked.length) return null;
        const best=ranked[0], second=ranked[1];
        if (best.score >= 7 && (!second || best.score-second.score >= 3)) return best.client;
        return null;
      };

      const GENERIC_JOB = new Set([
        "dvr","generale","specifico","agg","aggiornamento","pam","panorama","stef","coin","penske","sipral",
        "interparking","italia","spa","srl","anno","2025","2026","2027","formazione","corso","documento",
        "documenti","attivita","cliente","forfait","consulenza"
      ]);

      const scoreJob = (job:any, source:string, client:any, typeCode:string) => {
        const src = tokenSet(source);
        const desc = tokenSet(job.descrizione);
        const aliases = CLIENT_ALIASES[String(Number(client?.codice_breve || 0)).padStart(2,"0")] || [];
        const clientWords = new Set(aliases.flatMap((a:string)=>words(a)));
        let score = 0;
        for (const w of src) {
          if (w.length < 3 || GENERIC_JOB.has(w) || clientWords.has(w)) continue;
          if (desc.has(w)) score += w.length >= 6 ? 5 : 3;
        }
        if (typeCode && job.ore_tipologie?.codice === typeCode) score += 2;
        if (job.stato === "in_lavorazione") score += 1;
        const nd = norm(job.descrizione);
        const ns = norm(source);
        if (nd.length > 8 && ns.includes(nd)) score += 12;
        return score;
      };

      const chooseJob = (candidates:any[],source:string,client:any,typeCode:string) => {
        if (!candidates.length) return {job:null,ambiguous:[]};
        if (candidates.length === 1) return {job:candidates[0],ambiguous:[]};
        const clientIds = new Set(candidates.map((j:any)=>String(j.cliente_id || "")).filter(Boolean));
        const active = candidates.filter((j:any)=>j.stato === "in_lavorazione");
        if (clientIds.size === 1 && active.length === 1) return {job:active[0],ambiguous:[]};
        const ranked = candidates.map((j:any)=>({job:j,score:scoreJob(j,source,client,typeCode)}))
          .sort((a:any,b:any)=>b.score-a.score);
        const best=ranked[0], second=ranked[1];
        if (best.score >= 4 && (!second || best.score-second.score >= 2)) return {job:best.job,ambiguous:[]};
        return {job:null,ambiguous:ranked.slice(0,8).map((x:any)=>x.job)};
      };

      const compactCandidates = (candidates:any[]) => candidates.map((c:any)=>({
        id:c.id,codiceComm:c.codice_commessa_crm,descrizione:c.descrizione,stato:c.stato,codiceLavoro:c.codice_lavoro,
        clienteId:c.cliente_id||null,tipologiaId:c.tipologia_id||null
      }));

      const bySigla = new Map((resources || []).map((r:any)=>[String(r.sigla_crm || "").trim().toUpperCase(), r]));
      const byName = new Map((resources || []).map((r:any)=>[norm(r.nome_crm), r]));

      const getResource = async (ev:any) => {
        const sigla = String(ev.tecnicoSigla || ev.resourceCode || "").trim().toUpperCase();
        const nome = String(ev.tecnicoNome || ev.resourceName || "").trim();
        let r:any = (sigla && bySigla.get(sigla)) || (nome && byName.get(norm(nome))) || null;
        if (!r && sigla) {
          const { data, error } = await db.from("ore_risorse_crm").insert({
            sigla_crm: sigla,
            nome_crm: nome || sigla,
            tecnico_uid: null,
            tecnico_nome: null,
            attiva: true
          }).select("id,sigla_crm,nome_crm,tecnico_uid,tecnico_nome,attiva").single();
          if (error) bad("Impossibile registrare una nuova risorsa CRM.", 500);
          r = data;
          bySigla.set(sigla, r);
          byName.set(norm(r.nome_crm), r);
        }
        return r;
      };

      const saveIssue = async (targetUid:string, issue:any) => {
        if (issue.crm_event_id) {
          const { data: current } = await db.from("ore_sync_issues")
            .select("id")
            .eq("tecnico_uid", targetUid)
            .eq("crm_event_id", issue.crm_event_id)
            .maybeSingle();
          if (current?.id) {
            const { error } = await db.from("ore_sync_issues").update({
              ...issue,
              stato: "aperta",
              commessa_risolta_id: null,
              resolved_at: null,
              updated_at: new Date().toISOString()
            }).eq("id", current.id);
            if (error) bad("Impossibile salvare un'attività aziendale da verificare.", 500);
            return;
          }
        }
        const { error } = await db.from("ore_sync_issues").insert({
          ...issue,
          tecnico_uid: targetUid,
          stato: "aperta"
        });
        if (error) bad("Impossibile salvare un'attività aziendale da verificare.", 500);
      };

      const results:any[] = [];
      const touchedResources = new Set<string>();
      const scannedResources = Array.isArray(body.scannedResources) ? body.scannedResources : [];
      for (const raw of scannedResources) {
        const sigla = String(raw || "").trim().toUpperCase();
        const resource:any = sigla ? bySigla.get(sigla) : null;
        if (resource?.id) touchedResources.add(resource.id);
      }

      for (const ev of events) {
        const resource:any = await getResource(ev);
        if (!resource) {
          results.push({
            crmEventId: String(ev.crmEventId || ""),
            status: "resource_unmatched",
            tecnicoNome: String(ev.tecnicoNome || ""),
            tecnicoSigla: String(ev.tecnicoSigla || "")
          });
          continue;
        }

        const targetUid = String(resource.tecnico_uid || ("legacy:" + resource.sigla_crm));
        const targetName = String(resource.tecnico_nome || resource.nome_crm || resource.sigla_crm);
        touchedResources.add(resource.id);

        const crmEventId = String(ev.crmEventId || "").trim();
        const day = dateOnly(ev.date);
        const startIso = ev.start ? new Date(String(ev.start)).toISOString() : null;
        const endIso = ev.end ? new Date(String(ev.end)).toISOString() : null;
        let computed = Number(ev.minutes || 0);
        if (startIso && endIso) computed = Math.max(0, Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000));
        if (!Number.isInteger(computed) || computed < 0 || computed > 1440) computed = 0;

        const title=String(ev.title||ev.object||"").trim().slice(0,500);
        const commessaCrm=String(ev.codiceComm||"").trim().toUpperCase();
        const suppliedCode=String(ev.shortCode||"").trim().toUpperCase();
        const source=(suppliedCode+" "+title).trim();
        const typeCode=detectType(source);
        const activityDetected=detectActivity(source,typeCode);

        // A resource with no real account stays in review; no invented ownership.
        if (!resource.tecnico_uid || String(resource.tecnico_uid).startsWith("legacy:")) {
          await saveIssue("unassigned:" + resource.id, {
            crm_event_id: crmEventId || null, data_lavoro: day,
            inizio: startIso, fine: endIso, minuti: computed, titolo: title,
            codice_lavoro: suppliedCode || null, codice_commessa_crm: commessaCrm || null,
            attivita_rilevata: activityDetected || null, motivo: "unmatched",
            candidati: [{ resource_id: resource.id, sigla: resource.sigla_crm, collegamento: "da_verificare" }]
          });
          results.push({ crmEventId, status: "resource_unmatched", tecnicoNome: resource.nome_crm, tecnicoSigla: resource.sigla_crm });
          continue;
        }

        let commessa:any=null;
        let detectedWorkCode="";
        let detectedClient:any=null;
        let ambiguousCandidates:any[]=[];

        if(commessaCrm){
          commessa=(allJobs||[]).find((j:any)=>String(j.codice_commessa_crm||"").toUpperCase()===commessaCrm)||null;
        }

        const workMatch=source.toUpperCase().match(/\b(\d{1,2})([A-IL-P])\b/);
        const oldMatch=source.toUpperCase().match(/\b(\d{2}\.\d{2})(?:-[A-Z])?\b/);

        if(!commessa && oldMatch){
          commessa=(allJobs||[]).find((j:any)=>String(j.codice_breve||"")===oldMatch[1])||null;
        }

        if(!commessa && workMatch){
          detectedWorkCode=String(Number(workMatch[1]))+workMatch[2];
          detectedClient=(allClients||[]).find((c:any)=>Number(c.codice_breve)===Number(workMatch[1]))||null;
          const candidates=(allJobs||[]).filter((j:any)=>j.codice_lavoro===detectedWorkCode);
          const choice=chooseJob(candidates,source,detectedClient,workMatch[2]);
          commessa=choice.job;
          ambiguousCandidates=choice.ambiguous;
        }

        if(!commessa && !workMatch){
          detectedClient=resolveClient(source);
          if(detectedClient && typeCode) detectedWorkCode=String(Number(detectedClient.codice_breve))+typeCode;

          let candidates=(allJobs||[]).filter((j:any)=>{
            if(detectedClient && j.cliente_id!==detectedClient.id) return false;
            if(typeCode && j.ore_tipologie?.codice!==typeCode) return false;
            return true;
          });

          if(!detectedClient && !typeCode){
            candidates=[];
          } else if(!detectedClient && typeCode){
            candidates=candidates.filter((j:any)=>scoreJob(j,source,null,typeCode)>=5);
          }

          const choice=chooseJob(candidates,source,detectedClient,typeCode);
          commessa=choice.job;
          ambiguousCandidates=choice.ambiguous;
        }

        if(!commessa){
          const cc=compactCandidates(ambiguousCandidates);
          await saveIssue(targetUid,{
            crm_event_id:crmEventId||null,
            data_lavoro:day,
            inizio:startIso,
            fine:endIso,
            minuti:computed,
            titolo:title,
            codice_lavoro:detectedWorkCode||null,
            codice_commessa_crm:commessaCrm||null,
            attivita_rilevata:activityDetected||null,
            motivo:cc.length?"ambiguous":"unmatched",
            candidati:cc
          });
          results.push({
            crmEventId,
            status:cc.length?"ambiguous":"unmatched",
            tecnicoUid:targetUid,
            tecnicoNome:targetName,
            title,
            workCode:detectedWorkCode||null,
            activity:activityDetected||null,
            client:detectedClient?.ragione_sociale||null,
            candidates:cc
          });
          continue;
        }

        const payload:any = {
          crm_risorsa_id: resource.id,
          commessa_id: commessa.id,
          tecnico_uid: targetUid,
          tecnico_nome: targetName,
          data_lavoro: day,
          inizio: startIso,
          fine: endIso,
          minuti_agenda: computed,
          minuti_effettivi: computed,
          origine: "crm_agenda",
          crm_event_id: crmEventId || null,
          crm_oggetto: title || null,
          attivita_rilevata: activityDetected || null,
          modificata_manualmente: false,
          motivo_modifica: null,
          confermata: false,
          confermata_at: null,
          updated_at: new Date().toISOString()
        };

        let saved:any = null, saveError:any = null;
        if (crmEventId) {
          const up = await db.from("ore_sessioni").upsert(payload, { onConflict: "tecnico_uid,crm_event_id" }).select("id").single();
          saved = up.data; saveError = up.error;
        } else {
          const ins = await db.from("ore_sessioni").insert(payload).select("id").single();
          saved = ins.data; saveError = ins.error;
        }
        if (saveError) {
          results.push({crmEventId,status:"error",tecnicoUid:targetUid,tecnicoNome:targetName,error:saveError.message});
          continue;
        }

        if (crmEventId) {
          await db.from("ore_sync_issues").update({
            stato:"risolta",
            commessa_risolta_id:commessa.id,
            resolved_at:new Date().toISOString(),
            updated_at:new Date().toISOString()
          }).in("tecnico_uid",[targetUid,"unassigned:"+resource.id]).eq("crm_event_id",crmEventId);
        }

        results.push({
          crmEventId,status:"saved",id:saved.id,tecnicoUid:targetUid,tecnicoNome:targetName,
          codiceLavoro:commessa.codice_lavoro,codiceComm:commessa.codice_commessa_crm,minutes:computed,
          activity:activityDetected||null,
          classifiedWithoutCode:!suppliedCode&&!commessaCrm
        });
      }

      const now = new Date().toISOString();
      for (const id of touchedResources) {
        await db.from("ore_risorse_crm").update({ultima_sync:now,updated_at:now}).eq("id",id);
      }

      const savedCount = results.filter(x=>x.status==="saved").length;
      const unmatchedCount = results.filter(x=>x.status==="unmatched").length;
      const ambiguousCount = results.filter(x=>x.status==="ambiguous").length;
      const resourceUnmatched = results.filter(x=>x.status==="resource_unmatched").length;
      const autoClassified = results.filter(x=>x.status==="saved"&&x.classifiedWithoutCode).length;
      const resourceNames = [...new Set(results.map(x=>x.tecnicoNome).filter(Boolean))];

      await writeAudit(db,user.uid,"sync_agende_azienda","agenda",String(body.date||""),{
        received:events.length,
        saved:savedCount,
        unmatched:unmatchedCount,
        ambiguous:ambiguousCount,
        resource_unmatched:resourceUnmatched,
        auto_classified:autoClassified,
        resources:resourceNames,
        scanned_resources:[...scannedResources]
      });

      return json(req,{
        ok:true,
        received:events.length,
        saved:savedCount,
        unmatched:unmatchedCount,
        ambiguous:ambiguousCount,
        resourceUnmatched,
        autoClassified,
        resources:resourceNames.length,
        scannedResources:touchedResources.size,
        results
      });
    }

    if (action === "ingestAgenda") {
      const callerResource:any = await bindCallerResource(db,user);
      const events = Array.isArray(body.events) ? body.events : [];
      if (events.length > 100) bad("Troppi eventi in una singola sincronizzazione.");

      const [{ data: allClients, error: clientsErr }, { data: allJobs, error: jobsErr }] = await Promise.all([
        db.from("ore_clienti").select("id,codice_breve,ragione_sociale").eq("attivo",true).limit(500),
        db.from("ore_commesse")
          .select("id,cliente_id,codice_breve,codice_lavoro,codice_commessa_crm,descrizione,stato,ore_tipologie(codice,nome)")
          .neq("stato","archiviata").limit(2000)
      ]);
      if (clientsErr || jobsErr) bad("Impossibile caricare l'anagrafica per la classificazione automatica.",500);

      const norm = (v:any) => String(v || "").toLocaleLowerCase("it-IT")
        .normalize("NFD").replace(/[\u0300-\u036f]/g," ")
        .replace(/[^a-z0-9]+/g," ").replace(/\s+/g," ").trim();

      const words = (v:any) => norm(v).split(" ").filter(Boolean);
      const tokenSet = (v:any) => new Set(words(v));

      const CLIENT_ALIASES:Record<string,string[]> = {
        "01":["pam panorama","pam"], "02":["colligo"], "03":["stef"], "04":["interparking italia","interparking"],
        "05":["penske"], "06":["coin"], "07":["sipral","sipra"], "08":["loca top"], "09":["centro leonardo"],
        "10":["gb group"], "11":["people design"], "12":["centrolame","centro lame"], "13":["coop alleanza"],
        "14":["gemini"], "15":["melluso"], "16":["nuova darsena","darsena"], "17":["casa della mandorla","cdm"],
        "18":["pralinato"], "19":["zero3","zero 3"], "20":["centro cone","cone"], "21":["unione parmense"],
        "22":["millennium"], "23":["centroborgo"], "24":["centronova"], "25":["uni consulting"],
        "26":["coopit","studio eventi"], "27":["the crew"], "28":["hz"], "29":["truck top","trucktop"],
        "30":["igd"], "31":["devup"], "32":["gruppo pam"], "33":["autovanti"], "34":["vanti race"],
        "35":["daily"], "36":["micci"], "37":["act events"], "38":["unilog"], "39":["proloco casalecchio"],
        "40":["gksd"], "41":["teddy"], "42":["casa della solidarieta"], "43":["we love casalecchio"],
        "44":["re development"], "45":["alingi"], "46":["preven"], "47":["anaunia"], "48":["hz bijoux"],
        "49":["4 torri","autocarrozzeria 4 torri"], "50":["auto zatti","zatti"]
      };

      const CLIENT_STOP = new Set([
        "spa","srl","s","r","l","societa","soc","cooperativa","consorzio","proprietari","centro","commerciale",
        "italia","sede","di","del","dei","della","degli","group","gruppo","unico","unipersonale"
      ]);

      const detectType = (raw:string) => {
        const s = norm(raw);
        if (/\b(agg|aggiornamento|aggiornare)\b/.test(s) && /\bdvr\b/.test(s)) return "B";
        if (/\bmmc\b|movimentazione manuale/.test(s)) return "C";
        if (/chimic/.test(s)) return "D";
        if (/rumore/.test(s)) return "E";
        if (/vibraz/.test(s)) return "F";
        if (/\bduvri\b|informativa|art\s*26/.test(s)) return "G";
        if (/\bpem\b|piano .*emergenza|emergenza.*evacuazione/.test(s)) return "H";
        if (/planimetr/.test(s)) return "I";
        if (/sopralluog/.test(s)) return "L";
        if (/segreteria/.test(s) && /(formaz|haccp|corso)/.test(s)) return "N";
        if (/(formaz|docenza|corso|antincendio|prepost|\brls\b|haccp|lavoratori 81|dirigenti 81)/.test(s)) return "M";
        if (/forfait|consulenza|gestione cliente/.test(s)) return "O";
        if (/\bdvr\b/.test(s)) return "A";
        if (/\b(call|meeting|riunione)\b/.test(s)) return "O";
        return "";
      };

      const detectActivity = (raw:string,typeCode:string) => {
        const s = norm(raw);
        if (/trasfert|spostament|\bviaggi?\b|percorrenza/.test(s)) return "Trasferta";
        if (/riunione|meeting|call/.test(s)) return "Riunione";
        if (/sopralluog/.test(s)) return "Sopralluogo";
        if (typeCode === "M" || /formaz|docenza|corso/.test(s)) return "Formazione";
        if (/redaz|stesura|aggiornamento documento/.test(s)) return "Redazione documento";
        if (/segreteria/.test(s)) return "Segreteria";
        if (/consulenza|assistenza cliente|gestione cliente/.test(s)) return "Gestione cliente";
        return "";
      };

      const clientScore = (client:any, source:string) => {
        const s = " " + norm(source) + " ";
        let score = 0;
        const aliases = CLIENT_ALIASES[String(Number(client.codice_breve || 0)).padStart(2,"0")] || [];
        for (const alias of aliases) {
          const a = norm(alias);
          if (a && s.includes(" " + a + " ")) score = Math.max(score, a.includes(" ") ? 14 : 9);
        }
        const distinct = words(client.ragione_sociale).filter((w:string)=>w.length >= 4 && !CLIENT_STOP.has(w));
        for (const w of distinct) if (s.includes(" " + w + " ")) score += w.length >= 7 ? 6 : 4;
        return score;
      };

      const resolveClient = (source:string) => {
        const ranked = (allClients || []).map((c:any)=>({client:c,score:clientScore(c,source)}))
          .filter((x:any)=>x.score>0).sort((a:any,b:any)=>b.score-a.score);
        if (!ranked.length) return null;
        const best=ranked[0], second=ranked[1];
        if (best.score >= 7 && (!second || best.score-second.score >= 3)) return best.client;
        return null;
      };

      const GENERIC_JOB = new Set([
        "dvr","generale","specifico","agg","aggiornamento","pam","panorama","stef","coin","penske","sipral",
        "interparking","italia","spa","srl","anno","2025","2026","2027","formazione","corso","documento",
        "documenti","attivita","cliente","forfait","consulenza"
      ]);

      const scoreJob = (job:any, source:string, client:any, typeCode:string) => {
        const src = tokenSet(source);
        const desc = tokenSet(job.descrizione);
        const aliases = CLIENT_ALIASES[String(Number(client?.codice_breve || 0)).padStart(2,"0")] || [];
        const clientWords = new Set(aliases.flatMap((a:string)=>words(a)));
        let score = 0;
        for (const w of src) {
          if (w.length < 3 || GENERIC_JOB.has(w) || clientWords.has(w)) continue;
          if (desc.has(w)) score += w.length >= 6 ? 5 : 3;
        }
        if (typeCode && job.ore_tipologie?.codice === typeCode) score += 2;
        if (job.stato === "in_lavorazione") score += 1;
        const nd = norm(job.descrizione);
        const ns = norm(source);
        if (nd.length > 8 && ns.includes(nd)) score += 12;
        return score;
      };

      const chooseJob = (candidates:any[],source:string,client:any,typeCode:string) => {
        if (!candidates.length) return {job:null,ambiguous:[]};
        if (candidates.length === 1) return {job:candidates[0],ambiguous:[]};
        const clientIds = new Set(candidates.map((j:any)=>String(j.cliente_id || "")).filter(Boolean));
        const active = candidates.filter((j:any)=>j.stato === "in_lavorazione");
        if (clientIds.size === 1 && active.length === 1) return {job:active[0],ambiguous:[]};
        const ranked = candidates.map((j:any)=>({job:j,score:scoreJob(j,source,client,typeCode)}))
          .sort((a:any,b:any)=>b.score-a.score);
        const best=ranked[0], second=ranked[1];
        if (best.score >= 4 && (!second || best.score-second.score >= 2)) return {job:best.job,ambiguous:[]};
        return {job:null,ambiguous:ranked.slice(0,8).map((x:any)=>x.job)};
      };

      const compactCandidates = (candidates:any[]) => candidates.map((c:any)=>({
        id:c.id,codiceComm:c.codice_commessa_crm,descrizione:c.descrizione,stato:c.stato,codiceLavoro:c.codice_lavoro,
        clienteId:c.cliente_id||null,tipologiaId:c.tipologia_id||null
      }));

      const saveIssue = async (issue:any) => {
        if (issue.crm_event_id) {
          const { data: current } = await db.from("ore_sync_issues")
            .select("id").eq("tecnico_uid", user.uid).eq("crm_event_id", issue.crm_event_id).maybeSingle();
          if (current?.id) {
            const { error } = await db.from("ore_sync_issues").update({
              ...issue,stato:"aperta",commessa_risolta_id:null,resolved_at:null,updated_at:new Date().toISOString()
            }).eq("id", current.id);
            if (error) bad("Impossibile salvare un'attività da verificare.",500);
            return;
          }
        }
        const { error } = await db.from("ore_sync_issues").insert({...issue,tecnico_uid:user.uid,stato:"aperta"});
        if (error) bad("Impossibile salvare un'attività da verificare.",500);
      };

      const resolveIssueIfPresent = async (crmEventId:string, commessaId:string) => {
        if (!crmEventId) return;
        await db.from("ore_sync_issues").update({
          stato:"risolta",commessa_risolta_id:commessaId,resolved_at:new Date().toISOString(),updated_at:new Date().toISOString()
        }).eq("tecnico_uid",user.uid).eq("crm_event_id",crmEventId);
      };

      const results:any[] = [];
      for (const ev of events) {
        const crmEventId=String(ev.crmEventId||"").trim();
        const day=dateOnly(ev.date);
        const startIso=ev.start ? new Date(String(ev.start)).toISOString() : null;
        const endIso=ev.end ? new Date(String(ev.end)).toISOString() : null;
        let computed=Number(ev.minutes||0);
        if(startIso&&endIso) computed=Math.max(0,Math.round((new Date(endIso).getTime()-new Date(startIso).getTime())/60000));
        if(!Number.isInteger(computed)||computed<0||computed>1440) computed=0;

        const title=String(ev.title||ev.object||"").trim().slice(0,500);
        const commessaCrm=String(ev.codiceComm||"").trim().toUpperCase();
        const suppliedCode=String(ev.shortCode||"").trim().toUpperCase();
        const source=(suppliedCode+" "+title).trim();
        const typeCode=detectType(source);
        const activityDetected=detectActivity(source,typeCode);

        let commessa:any=null;
        let detectedWorkCode="";
        let detectedClient:any=null;
        let ambiguousCandidates:any[]=[];

        if(commessaCrm){
          commessa=(allJobs||[]).find((j:any)=>String(j.codice_commessa_crm||"").toUpperCase()===commessaCrm)||null;
        }

        const workMatch=source.toUpperCase().match(/\b(\d{1,2})([A-IL-P])\b/);
        const oldMatch=source.toUpperCase().match(/\b(\d{2}\.\d{2})(?:-[A-Z])?\b/);

        if(!commessa && oldMatch){
          commessa=(allJobs||[]).find((j:any)=>String(j.codice_breve||"")===oldMatch[1])||null;
        }

        if(!commessa && workMatch){
          detectedWorkCode=String(Number(workMatch[1]))+workMatch[2];
          detectedClient=(allClients||[]).find((c:any)=>Number(c.codice_breve)===Number(workMatch[1]))||null;
          const candidates=(allJobs||[]).filter((j:any)=>j.codice_lavoro===detectedWorkCode);
          const choice=chooseJob(candidates,source,detectedClient,workMatch[2]);
          commessa=choice.job;
          ambiguousCandidates=choice.ambiguous;
        }

        if(!commessa && !workMatch){
          detectedClient=resolveClient(source);
          if(detectedClient && typeCode) detectedWorkCode=String(Number(detectedClient.codice_breve))+typeCode;

          let candidates=(allJobs||[]).filter((j:any)=>{
            if(detectedClient && j.cliente_id!==detectedClient.id) return false;
            if(typeCode && j.ore_tipologie?.codice!==typeCode) return false;
            return true;
          });

          if(!detectedClient && !typeCode){
            candidates=[];
          } else if(!detectedClient && typeCode){
            candidates=candidates.filter((j:any)=>scoreJob(j,source,null,typeCode)>=5);
          }

          const choice=chooseJob(candidates,source,detectedClient,typeCode);
          commessa=choice.job;
          ambiguousCandidates=choice.ambiguous;
        }

        if(!commessa){
          const cc=compactCandidates(ambiguousCandidates);
          await saveIssue({
            crm_event_id:crmEventId||null,data_lavoro:day,inizio:startIso,fine:endIso,minuti:computed,titolo:title,
            codice_lavoro:detectedWorkCode||null,codice_commessa_crm:commessaCrm||null,
            attivita_rilevata:activityDetected||null,
            motivo:cc.length?"ambiguous":"unmatched",candidati:cc
          });
          results.push({
            crmEventId,status:cc.length?"ambiguous":"unmatched",title,
            workCode:detectedWorkCode||null,activity:activityDetected||null,
            client:detectedClient?.ragione_sociale||null,candidates:cc
          });
          continue;
        }

        const payload:any={
          commessa_id:commessa.id,tecnico_uid:user.uid,
          tecnico_nome:`${user.profile.nome||""} ${user.profile.cognome||""}`.trim(),
          data_lavoro:day,inizio:startIso,fine:endIso,minuti_agenda:computed,minuti_effettivi:computed,
          origine:"crm_agenda",crm_event_id:crmEventId||null,crm_oggetto:title||null,
          attivita_rilevata:activityDetected||null,
          modificata_manualmente:false,motivo_modifica:null,confermata:false,confermata_at:null,updated_at:new Date().toISOString()
        };

        let saved:any=null,saveError:any=null;
        if(crmEventId){
          const up=await db.from("ore_sessioni").upsert(payload,{onConflict:"tecnico_uid,crm_event_id"}).select("id").single();
          saved=up.data;saveError=up.error;
        } else {
          const ins=await db.from("ore_sessioni").insert(payload).select("id").single();
          saved=ins.data;saveError=ins.error;
        }
        if(saveError){
          results.push({crmEventId,status:"error",error:saveError.message});
          continue;
        }

        await resolveIssueIfPresent(crmEventId,commessa.id);
        results.push({
          crmEventId,status:"saved",id:saved.id,codiceLavoro:commessa.codice_lavoro,
          codiceComm:commessa.codice_commessa_crm,minutes:computed,activity:activityDetected||null,
          classifiedWithoutCode:!suppliedCode&&!commessaCrm
        });
      }

      const savedCount=results.filter(x=>x.status==="saved").length;
      const unmatchedCount=results.filter(x=>x.status==="unmatched").length;
      const ambiguousCount=results.filter(x=>x.status==="ambiguous").length;
      await writeAudit(db,user.uid,"sync_agenda","agenda",String(body.date||""),{
        received:events.length,saved:savedCount,unmatched:unmatchedCount,ambiguous:ambiguousCount,
        auto_classified:results.filter(x=>x.status==="saved"&&x.classifiedWithoutCode).length
      });
      if(callerResource?.id){
        await db.from("ore_risorse_crm").update({
          tecnico_uid:user.uid,tecnico_nome:`${user.profile.nome||""} ${user.profile.cognome||""}`.trim(),
          ultima_sync:new Date().toISOString(),updated_at:new Date().toISOString()
        }).eq("id",callerResource.id);
      }

      return json(req,{
        ok:true,received:events.length,saved:savedCount,unmatched:unmatchedCount,ambiguous:ambiguousCount,
        autoClassified:results.filter(x=>x.status==="saved"&&x.classifiedWithoutCode).length,results
      });
    }

    if (action === "syncStatus") {
      const callerResource:any = await bindCallerResource(db,user);
      const day = body.date ? dateOnly(body.date) : null;
      const { data: lastSync } = await db.from("ore_audit")
        .select("created_at,dettagli,entita_id")
        .eq("tecnico_uid", user.uid)
        .eq("azione", "sync_agenda")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      let q = db.from("ore_sync_issues")
        .select("id,crm_event_id,data_lavoro,inizio,fine,minuti,titolo,codice_lavoro,codice_commessa_crm,attivita_rilevata,motivo,candidati,stato")
        .eq("tecnico_uid", user.uid)
        .eq("stato", "aperta")
        .order("data_lavoro", { ascending: false })
        .order("inizio", { ascending: true })
        .limit(50);
      if (day) q = q.eq("data_lavoro", day);
      const { data: issues, error } = await q;
      if (error) bad("Impossibile caricare lo stato della sincronizzazione.", 500);

      return json(req, {
        lastSync: lastSync || null,
        openIssues: issues || [],
        resource: callerResource ? {
          sigla: callerResource.sigla_crm,
          nome: callerResource.nome_crm,
          tecnico_nome: callerResource.tecnico_nome,
          ultima_sync: callerResource.ultima_sync || null
        } : null
      });
    }

    if (action === "resolveSyncIssue") {
      const issueId = String(body.issueId || "").trim();
      const commessaId = String(body.commessaId || "").trim();
      const clienteId = String(body.clienteId || "").trim();
      const tipologiaId = String(body.tipologiaId || "").trim();
      if (!issueId || (!commessaId && !(clienteId && tipologiaId))) bad("Seleziona una commessa oppure cliente e tipologia.");

      const { data: issue, error: issueError } = await db.from("ore_sync_issues")
        .select("*")
        .eq("id", issueId)
        .eq("tecnico_uid", user.uid)
        .eq("stato", "aperta")
        .maybeSingle();
      if (issueError || !issue) bad("Attività da verificare non trovata.", 404);

      let commessa:any = null;
      if (commessaId) {
        const { data: found, error: jobError } = await db.from("ore_commesse")
          .select("id,codice_lavoro,codice_commessa_crm,descrizione,cliente_id,tipologia_id")
          .eq("id", commessaId)
          .maybeSingle();
        if (jobError || !found) bad("Commessa non valida.", 404);
        commessa = found;
      } else {
        commessa = await ensureTrackingJob(clienteId, tipologiaId, issue.data_lavoro);
      }

      const effectiveMinutes = body.minutiEffettivi === undefined ? Number(issue.minuti || 0) : minutes(body.minutiEffettivi);
      const editedTitle = body.oggetto === undefined ? issue.titolo : String(body.oggetto || "").trim().slice(0, 500) || issue.titolo;
      const editedActivity = body.attivitaRilevata === undefined
        ? (issue.attivita_rilevata || null)
        : String(body.attivitaRilevata || "").trim().slice(0, 120) || null;
      const changed = effectiveMinutes !== Number(issue.minuti || 0) || editedTitle !== issue.titolo || editedActivity !== (issue.attivita_rilevata || null);

      const payload = {
        commessa_id: commessa.id,
        tecnico_uid: user.uid,
        tecnico_nome: `${user.profile.nome || ""} ${user.profile.cognome || ""}`.trim(),
        data_lavoro: issue.data_lavoro,
        inizio: issue.inizio,
        fine: issue.fine,
        minuti_agenda: issue.minuti,
        minuti_effettivi: effectiveMinutes,
        origine: "crm_agenda",
        crm_event_id: issue.crm_event_id,
        crm_oggetto: editedTitle,
        attivita_rilevata: editedActivity,
        modificata_manualmente: changed,
        motivo_modifica: changed ? "Correzione manuale attività importata dal CRM" : null,
        confermata: false,
        confermata_at: null,
        updated_at: new Date().toISOString()
      };

      let session:any = null, saveError:any = null;
      if (issue.crm_event_id) {
        const up = await db.from("ore_sessioni").upsert(payload, { onConflict: "tecnico_uid,crm_event_id" }).select("id").single();
        session = up.data; saveError = up.error;
      } else {
        const ins = await db.from("ore_sessioni").insert(payload).select("id").single();
        session = ins.data; saveError = ins.error;
      }
      if (saveError) bad("Impossibile salvare l'attività.", 500);

      const now = new Date().toISOString();
      const { error: updateError } = await db.from("ore_sync_issues").update({
        stato: "risolta",
        commessa_risolta_id: commessa.id,
        resolved_at: now,
        updated_at: now
      }).eq("id", issue.id);
      if (updateError) bad("Attività salvata, ma stato di verifica non aggiornato.", 500);

      await writeAudit(db, user.uid, "risolvi_sync", "sync_issue", issue.id, {
        commessa_id: commessa.id,
        codice_lavoro: commessa.codice_lavoro,
        codice_commessa_crm: commessa.codice_commessa_crm
      });

      return json(req, { ok: true, sessionId: session.id, commessa });
    }

    if (action === "economicsCatalog") {
      requireAdmin(user);

      const [{ data: sessionTechs, error: techErr }, { data: rates, error: rateErr }, { data: jobs, error: jobsErr }] = await Promise.all([
        readAll(()=>db.from("ore_sessioni")
          .select("tecnico_uid,tecnico_nome")
          .order("tecnico_nome")),
        db.from("ore_costi_tecnici")
          .select("id,tecnico_uid,tecnico_nome,costo_orario,valido_dal,valido_al,note,updated_at")
          .order("valido_dal", { ascending: false })
          .limit(1000),
        db.from("ore_commesse")
          .select("id,codice_lavoro,codice_commessa_crm,descrizione,stato,budget_ore,costi_esterni,valore_vendita,note_economiche,ore_clienti(codice_breve,ragione_sociale),ore_tipologie(codice,nome)")
          .neq("stato", "archiviata")
          .order("descrizione")
          .limit(1000)
      ]);
      if (techErr || rateErr || jobsErr) bad("Impossibile caricare i dati economici.", 500);

      const techMap = new Map<string, any>();
      for (const t of attributeIdentity(sessionTechs || [],identityAliases)) {
        const name = String(t.tecnico_nome || t.tecnico_uid || "").trim();
        const key = String(t.tecnico_uid||"");
        if (!key) continue;
        const prev = techMap.get(key);
        const uid = String(t.tecnico_uid || "");
        if (!prev || (!uid.startsWith("legacy:") && String(prev.tecnico_uid || "").startsWith("legacy:"))) {
          techMap.set(key, { tecnico_uid: uid, tecnico_nome: name });
        }
      }

      return json(req, {
        technicians: [...techMap.values()],
        rates: rates || [],
        jobs: jobs || []
      });
    }

    if (action === "saveTechnicianCost") {
      requireAdmin(user);
      const tecnicoUid = String(body.tecnicoUid || "").trim();
      const tecnicoNome = String(body.tecnicoNome || "").trim().slice(0, 200);
      const costoOrario = Number(body.costoOrario);
      const validoDal = dateOnly(body.validoDal);
      const validoAl = body.validoAl ? dateOnly(body.validoAl) : null;
      const note = String(body.note || "").trim().slice(0, 500) || null;

      if (!tecnicoUid) bad("Tecnico non valido.");
      if (!Number.isFinite(costoOrario) || costoOrario < 0 || costoOrario > 1000) bad("Costo orario non valido.");
      if (validoAl && validoAl < validoDal) bad("La data finale non può precedere quella iniziale.");

      const { data, error } = await db.from("ore_costi_tecnici").upsert({
        tecnico_uid: tecnicoUid,
        tecnico_nome: tecnicoNome || null,
        costo_orario: Math.round(costoOrario * 100) / 100,
        valido_dal: validoDal,
        valido_al: validoAl,
        note,
        updated_at: new Date().toISOString()
      }, { onConflict: "tecnico_uid,valido_dal" }).select("id").single();

      if (error) bad("Impossibile salvare il costo orario.", 500);
      await writeAudit(db, user.uid, "costo_tecnico", "tecnico", tecnicoUid, {
        costo_orario: costoOrario,
        valido_dal: validoDal,
        valido_al: validoAl
      });
      return json(req, { ok: true, id: data.id });
    }

    if (action === "saveJobEconomics") {
      requireAdmin(user);
      const commessaId = String(body.commessaId || "").trim();
      if (!commessaId) bad("Commessa non valida.");

      const nullableMoney = (v:any, label:string) => {
        if (v === null || v === undefined || String(v).trim() === "") return null;
        const n = Number(v);
        if (!Number.isFinite(n) || n < 0 || n > 100000000) bad(label + " non valido.");
        return Math.round(n * 100) / 100;
      };
      const nullableHours = (v:any) => {
        if (v === null || v === undefined || String(v).trim() === "") return null;
        const n = Number(v);
        if (!Number.isFinite(n) || n < 0 || n > 100000) bad("Budget ore non valido.");
        return Math.round(n * 100) / 100;
      };

      const valoreVendita = nullableMoney(body.valoreVendita, "Valore venduto");
      const costiEsterni = nullableMoney(body.costiEsterni, "Costi esterni") ?? 0;
      const budgetOre = nullableHours(body.budgetOre);
      const noteEconomiche = String(body.noteEconomiche || "").trim().slice(0, 1000) || null;

      const { data: before } = await db.from("ore_commesse")
        .select("valore_vendita,costi_esterni,budget_ore,note_economiche")
        .eq("id", commessaId).maybeSingle();

      const { error } = await db.from("ore_commesse").update({
        valore_vendita: valoreVendita,
        costi_esterni: costiEsterni,
        budget_ore: budgetOre,
        note_economiche: noteEconomiche,
        updated_at: new Date().toISOString()
      }).eq("id", commessaId);
      if (error) bad("Impossibile salvare i dati economici della commessa.", 500);

      await writeAudit(db, user.uid, "economia_commessa", "commessa", commessaId, {
        prima: before || null,
        dopo: { valore_vendita: valoreVendita, costi_esterni: costiEsterni, budget_ore: budgetOre }
      });
      return json(req, { ok: true });
    }

    if (action === "adminEconomics") {
      requireAdmin(user);

      const [{ data: sessions, error: sessionsErr }, { data: rates, error: ratesErr }] = await Promise.all([
        readAll(()=>db.from("ore_sessioni")
          .select("tecnico_uid,tecnico_nome,data_lavoro,minuti_effettivi,commessa_id,ore_commesse(codice_lavoro,codice_commessa_crm,descrizione,stato,budget_ore,costi_esterni,valore_vendita,ore_clienti(codice_breve,ragione_sociale),ore_tipologie(codice,nome))")
        ),
        db.from("ore_costi_tecnici")
          .select("tecnico_uid,tecnico_nome,costo_orario,valido_dal,valido_al")
          .order("valido_dal", { ascending: false })
          .limit(2000)
      ]);
      if (sessionsErr || ratesErr) bad("Impossibile calcolare i dati economici.", 500);

      const normalizeName = (v:any) => String(v || "").trim().toLocaleLowerCase("it-IT");
      const byUid = new Map<string, any[]>();
      const byName = new Map<string, any[]>();
      for (const r of attributeIdentity(rates || [],identityAliases)) {
        const uid = String(r.tecnico_uid || "");
        if (uid) {
          const a = byUid.get(uid) || [];
          a.push(r); byUid.set(uid, a);
        }
        const nk = normalizeName(r.tecnico_nome);
        if (nk) {
          const a = byName.get(nk) || [];
          a.push(r); byName.set(nk, a);
        }
      }

      const applicableRate = (s:any) => {
        const date = String(s.data_lavoro || "");
        const candidates = [
          ...(byUid.get(String(s.tecnico_uid || "")) || [])
        ];
        const seen = new Set<string>();
        for (const r of candidates) {
          const key = String(r.tecnico_uid || "") + "|" + String(r.valido_dal || "");
          if (seen.has(key)) continue;
          seen.add(key);
          const from = String(r.valido_dal || "");
          const to = r.valido_al ? String(r.valido_al) : null;
          if (from <= date && (!to || to >= date)) return Number(r.costo_orario || 0);
        }
        return null;
      };

      const jobs = new Map<string, any>();
      const costRows:any[] = [];
      let totalMinutes = 0, coveredMinutes = 0, knownInternalCost = 0;
      for (const s of attributeIdentity(sessions || [],identityAliases)) {
        const c:any = s.ore_commesse || {};
        const cl:any = c.ore_clienti || {};
        const tp:any = c.ore_tipologie || {};
        const mins = Number(s.minuti_effettivi || 0);
        totalMinutes += mins;

        const rate = applicableRate(s);
        const cost = rate === null ? null : (mins / 60) * rate;
        costRows.push({
          data_lavoro: s.data_lavoro,
          tecnico_nome: s.tecnico_nome || s.tecnico_uid,
          tecnico_uid: s.tecnico_uid,
          codice_lavoro: c.codice_lavoro || "",
          codice_commessa_crm: c.codice_commessa_crm || "",
          cliente: cl.ragione_sociale || "",
          descrizione: c.descrizione || "",
          minuti: mins,
          costo_orario: rate,
          costo_sessione: cost === null ? null : Math.round(cost * 100) / 100
        });
        if (cost !== null) {
          coveredMinutes += mins;
          knownInternalCost += cost;
        }

        const id = String(s.commessa_id || "");
        if (!id) continue;
        const v = jobs.get(id) || {
          id,
          codice_lavoro: c.codice_lavoro || "",
          codice_commessa_crm: c.codice_commessa_crm || "",
          descrizione: c.descrizione || "",
          stato: c.stato || "",
          cliente: cl.ragione_sociale || "",
          tipo_codice: tp.codice || "P",
          tipo_nome: tp.nome || "Altro",
          budget_ore: c.budget_ore === null ? null : Number(c.budget_ore),
          costi_esterni: Number(c.costi_esterni || 0),
          valore_vendita: c.valore_vendita === null ? null : Number(c.valore_vendita),
          minuti: 0,
          minuti_coperti: 0,
          costo_tecnico: 0
        };
        v.minuti += mins;
        if (cost !== null) {
          v.minuti_coperti += mins;
          v.costo_tecnico += cost;
        }
        jobs.set(id, v);
      }

      const jobRows = [...jobs.values()].map((j:any) => {
        const coperturaCompleta = j.minuti === 0 || j.minuti_coperti === j.minuti;
        const costoTotale = coperturaCompleta ? j.costo_tecnico + j.costi_esterni : null;
        const margine = (coperturaCompleta && j.valore_vendita !== null) ? j.valore_vendita - costoTotale : null;
        const marginePct = (margine !== null && j.valore_vendita > 0) ? (margine / j.valore_vendita) * 100 : null;
        return {
          ...j,
          ore: j.minuti / 60,
          ore_coperte: j.minuti_coperti / 60,
          copertura_completa: coperturaCompleta,
          costo_tecnico: Math.round(j.costo_tecnico * 100) / 100,
          costo_totale: costoTotale === null ? null : Math.round(costoTotale * 100) / 100,
          margine: margine === null ? null : Math.round(margine * 100) / 100,
          margine_pct: marginePct === null ? null : Math.round(marginePct * 10) / 10
        };
      });

      const comparable = jobRows.filter((j:any) => j.valore_vendita !== null && j.copertura_completa);
      const comparableRevenue = comparable.reduce((s:number,j:any)=>s + Number(j.valore_vendita || 0), 0);
      const comparableCost = comparable.reduce((s:number,j:any)=>s + Number(j.costo_totale || 0), 0);
      const comparableMargin = comparableRevenue - comparableCost;

      const completedByType = new Map<string, number[]>();
      for (const j of jobRows) {
        if (j.stato !== "completata" || j.tipo_codice === "P") continue;
        const a = completedByType.get(j.tipo_codice) || [];
        a.push(Number(j.ore || 0));
        completedByType.set(j.tipo_codice, a);
      }
      const med = (arr:number[]) => {
        const a = [...arr].sort((x,y)=>x-y);
        if (!a.length) return 0;
        const m = Math.floor(a.length / 2);
        return a.length % 2 ? a[m] : (a[m-1] + a[m]) / 2;
      };
      const typeStats = [...completedByType.entries()].map(([code, values]) => {
        const sample = jobRows.find((j:any)=>j.tipo_codice===code);
        return {
          codice: code,
          nome: sample?.tipo_nome || code,
          n: values.length,
          mediana_ore: Math.round(med(values) * 100) / 100,
          media_ore: Math.round((values.reduce((a,b)=>a+b,0)/values.length) * 100) / 100
        };
      }).sort((a,b)=>a.codice.localeCompare(b.codice));

      return json(req, {
        coverage: {
          totalHours: totalMinutes / 60,
          coveredHours: coveredMinutes / 60,
          percent: totalMinutes ? Math.round((coveredMinutes / totalMinutes) * 1000) / 10 : 100
        },
        knownInternalCost: Math.round(knownInternalCost * 100) / 100,
        blendedHourlyCost: coveredMinutes ? Math.round((knownInternalCost / (coveredMinutes / 60)) * 100) / 100 : null,
        comparable: {
          jobs: comparable.length,
          revenue: Math.round(comparableRevenue * 100) / 100,
          cost: Math.round(comparableCost * 100) / 100,
          margin: Math.round(comparableMargin * 100) / 100,
          marginPct: comparableRevenue ? Math.round((comparableMargin / comparableRevenue) * 1000) / 10 : null
        },
        jobs: jobRows.sort((a:any,b:any)=>Number(b.ore)-Number(a.ore)),
        costRows: costRows.sort((a:any,b:any)=>String(b.data_lavoro).localeCompare(String(a.data_lavoro))).slice(0,1000),
        typeStats
      });
    }

    if (action === "archiveJobs") {
      requireAdmin(user);

      const [{ data: jobs, error: jobsErr }, { data: sessions, error: sessionsErr }] = await Promise.all([
        readAll(()=>db.from("ore_commesse")
          .select("id,codice_breve,codice_lavoro,codice_commessa_crm,descrizione,stato,anno,data_apertura,data_completamento,budget_ore,costi_esterni,valore_vendita,ore_clienti(id,codice_breve,ragione_sociale),ore_tipologie(id,codice,nome)")
          .order("descrizione")),
        readAll(()=>db.from("ore_sessioni")
          .select("id,commessa_id,tecnico_uid,tecnico_nome,data_lavoro,minuti_effettivi,origine,modificata_manualmente")
          .order("data_lavoro",{ascending:true}))
      ]);
      if (jobsErr || sessionsErr) bad("Impossibile caricare l'archivio completo.",500);

      const stats=new Map<string,any>();
      let totalMinutes=0;
      const technicians=new Set<string>();
      for(const s of attributeIdentity(sessions||[],identityAliases)){
        totalMinutes+=Number(s.minuti_effettivi||0);
        technicians.add(String(s.tecnico_uid||s.tecnico_nome||""));
        const id=String(s.commessa_id||"");
        if(!id) continue;
        const v=stats.get(id)||{minutes:0,sessions:0,techs:new Set<string>(),first:null,last:null,crm:0,manual:0,historical:0,edited:0};
        v.minutes+=Number(s.minuti_effettivi||0);
        v.sessions++;
        v.techs.add(String(s.tecnico_uid||s.tecnico_nome||""));
        const d=String(s.data_lavoro||"");
        if(d&&(!v.first||d<v.first))v.first=d;
        if(d&&(!v.last||d>v.last))v.last=d;
        if(s.origine==="crm_agenda")v.crm++;
        else if(s.origine==="import_storico")v.historical++;
        else v.manual++;
        if(s.modificata_manualmente)v.edited++;
        stats.set(id,v);
      }

      const rows=(jobs||[]).map((j:any)=>{
        const v=stats.get(String(j.id))||{minutes:0,sessions:0,techs:new Set<string>(),first:null,last:null,crm:0,manual:0,historical:0,edited:0};
        return {
          id:j.id,
          codice_breve:j.codice_breve,
          codice_lavoro:j.codice_lavoro,
          codice_commessa_crm:j.codice_commessa_crm,
          descrizione:j.descrizione,
          stato:j.stato,
          anno:j.anno,
          data_apertura:j.data_apertura,
          data_completamento:j.data_completamento,
          budget_ore:j.budget_ore,
          costi_esterni:j.costi_esterni,
          valore_vendita:j.valore_vendita,
          cliente:j.ore_clienti||null,
          tipologia:j.ore_tipologie||null,
          ore:Math.round((v.minutes/60)*100)/100,
          attivita:v.sessions,
          tecnici:v.techs.size,
          prima_attivita:v.first,
          ultima_attivita:v.last,
          origini:{crm:v.crm,manuale:v.manual,storico:v.historical,modificate:v.edited}
        };
      });

      return json(req,{
        totals:{
          commesse:rows.length,
          attivita:(sessions||[]).length,
          ore:Math.round((totalMinutes/60)*100)/100,
          tecnici:[...technicians].filter(Boolean).length
        },
        rows
      });
    }

    if (action === "archiveJobDetail") {
      requireAdmin(user);
      const commessaId=String(body.commessaId||"").trim();
      if(!commessaId) bad("Commessa non valida.");

      const [{ data: job, error: jobErr }, { data: sessions, error: sessionsErr }] = await Promise.all([
        db.from("ore_commesse")
          .select("id,codice_breve,codice_lavoro,codice_commessa_crm,descrizione,stato,anno,data_apertura,data_completamento,budget_ore,costi_esterni,valore_vendita,note_economiche,ore_clienti(id,codice_breve,ragione_sociale),ore_tipologie(id,codice,nome)")
          .eq("id",commessaId).maybeSingle(),
        readAll(()=>db.from("ore_sessioni")
          .select("id,tecnico_uid,tecnico_nome,data_lavoro,inizio,fine,minuti_agenda,minuti_effettivi,origine,crm_event_id,crm_oggetto,attivita_rilevata,modificata_manualmente,motivo_modifica,confermata")
          .eq("commessa_id",commessaId)
          .order("data_lavoro",{ascending:true})
          .order("inizio",{ascending:true}))
      ]);
      if(jobErr||!job) bad("Commessa non trovata.",404);
      if(sessionsErr) bad("Impossibile caricare le attività della commessa.",500);

      const byTech=new Map<string,any>();
      let totalMinutes=0;
      for(const s of attributeIdentity(sessions||[],identityAliases)){
        const key=String(s.tecnico_uid||"non indicato");
        const v=byTech.get(key)||{minutes:0,sessions:0,name:s.tecnico_nome||key};
        v.minutes+=Number(s.minuti_effettivi||0);
        v.sessions++;
        byTech.set(key,v);
        totalMinutes+=Number(s.minuti_effettivi||0);
      }

      return json(req,{
        job,
        totals:{
          attivita:(sessions||[]).length,
          ore:Math.round((totalMinutes/60)*100)/100,
          tecnici:byTech.size
        },
        technicians:[...byTech.entries()].map(([uid,v])=>({nome:v.name,tecnico_uid:uid,ore:Math.round((v.minutes/60)*100)/100,attivita:v.sessions})).sort((a,b)=>a.nome.localeCompare(b.nome,"it")),
        sessions:attributeIdentity(sessions||[],identityAliases)
      });
    }

    if (action === "adminSummary") {
      requireAdmin(user);
      const from = dateOnly(body.from), to = dateOnly(body.to);
      const rows:any[]=[];
      for(let offset=0;;offset+=1000){
        const {data,error}=await db.from("ore_sessioni")
          .select("tecnico_uid,tecnico_nome,data_lavoro,minuti_effettivi,origine,commessa_id,fase,ore_commesse(codice_breve,codice_lavoro,codice_commessa_crm,descrizione,stato,ore_clienti(codice_breve,ragione_sociale),ore_tipologie(codice,nome))")
          .gte("data_lavoro",from).lte("data_lavoro",to).order("id").range(offset,offset+999);
        if(error)bad("Impossibile generare il riepilogo completo.",500);
        rows.push(...attributeIdentity(data||[],identityAliases));if((data||[]).length<1000)break;
      }
      const activities:any[]=[];
      for(let offset=0;;offset+=1000){
        const {data,error}=await db.from("ore_rendicontazioni").select("*").gte("data_lavoro",from).lte("data_lavoro",to).order("id").order("tipo_record").range(offset,offset+999);
        if(error)bad("Impossibile calcolare la rendicontazione completa.",500);
        activities.push(...attributeIdentity(data||[],identityAliases));if((data||[]).length<1000)break;
      }
      const totalMinutes = activities.reduce((s: number, x: any) => s + Number(x.minuti_effettivi || 0), 0);
      const technicians = new Set(activities.map((x: any) => x.tecnico_uid)).size;
      const jobs = new Set(rows.map((x: any) => x.commessa_id)).size;
      return json(req, { from, to, totalMinutes, sessions: rows.length, technicians, jobs, rows,billability:billability(activities),internalActivities:activities.filter((r:any)=>r.tipo_record==="interna") });
    }

    bad("Operazione non riconosciuta.");
  } catch (error: any) {
    return json(req, { error: error?.message || "Richiesta non valida." }, Number(error?.status) || 400);
  }
});
