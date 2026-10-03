const firebaseConfig={apiKey:"AIzaSyAdgCc8TQ1TVfF8l0NMxtm7NS95ZOl4lCA",authDomain:"safety-checklist-colligo.firebaseapp.com",projectId:"safety-checklist-colligo",storageBucket:"safety-checklist-colligo.firebasestorage.app",messagingSenderId:"792044189701",appId:"1:792044189701:web:8e421f500963a25951846c"};
const API="https://twznfiygzzbqdgudpwav.supabase.co/functions/v1/ore-produttivita-api";
firebase.initializeApp(firebaseConfig);
const db=firebase.firestore();
const authPersistence=firebase.auth()
  .setPersistence(firebase.auth.Auth.Persistence.LOCAL)
  .catch(error=>{console.error("Persistenza sessione",error)});
const $=s=>document.querySelector(s);
// --- Robustezza: escaping HTML, notifiche, API con timeout --------------------
class SafeHTML{constructor(v){this.v=String(v)}toString(){return this.v}}
function esc(v){if(v instanceof SafeHTML)return v.v;if(Array.isArray(v))return v.map(esc).join("");return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function raw(v){return new SafeHTML(v??"")}
function html(strings,...values){let out=strings[0];values.forEach((v,i)=>{out+=esc(v)+strings[i+1]});return new SafeHTML(out)}
function notify(message,type="error",ms){
  let host=document.getElementById("toastHost");
  if(!host){host=document.createElement("div");host.id="toastHost";host.className="toast-host";host.setAttribute("role","status");host.setAttribute("aria-live","polite");document.body.appendChild(host)}
  const text=String(message||"Operazione non riuscita.");
  if([...host.children].some(t=>t.dataset.text===text))return;
  const t=document.createElement("div");t.className="toast toast-"+type;t.dataset.text=text;t.textContent=text;
  const close=document.createElement("button");close.type="button";close.className="toast-close";close.setAttribute("aria-label","Chiudi");close.textContent="×";close.addEventListener("click",()=>t.remove());
  t.appendChild(close);host.appendChild(t);
  setTimeout(()=>t.remove(),ms??(type==="error"?7000:3500));
}
const READ_ACTIONS=new Set(["day","syncStatus","catalog","commesse","recentPersonal","adminSummary","crmResources","archiveJobs","archiveJob","economicsCatalog","adminEconomics"]);
READ_ACTIONS.add("crmLinks");READ_ACTIONS.add("previewCrmLink");
const API_TIMEOUT_MS=25000;
function friendlyError(status,body){
  if(body&&body.error)return body.error;
  if(status===401||status===403)return "Sessione scaduta o permessi insufficienti. Esci e rientra.";
  if(status===404)return "Funzione del server non trovata. Aggiorna l’app.";
  if(status===429)return "Troppe richieste ravvicinate. Riprova tra qualche secondo.";
  if(status>=500)return "Il server non risponde correttamente. Riprova tra poco.";
  return "Richiesta non riuscita ("+status+").";
}
const loginView=$("#loginView"),appView=$("#appView"),loginForm=$("#loginForm"),loginError=$("#loginError"),loginBtn=$("#loginBtn");
let profile=null;
function internalEmail(v){const u=String(v||"").trim().toLowerCase();if(!/^[a-z0-9][a-z0-9._-]{1,38}[a-z0-9]$/.test(u)||u.includes(".."))throw new Error("Username non valido.");return u+"@safetychecklist.local"}
function localDate(d=new Date()){const y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,"0"),day=String(d.getDate()).padStart(2,"0");return `${y}-${m}-${day}`}
function monthStart(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-01`}
function fmtMinutes(m){m=Number(m||0);return `${Math.floor(m/60)}h ${String(m%60).padStart(2,"0")}m`}
const moneyFmt=new Intl.NumberFormat("it-IT",{style:"currency",currency:"EUR",minimumFractionDigits:0,maximumFractionDigits:2});
function fmtMoney(v){return v===null||v===undefined||!Number.isFinite(Number(v))?"—":moneyFmt.format(Number(v))}
function numberInput(v){if(v===null||v===undefined||String(v).trim()==="")return null;const n=Number(String(v).replace(",",".").trim());return Number.isFinite(n)?n:null}
function median(values){const a=[...values].sort((x,y)=>x-y),n=a.length;if(!n)return 0;const m=Math.floor(n/2);return n%2?a[m]:(a[m-1]+a[m])/2}
function inputMinutes(v){
  let s=String(v??"").trim().toLowerCase().replace(/\s+/g,"").replace(/or[ea]$/,"h").replace(/min(uti|uto)?$/,"m");
  if(!s)return null;
  let n=null,m;
  if((m=s.match(/^(\d{1,2}):([0-5]\d)$/)))n=Number(m[1])*60+Number(m[2]);
  else if((m=s.match(/^(\d+(?:[.,]\d+)?)h$/)))n=Math.round(Number(m[1].replace(",","."))*60);
  else if((m=s.match(/^(\d+)h(\d{1,2})m?$/))){if(Number(m[2])>59)return null;n=Number(m[1])*60+Number(m[2])}
  else if((m=s.match(/^(\d+)m$/)))n=Number(m[1]);
  else if((m=s.match(/^(\d+(?:[.,]\d+)?)$/))){const x=Number(m[1].replace(",","."));n=x<=12?Math.round(x*60):(Number.isInteger(x)?x:null)}
  return n!=null&&Number.isFinite(n)&&n>=0&&n<=1440?n:null;
}
function durationHint(input){
  if(!input||input.dataset.hintBound)return;
  input.dataset.hintBound="1";
  const hint=document.createElement("small");hint.className="duration-preview";hint.setAttribute("aria-live","polite");
  input.insertAdjacentElement("afterend",hint);
  const upd=()=>{const t=input.value.trim();if(!t){hint.textContent="";hint.classList.remove("bad");return}const m=inputMinutes(t);hint.textContent=m==null?"Formato non valido (es. 2h30, 2:30, 1,5)":"= "+fmtMinutes(m);hint.classList.toggle("bad",m==null)};
  input.addEventListener("input",upd);upd();
}
async function token(){const u=firebase.auth().currentUser;if(!u)throw new Error("Sessione scaduta.");return u.getIdToken()}
async function api(action,body={},attempt=0){
  if(navigator.onLine===false)throw new Error("Sei offline: controlla la connessione e riprova.");
  const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),API_TIMEOUT_MS);
  let r;
  try{
    r=await fetch(API,{method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${await token()}`},body:JSON.stringify({action,...body}),signal:ctrl.signal});
  }catch(e){
    clearTimeout(timer);
    if(e&&e.message==="Sessione scaduta.")throw e;
    if(READ_ACTIONS.has(action)&&attempt<1){await new Promise(res=>setTimeout(res,800));return api(action,body,attempt+1)}
    throw new Error(e&&e.name==="AbortError"?"Il server non ha risposto in tempo. Riprova.":"Connessione al server non riuscita. Riprova.");
  }
  clearTimeout(timer);
  const j=await r.json().catch(()=>null);
  if(!r.ok){
    if(READ_ACTIONS.has(action)&&r.status>=500&&attempt<1){await new Promise(res=>setTimeout(res,800));return api(action,body,attempt+1)}
    throw new Error(friendlyError(r.status,j));
  }
  if(!j||typeof j!=="object")throw new Error("Risposta del server non valida.");
  return j;
}
async function loadProfile(user){const snap=await db.collection("utenti").doc(user.uid).get({source:"server"});if(!snap.exists)throw new Error("Profilo utente non disponibile.");const p=snap.data();if(p.attivo!==true||!["admin","tecnico"].includes(p.ruolo))throw new Error("Account non attivo.");return {...p,uid:user.uid}}
function showLogin(msg=""){profile=null;loginView.hidden=false;appView.hidden=true;loginError.textContent=msg;loginError.hidden=!msg}
async function showApp(p){profile=p;loginView.hidden=true;appView.hidden=false;$("#userName").textContent=[p.nome,p.cognome].filter(Boolean).join(" ")||p.username;$("#userRole").textContent=p.ruolo==="admin"?"Amministratore":"Tecnico";$("#tabAdmin").hidden=p.ruolo!=="admin";$("#tabArchive").hidden=p.ruolo!=="admin";$("#tabEconomics").hidden=p.ruolo!=="admin";$("#panelTitle").textContent=p.ruolo==="admin"?"Pannello Amministratore":"Pannello Tecnico";$("#panelSubtitle").textContent=p.ruolo==="admin"?"Report, produttività e analisi per decisioni strategiche":"Inserisci le tue ore in pochi secondi";await loadDay();if(p.ruolo==="admin")await loadAdmin()}
loginForm.addEventListener("submit",async e=>{
  e.preventDefault();loginBtn.disabled=true;loginError.hidden=true;
  try{
    await authPersistence;
    await firebase.auth().signInWithEmailAndPassword(internalEmail($("#username").value),$("#password").value);
  }catch(err){
    showLogin(["auth/invalid-credential","auth/user-not-found","auth/wrong-password"].includes(err.code)?"Credenziali non valide.":err.message);
  }finally{
    loginBtn.disabled=false;$("#password").value="";
  }
});
$("#logoutBtn").addEventListener("click",()=>firebase.auth().signOut());
authPersistence.finally(()=>{
  firebase.auth().onAuthStateChanged(async user=>{
    if(!user){showLogin();return}
    try{showApp(await loadProfile(user))}
    catch(e){await firebase.auth().signOut().catch(()=>{});showLogin(e.message)}
  });
});
let deferredInstallPrompt=null;
const installAppBtn=$("#installAppBtn");
const isStandalone=()=>window.matchMedia?.("(display-mode: standalone)")?.matches===true||window.navigator.standalone===true;
const isIOS=()=>/iphone|ipad|ipod/i.test(navigator.userAgent||"");

function refreshInstallAction(){
  if(!installAppBtn)return;
  installAppBtn.hidden=isStandalone()||(!deferredInstallPrompt&&!isIOS());
}
window.addEventListener("beforeinstallprompt",event=>{
  event.preventDefault();
  deferredInstallPrompt=event;
  refreshInstallAction();
});
window.addEventListener("appinstalled",()=>{
  deferredInstallPrompt=null;
  refreshInstallAction();
});
installAppBtn?.addEventListener("click",async()=>{
  if(deferredInstallPrompt){
    const prompt=deferredInstallPrompt;
    deferredInstallPrompt=null;
    await prompt.prompt();
    await prompt.userChoice.catch(()=>null);
    refreshInstallAction();
    return;
  }
  if(isIOS()){
    notify("Su iPhone/iPad: apri Condividi in Safari e scegli “Aggiungi alla schermata Home”.");
    return;
  }
  notify("Apri il menu del browser e scegli “Installa app” o “Aggiungi alla schermata Home”.");
});
refreshInstallAction();

$("#dayDate").value=localDate();$("#adminFrom").value=monthStart();$("#adminTo").value=localDate();
let lastDayDate=$("#dayDate").value;
$("#dayDate").addEventListener("change",()=>{
  const el=$("#dayDate");
  if(!el.value){el.value=lastDayDate;return}
  if(dayHasUnsavedWork()&&!confirm("Ci sono modifiche non salvate in questa giornata. Cambiare data e perderle?")){el.value=lastDayDate;return}
  lastDayDate=el.value;loadDay();
});$("#refreshDay").addEventListener("click",loadDay);
let manualCatalogLoaded=false;
async function loadManualCatalog(){
  const client=$("#manualClient"),job=$("#manualJob");
  if(!manualCatalogLoaded){
    const j=await api("catalog");
    client.innerHTML='<option value="">Seleziona cliente…</option>'+j.clienti.map(c=>html`<option value="${c.id}">${String(Number(c.codice_breve))} · ${c.ragione_sociale}</option>`).join("");
    manualCatalogLoaded=true;
  }
  if(!client.value){job.innerHTML='<option value="">Seleziona prima il cliente…</option>';return}
  const j=await api("commesse",{clienteId:client.value});
  job.innerHTML='<option value="">Seleziona commessa…</option>'+j.commesse.map(c=>html`<option value="${c.id}">${c.codice_lavoro||""} · ${c.descrizione}</option>`).join("");
}
async function openManualCard(){$("#manualCard").hidden=false;try{await loadManualCatalog()}catch(e){notify(e.message)}$("#manualCard").scrollIntoView({behavior:"smooth",block:"nearest"})}
$("#manualToggle").addEventListener("click",openManualCard);
$("#manualToggleBottom")?.addEventListener("click",openManualCard);
document.querySelectorAll("[data-quick-minutes]").forEach(btn=>btn.addEventListener("click",()=>{const m=Number(btn.dataset.quickMinutes||0);if(m)$("#manualDuration").value=m>=60&&m%60===0?(m/60)+"h":m+"m"}));
$("#manualClose").addEventListener("click",()=>{$("#manualCard").hidden=true});
$("#manualClient").addEventListener("change",()=>loadManualCatalog().catch(e=>notify(e.message)));
$("#manualSave").addEventListener("click",async()=>{
  const btn=$("#manualSave"),m=inputMinutes($("#manualDuration").value),commessaId=$("#manualJob").value;
  if(!commessaId){notify("Seleziona una commessa.","warn");return}
  if(m==null||m<=0){notify("Inserisci una durata valida, ad esempio 2h30m.","warn");return}
  btn.disabled=true;
  try{
    await api("addManual",{
      date:$("#dayDate").value,
      commessaId,
      minutiEffettivi:m,
      oggetto:$("#manualNote").value||"Attività aggiunta manualmente"
    });
    $("#manualDuration").value="";$("#manualNote").value="";$("#manualCard").hidden=true;
    await loadDay();
  }catch(e){notify(e.message)}
  finally{btn.disabled=false}
});

function fmtClock(v){if(!v)return "—";return new Date(v).toLocaleTimeString("it-IT",{hour:"2-digit",minute:"2-digit"})}
function fmtSyncTime(v){if(!v)return "Non sincronizzato";return new Date(v).toLocaleString("it-IT",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"})}

let assignmentDataPromise=null;
async function getAssignmentData(){
  if(!assignmentDataPromise){
    assignmentDataPromise=Promise.all([api("catalog"),api("commesse")]).then(([catalog,jobs])=>({
      catalog,
      jobs:jobs.commesse||[]
    })).catch(e=>{assignmentDataPromise=null;throw e});
  }
  return assignmentDataPromise;
}
function addSelectOption(select,value,label){
  const o=document.createElement("option");o.value=value||"";o.textContent=label;select.appendChild(o);
}
function inferIssueMeta(issue,data){
  const m=String(issue.codice_lavoro||"").trim().toUpperCase().match(/^(\d{1,2})([A-Z])$/);
  if(m){
    const client=(data.catalog.clienti||[]).find(x=>Number(x.codice_breve)===Number(m[1]))||null;
    const type=(data.catalog.tipologie||[]).find(x=>String(x.codice||"").toUpperCase()===m[2])||null;
    return {client,type};
  }
  const candidates=Array.isArray(issue.candidati)?issue.candidati:[];
  const clientIds=[...new Set(candidates.map(x=>x.clienteId).filter(Boolean))];
  const typeIds=[...new Set(candidates.map(x=>x.tipologiaId).filter(Boolean))];
  const client=clientIds.length===1?(data.catalog.clienti||[]).find(x=>String(x.id)===String(clientIds[0]))||null:null;
  const type=typeIds.length===1?(data.catalog.tipologie||[]).find(x=>String(x.id)===String(typeIds[0]))||null:null;
  return {client,type};
}
function fillAssignmentClients(select,data,selectedId=""){
  select.innerHTML="";addSelectOption(select,"","Cliente…");
  (data.catalog.clienti||[]).forEach(x=>addSelectOption(select,x.id,`${Number(x.codice_breve)} · ${x.ragione_sociale}`));
  if(selectedId)select.value=selectedId;
}
function fillAssignmentTypes(select,data,selectedId=""){
  select.innerHTML="";addSelectOption(select,"","Tutte le tipologie");
  (data.catalog.tipologie||[]).forEach(x=>addSelectOption(select,x.id,`${x.codice} · ${x.nome}`));
  if(selectedId)select.value=selectedId;
}
function fillAssignmentJobs(select,data,clientId,typeId,selectedId=""){
  let rows=(data.jobs||[]).filter(x=>!clientId||String(x.cliente_id)===String(clientId));
  if(typeId)rows=rows.filter(x=>String(x.tipologia_id||"")===String(typeId));
  rows.sort((a,b)=>String(a.descrizione||"").localeCompare(String(b.descrizione||""),"it"));
  select.innerHTML="";addSelectOption(select,"",rows.length?"Commessa / pratica…":"Nessuna commessa con questi filtri");
  rows.forEach(x=>addSelectOption(select,x.id,`${x.codice_lavoro||x.codice_commessa_crm||"—"} · ${x.descrizione||"Commessa"}`));
  if(selectedId&&rows.some(x=>String(x.id)===String(selectedId)))select.value=selectedId;
}
function buildAssignmentEditor({host,data,clientId="",typeId="",jobId="",minutes=0,title="",onSave,onCancel}){
  host.innerHTML="";
  const editor=document.createElement("div");editor.className="assignment-editor";

  const makeField=(labelText,control,extraClass="")=>{
    const field=document.createElement("label");
    field.className=("assignment-field "+extraClass).trim();
    const cap=document.createElement("span");cap.className="assignment-label";cap.textContent=labelText;
    field.append(cap,control);
    return field;
  };

  const client=document.createElement("select"),type=document.createElement("select"),job=document.createElement("select");
  const dur=document.createElement("input"),note=document.createElement("input");
  client.className=type.className=job.className="assignment-select";
  dur.className="assignment-input";note.className="assignment-input assignment-note-input";
  dur.placeholder="es. 2h30m";dur.value=fmtMinutes(minutes).replace(" ","");
  note.placeholder="Descrizione / nota";note.value=title||"";

  fillAssignmentClients(client,data,clientId);
  fillAssignmentTypes(type,data,typeId);
  fillAssignmentJobs(job,data,client.value,type.value,jobId);

  const hint=document.createElement("div");hint.className="assignment-hint";
  const refreshHint=()=>{
    const hasJobs=[...job.options].some(o=>o.value);
    job.classList.toggle("no-options",!hasJobs);
    hint.textContent=hasJobs
      ?"Seleziona la pratica corretta. Se preferisci, puoi salvare solo Cliente + Tipo."
      :"Nessuna commessa specifica trovata. Puoi salvare comunque Cliente + Tipo.";
  };
  const refresh=()=>{
    fillAssignmentJobs(job,data,client.value,type.value,"");
    refreshHint();
  };
  client.addEventListener("change",refresh);
  type.addEventListener("change",refresh);
  refreshHint();

  const actions=document.createElement("div");actions.className="assignment-buttons";
  const save=document.createElement("button");save.type="button";save.className="save assignment-save";save.textContent="Salva modifiche";
  const cancel=document.createElement("button");cancel.type="button";cancel.className="assignment-cancel";cancel.textContent="Annulla";
  save.addEventListener("click",async()=>{
    const m=inputMinutes(dur.value);
    if(!job.value&&!(client.value&&type.value)){notify("Seleziona una commessa oppure almeno Cliente + Tipo.","warn");return}
    if(m==null||m<=0){notify("Inserisci una durata valida, ad esempio 2h30m.","warn");return}
    save.disabled=true;cancel.disabled=true;
    try{await onSave({commessaId:job.value||"",clienteId:client.value||"",tipologiaId:type.value||"",minutiEffettivi:m,oggetto:note.value});}
    catch(e){notify(e.message);save.disabled=false;cancel.disabled=false}
  });
  cancel.addEventListener("click",()=>onCancel?.());
  actions.append(save,cancel);

  editor.append(
    makeField("Cliente",client,"assignment-client"),
    makeField("Tipologia",type,"assignment-type"),
    makeField("Commessa / pratica",job,"assignment-job"),
    makeField("Ore effettive",dur,"assignment-duration"),
    makeField("Descrizione / nota",note,"assignment-description"),
    hint,
    actions
  );
  host.appendChild(editor);
}
async function loadSyncStatus(){
  if(!profile)return;
  try{
    const [j,data]=await Promise.all([api("syncStatus",{date:$("#dayDate").value}),getAssignmentData()]);
    const who=j.resource?.sigla?`${j.resource.sigla} · `:"";
    const syncStamp=j.resource?.ultima_sync||j.lastSync?.created_at||"";
    const syncAge=syncStamp?Math.max(0,(Date.now()-new Date(syncStamp).getTime())/60000):Infinity;
    const autoState=$("#crmAutoState");
    if(autoState){
      const healthy=syncAge<=15;
      autoState.textContent=healthy?"AUTO":"FERMO";
      autoState.classList.toggle("stale",!healthy);
    }
    $("#crmSyncStatus").textContent=syncStamp
      ?`${syncAge<=15?"": "Ultimo dato · "}${who}${fmtSyncTime(syncStamp)}`
      :`${who}Mai sincronizzato`;

    const issues=j.openIssues||[];
    const card=$("#syncIssuesCard"),box=$("#syncIssues"),count=$("#syncIssueCount");
    count.textContent=String(issues.length);
    card.hidden=issues.length===0;
    box.innerHTML="";

    for(const issue of issues){
      const row=document.createElement("article");
      row.className="work-entry issue-entry";

      const candidates=Array.isArray(issue.candidati)?issue.candidati:[];
      const code=issue.codice_lavoro||issue.codice_commessa_crm||"—";
      const meta=inferIssueMeta(issue,data);
      const clientLabel=meta.client?.ragione_sociale||"Cliente non riconosciuto";
      const typeLabel=meta.type?.nome||"Tipologia da verificare";
      const reason=meta.client||meta.type
        ?"Cliente e tipologia rilevati"
        :issue.motivo==="ambiguous"?"Più pratiche compatibili":"Da classificare";

      row.innerHTML=html`
        <div class="issue-main">
          <div class="entry-code">${code}</div>
          <div class="issue-summary">
            <div class="entry-client"></div>
            <div class="entry-title"></div>
            <div class="entry-meta">
              <span>${reason}</span>
              <span class="entry-origin">Da verificare</span>
              <span>${fmtMinutes(issue.minuti)}</span>
            </div>
          </div>
          <div class="entry-time">
            <strong>${fmtClock(issue.inizio)}–${fmtClock(issue.fine)}</strong>
            <span>Orario agenda</span>
          </div>
          <div class="issue-cta">
            <small></small>
            <button class="assignment-edit" type="button">Modifica / abbina</button>
          </div>
        </div>
        <div class="issue-editor" hidden></div>`;

      row.querySelector(".entry-client").textContent=`${clientLabel} · ${typeLabel}`;
      row.querySelector(".entry-title").textContent=issue.titolo||"Attività CRM";
      row.querySelector(".issue-cta small").textContent=candidates.length
        ?`${candidates.length} pratiche suggerite`
        :(meta.client&&meta.type?"Pratica da scegliere":"Scegli cliente e pratica");

      const edit=row.querySelector(".assignment-edit");
      const editorHost=row.querySelector(".issue-editor");
      edit.addEventListener("click",()=>{
        row.classList.add("editing");
        editorHost.hidden=false;
        edit.hidden=true;
        buildAssignmentEditor({
          host:editorHost,data,
          clientId:meta.client?.id||"",
          typeId:meta.type?.id||"",
          jobId:candidates.length===1?candidates[0].id:"",
          minutes:issue.minuti,
          title:issue.titolo||"",
          onSave:async values=>{
            await api("resolveSyncIssue",{issueId:issue.id,...values});
            await loadDay();
          },
          onCancel:()=>{
            editorHost.hidden=true;
            editorHost.innerHTML="";
            row.classList.remove("editing");
            edit.hidden=false;
          }
        });
      });
      box.appendChild(row);
    }
  }catch(e){
    console.error("sync status",e);
    $("#crmSyncStatus").textContent="Errore sync";
  }
}
// Il frontend non apre mai il CRM. L'agenda viene sincronizzata in background
// dall'agente aziendale; qui ricarichiamo soltanto i dati già presenti nel backend.
document.addEventListener("visibilitychange",()=>{
  if(!document.hidden&&profile&&!$("#dayPanel").hidden&&!dayHasUnsavedWork())setTimeout(()=>{if(!dayHasUnsavedWork())loadDay().catch(()=>{})},500);
});

function renderEmpty(){
  $("#sessions").innerHTML='<div class="empty">Nessuna attività per questa giornata.</div>';
  $("#crmDetected").innerHTML='<div class="crm-empty">Nessun appuntamento CRM importato per questa data.</div>';
}
function renderCrmDetected(sessions){
  const box=$("#crmDetected");box.innerHTML="";
  const rows=(sessions||[]).filter(s=>s.origine==="crm_agenda");
  const planned=rows.reduce((sum,s)=>sum+Number(s.minuti_agenda||0),0);
  const effective=rows.reduce((sum,s)=>sum+Number(s.minuti_effettivi||0),0);
  box.innerHTML=html`<div class="crm-summary-item"><span>Appuntamenti</span><strong>${rows.length}</strong></div>
    <div class="crm-summary-item"><span>Ore da agenda</span><strong>${fmtMinutes(planned)}</strong></div>
    <div class="crm-summary-item"><span>Ore rendicontate</span><strong>${fmtMinutes(effective)}</strong></div>`;
}
async function renderRecentActivities(){
  const box=$("#recentActivities");box.innerHTML="";
  try{
    const j=await api("recentPersonal");
    const rows=j.rows||[];
    if(!rows.length){box.innerHTML='<div class="crm-empty">Nessuna attività recente.</div>';return}
    rows.slice(0,3).forEach(s=>{
      const c=s.ore_commesse||{},cl=c.ore_clienti||{},tp=c.ore_tipologie||{};
      const code=(cl.codice_breve?String(Number(cl.codice_breve)):"")+(tp.codice||"P");
      const card=document.createElement("article");card.className="recent-card";
      card.innerHTML=html`<div><span class="mini-code code-${(tp.codice||"P").toLowerCase()}">${code||"—"}</span><strong>${cl.ragione_sociale||"Cliente"} · ${tp.nome||"Attività"}</strong></div><small>${c.descrizione||"—"}</small><button type="button">＋ Aggiungi ore</button>`;
      card.querySelector("button").addEventListener("click",async()=>{
        await openManualCard();
        if(c.cliente_id){$("#manualClient").value=String(c.cliente_id);await loadManualCatalog();$("#manualJob").value=String(s.commessa_id||"")}
      });
      box.appendChild(card);
    });
  }catch(e){console.error("recent activities",e)}
}
let daySeq=0;
function dayHasUnsavedWork(){
  if([...document.querySelectorAll("#sessions .proto-hours input")].some(i=>i.value.trim()!==(i.dataset.original||"")))return true;
  if(document.querySelector("#sessions .session-edit-panel:not([hidden]), #syncIssues .issue-editor:not([hidden])"))return true;
  const mc=$("#manualCard");
  return !!(mc&&!mc.hidden&&($("#manualDuration").value.trim()||$("#manualNote").value.trim()));
}
async function loadDay(){
  if(!profile)return;
  const seq=++daySeq,requestedDate=$("#dayDate").value;
  $("#dayMessage").hidden=true;
  try{
    const j=await api("day",{date:requestedDate});
    if(seq!==daySeq)return;
    j.sessions=Array.isArray(j.sessions)?j.sessions:[];
    const total=Number(j.totalMinutes||0),totalText=fmtMinutes(total),pct=Math.max(0,Math.min(100,Math.round(total/480*100)));
    $("#dayTotal").textContent=`${totalText} / 8h 00m`;
    $("#dayTotalBottom").textContent=totalText;
    $("#dayProgressBar").style.width=pct+"%";
    $("#dayProgressText").textContent=pct+"%";
    const confirmed=j.dayStatus?.stato==="confermata";
    $("#dayStatus").textContent=confirmed?"Confermata":"Da verificare";
    $("#dayCompleteBadge").textContent=confirmed?"Completata":"Da completare";
    $("#dayCompleteBadge").classList.toggle("done",confirmed);
    renderCrmDetected(j.sessions||[]);
    const box=$("#sessions");box.innerHTML="";
    if(!j.sessions.length){renderEmpty();await Promise.all([loadSyncStatus(),renderRecentActivities()]);return}
    j.sessions.forEach(s=>{
      const c=s.ore_commesse||{},cl=c.ore_clienti||{},tp=c.ore_tipologie||{};
      const displayCode=(cl.codice_breve?String(Number(cl.codice_breve)):"")+(tp.codice||"P");
      const origin=s.origine==="crm_agenda"?"CRM":s.origine==="import_storico"?"Storico":"Manuale";
      const isCrm=s.origine==="crm_agenda";
      const row=document.createElement("div");row.className="proto-hour-row agenda-hour-row";
      const note=s.crm_oggetto||c.descrizione||"";
      const activity=s.attivita_rilevata||tp.nome||"Attività";
      const clock=isCrm&&s.inizio&&s.fine?`${fmtClock(s.inizio)}<small>– ${fmtClock(s.fine)}</small>`:"<span>Manuale</span>";
      const agenda=isCrm?fmtMinutes(s.minuti_agenda):"—";
      row.innerHTML=html`<div class="proto-time">${raw(clock)}</div>
        <div class="proto-desc"><strong><span class="inline-code code-${(tp.codice||"P").toLowerCase()}">${displayCode||"—"}</span> ${cl.ragione_sociale||"Cliente"} · ${c.descrizione||"Attività"}</strong><small>${c.codice_commessa_crm||""} · ${activity} · ${origin}</small><small class="agenda-object"></small></div>
        <div class="agenda-duration"><strong>${agenda}</strong><small>${isCrm?"da CRM":"inserimento"}</small></div>
        <div class="proto-hours"><input aria-label="Ore effettive" value="${fmtMinutes(s.minuti_effettivi).replace(" ","")}"></div>
        <div class="proto-actions"><span class="row-state ${s.confermata?"done":""}">${s.confermata?"Confermata":"Da verificare"}</span><button class="save" type="button">Salva</button><button class="assignment-edit session-edit" type="button">Modifica</button></div><div class="session-edit-panel" hidden></div>`;
      row.querySelector(".agenda-object").textContent=note;
      const inp=row.querySelector("input"),btn=row.querySelector(".save"),editBtn=row.querySelector(".session-edit"),editPanel=row.querySelector(".session-edit-panel");
      inp.dataset.original=inp.value;
      inp.addEventListener("input",()=>{const changed=inp.value.trim()!==inp.dataset.original;const bad=inp.value.trim()!==""&&inputMinutes(inp.value)==null;row.classList.toggle("dirty",changed);inp.classList.toggle("invalid",bad);inp.title=bad?"Formato non valido: usa 2h30, 2:30 oppure 1,5":(changed?"= "+fmtMinutes(inputMinutes(inp.value)||0)+" · premi Invio o Salva":"")});
      inp.addEventListener("keydown",ev=>{if(ev.key==="Enter"){ev.preventDefault();btn.click()}if(ev.key==="Escape"){inp.value=inp.dataset.original;inp.dispatchEvent(new Event("input"))}});
      btn.addEventListener("click",async()=>{if(btn.disabled)return;const m=inputMinutes(inp.value);if(m==null){notify("Durata non valida: usa ad esempio 2h30, 2:30 oppure 1,5.","warn");inp.focus();return}btn.disabled=true;try{await api("saveSession",{id:s.id,minutiEffettivi:m});inp.dataset.original=inp.value;row.classList.remove("dirty");notify("Ore salvate.","ok");await loadDay()}catch(e){notify(e.message)}finally{btn.disabled=false}});
      editBtn.addEventListener("click",async()=>{
        try{
          const data=await getAssignmentData();
          const currentJob=(data.jobs||[]).find(x=>String(x.id)===String(s.commessa_id))||{};
          editPanel.hidden=false;row.classList.add("editing");
          buildAssignmentEditor({
            host:editPanel,data,
            clientId:currentJob.cliente_id||"",
            typeId:currentJob.tipologia_id||"",
            jobId:s.commessa_id||"",
            minutes:s.minuti_effettivi,
            title:s.crm_oggetto||"",
            onSave:async values=>{await api("saveSession",{id:s.id,...values,motivo:"Correzione manuale attività importata"});await loadDay();},
            onCancel:()=>{editPanel.hidden=true;row.classList.remove("editing")}
          });
        }catch(e){notify(e.message)}
      });
      box.appendChild(row);
    });
    await Promise.all([loadSyncStatus(),renderRecentActivities()]);
  }catch(e){if(seq!==daySeq)return;$("#dayMessage").textContent=e.message;$("#dayMessage").hidden=false;renderEmpty()}
}
$("#confirmDay").addEventListener("click",async()=>{
  const b=$("#confirmDay");if(b.disabled)return;
  if(dayHasUnsavedWork()){notify("Salva o annulla le modifiche aperte prima di confermare la giornata.","warn");return}
  const issues=Number($("#syncIssueCount")?.textContent||0);
  const totalTxt=$("#dayTotalBottom")?.textContent||"";
  if(issues>0&&!confirm(`Ci sono ${issues} attività non abbinate a una pratica: non verranno conteggiate. Confermare comunque la giornata?`))return;
  if(/^0h 00m$/.test(totalTxt)&&!confirm("La giornata non ha ore registrate. Confermare comunque?"))return;
  b.disabled=true;
  try{const j=await api("confirmDay",{date:$("#dayDate").value});$("#dayMessage").textContent=`Giornata confermata: ${fmtMinutes(j.totalMinutes)}.`;$("#dayMessage").hidden=false;notify("Giornata confermata.","ok");await loadDay()}
  catch(e){notify(e.message)}finally{b.disabled=false}
});
function setTab(which){
  const day=which==="day",admin=which==="admin",archive=which==="archive",economics=which==="economics";
  $("#dayPanel").hidden=!day;$("#adminPanel").hidden=!admin;$("#archivePanel").hidden=!archive;$("#economicsPanel").hidden=!economics;
  $("#tabDay").classList.toggle("active",day);$("#tabAdmin").classList.toggle("active",admin);$("#tabArchive").classList.toggle("active",archive);$("#tabEconomics").classList.toggle("active",economics);
  $("#panelTitle").textContent=day?"Pannello Tecnico":"Pannello Amministratore";
  $("#panelSubtitle").textContent=day?"Inserisci le tue ore in pochi secondi":"Report, produttività e analisi per decisioni strategiche";
  if(admin)loadAdmin();if(archive)loadArchive();if(economics)loadEconomics();
}
$("#tabDay").addEventListener("click",()=>setTab("day"));
$("#tabAdmin").addEventListener("click",()=>setTab("admin"));
$("#tabArchive").addEventListener("click",()=>setTab("archive"));
$("#tabEconomics").addEventListener("click",()=>setTab("economics"));
$("#loadAdmin").addEventListener("click",loadAdmin);
function renderRankBars(selector,entries,limit=6){
  const box=$(selector);if(!box)return;box.innerHTML="";
  const rows=[...entries].sort((a,b)=>b[1].minutes-a[1].minutes).slice(0,limit);
  const max=Math.max(1,...rows.map(x=>x[1].minutes));
  rows.forEach(([name,v],idx)=>{const row=document.createElement("div");row.className="rank-bar-row";const pct=Math.max(4,Math.round(v.minutes/max*100));row.innerHTML=html`<span>${name}</span><div><i style="width:${pct}%"></i></div><b>${(v.minutes/60).toLocaleString("it-IT",{maximumFractionDigits:1})} h</b>`;box.appendChild(row)});
  if(!rows.length)box.innerHTML='<div class="crm-empty">Nessun dato.</div>';
}
function renderAdminVisuals(rows,clients,techs){
  const palette=["#2e8df4","#52c9a5","#f5b64b","#8d6be8","#e97878","#59b8c8","#93c95b","#9aa9b8"];
  const typeMap=new Map(),monthMap=new Map();
  for(const r of rows||[]){const c=r.ore_commesse||{},tp=c.ore_tipologie||{},mins=Number(r.minuti_effettivi||0);const key=tp.nome||"Altro";typeMap.set(key,(typeMap.get(key)||0)+mins);const m=String(r.data_lavoro||"").slice(0,7);if(m)monthMap.set(m,(monthMap.get(m)||0)+mins)}
  const types=[...typeMap.entries()].sort((a,b)=>b[1]-a[1]).slice(0,8),total=types.reduce((s,x)=>s+x[1],0);
  const donut=$("#typeDonut"),legend=$("#typeLegend");if(donut&&legend){let acc=0;const seg=[];types.forEach(([name,mins],i)=>{const start=total?acc/total*360:0;acc+=mins;const end=total?acc/total*360:0;seg.push(`${palette[i%palette.length]} ${start}deg ${end}deg`)});donut.style.background=seg.length?`conic-gradient(${seg.join(",")})`:"#e8edf2";$("#typeDonutTotal").textContent=(total/60).toLocaleString("it-IT",{maximumFractionDigits:0})+"h";legend.innerHTML="";types.forEach(([name,mins],i)=>{const el=document.createElement("div");const pct=total?Math.round(mins/total*100):0;el.innerHTML=html`<i style="background:${palette[i%palette.length]}"></i><span>${name}</span><b>${pct}%</b>`;legend.appendChild(el)})}
  const months=[...monthMap.entries()].sort((a,b)=>a[0].localeCompare(b[0]));const mb=$("#monthlyBars");if(mb){mb.innerHTML="";const max=Math.max(1,...months.map(x=>x[1]));months.forEach(([m,mins])=>{const col=document.createElement("div");col.className="month-col";const h=Math.max(6,Math.round(mins/max*100));const d=new Date(m+"-01T12:00:00");col.innerHTML=html`<b>${(mins/60).toLocaleString("it-IT",{maximumFractionDigits:0})}</b><div><i style="height:${h}%"></i></div><span>${d.toLocaleDateString("it-IT",{month:"short"})}</span>`;mb.appendChild(col)});if(!months.length)mb.innerHTML='<div class="crm-empty">Nessun dato.</div>'}
  renderRankBars("#techBars",techs,6);renderRankBars("#clientBars",clients,6);
}
let adminSeq=0;
async function loadAdmin(){
  if(!profile||profile.ruolo!=="admin")return;
  const from=$("#adminFrom").value,to=$("#adminTo").value;
  if(!from||!to){notify("Indica entrambe le date del periodo.","warn");return}
  if(from>to){notify("La data “Dal” è successiva alla data “Al”.","warn");return}
  const seq=++adminSeq;
  $("#adminEmpty").textContent="Nessuna sessione nel periodo selezionato.";
  try{
    const [j,crm]=await Promise.all([api("adminSummary",{from,to}),api("crmResources")]);
    if(seq!==adminSeq)return;
    j.rows=Array.isArray(j.rows)?j.rows:[];
    const totalHours=j.totalMinutes/60;
    $("#kpiHours").textContent=totalHours.toLocaleString("it-IT",{maximumFractionDigits:1});
    $("#kpiTechs").textContent=j.technicians;
    $("#kpiJobs").textContent=j.jobs;
    $("#kpiAvgJob").textContent=j.jobs?(totalHours/j.jobs).toLocaleString("it-IT",{maximumFractionDigits:1})+"h":"0h";

    const resources=crm.resources||[];
    $("#crmResourceCount").textContent=String(resources.length);
    $("#crmResourceEmpty").hidden=resources.length>0;
    const crmBody=$("#crmResourceRows");
    crmBody.innerHTML="";
    let syncFresh=0,syncLate=0,syncNever=0;
    for(const r of resources){
      const lastDate=r.ultima_sync?new Date(r.ultima_sync):null;
      const last=lastDate?lastDate.toLocaleString("it-IT",{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"}):"Mai";
      const ageMinutes=lastDate?Math.max(0,(Date.now()-lastDate.getTime())/60000):Infinity;
      if(!lastDate)syncNever++;
      else if(ageMinutes<=15)syncFresh++;
      else syncLate++;
      const state=!lastDate
        ?'<span class="sync-state sync-never">Mai sincronizzato</span>'
        :ageMinutes<=15
          ?'<span class="sync-state sync-ok">Aggiornato</span>'
          :'<span class="sync-state sync-late">In ritardo</span>';
      const tr=document.createElement("tr");
      tr.innerHTML=html`<td><b>${r.sigla_crm||"—"}</b></td>
        <td>${r.tecnico_nome||r.nome_crm||"—"}</td>
        <td>${last}</td>
        <td>${state}</td>`;
      crmBody.appendChild(tr);
    }
    if($("#crmSyncFresh"))$("#crmSyncFresh").textContent=`${syncFresh} aggiornati`;
    if($("#crmSyncLate"))$("#crmSyncLate").textContent=`${syncLate} in ritardo`;
    if($("#crmSyncNever"))$("#crmSyncNever").textContent=`${syncNever} mai`;

    const agentAlert=$("#crmAgentAlert");
    if(agentAlert){
      const heartbeat=crm.agent||null;
      const heartbeatAt=heartbeat?.heartbeat_at?new Date(heartbeat.heartbeat_at):null;
      const heartbeatAge=heartbeatAt?Math.max(0,(Date.now()-heartbeatAt.getTime())/60000):Infinity;
      const heartbeatFresh=heartbeatAge<=15;
      const heartbeatState=String(heartbeat?.state||"").toLowerCase();
      const heartbeatError=["login_required","error"].includes(heartbeatState);
      const inactive=!heartbeatFresh||heartbeatError;
      const partial=!inactive&&resources.length>0&&syncFresh<resources.length;
      agentAlert.hidden=!(inactive||partial);
      agentAlert.classList.toggle("partial",partial&&!inactive);

      if(inactive){
        $("#crmAgentAlertTitle").textContent=heartbeatState==="login_required"
          ?"CRM: sessione scaduta"
          :"Sincronizzazione CRM automatica non attiva";
        $("#crmAgentAlertText").textContent=heartbeat?.message
          ||"L’agente aziendale non sta inviando heartbeat recenti.";
      }else{
        $("#crmAgentAlertTitle").textContent=partial
          ?"Sincronizzazione CRM parziale"
          :"Sincronizzazione CRM attiva";
        $("#crmAgentAlertText").textContent=partial
          ?`${syncFresh} tecnici aggiornati su ${resources.length}. Ultimo ciclo agente regolare.`
          :`${resources.length} tecnici coperti. Agente background regolare.`;
      }

      const heartbeatText=$("#crmAgentHeartbeatText");
      if(heartbeatText){
        const lastCycle=crm.companySync?.completed_at?fmtSyncTime(crm.companySync.completed_at):"mai";
        heartbeatText.textContent=heartbeatAt
          ?`Heartbeat ${fmtSyncTime(heartbeat.heartbeat_at)} · stato ${heartbeatState||"—"} · ultimo ciclo ${lastCycle}`
          :`Nessun heartbeat agente · ultimo ciclo ${lastCycle}`;
      }
    }

    const tb=$("#adminRows");tb.innerHTML="";
    $("#adminEmpty").hidden=j.rows.length>0;
    j.rows.forEach(r=>{
      const c=r.ore_commesse||{},cl=c.ore_clienti||{},tp=c.ore_tipologie||{};
      const code=(cl.codice_breve&&tp.codice)?String(Number(cl.codice_breve))+tp.codice:"";
      const tr=document.createElement("tr");
      const origin=r.origine==="crm_agenda"?"CRM":r.origine==="import_storico"?"Storico":"Manuale";
      tr.innerHTML=html`<td>${new Date(r.data_lavoro+"T12:00:00").toLocaleDateString("it-IT")}</td>
        <td><b>${r.tecnico_nome||r.tecnico_uid}</b></td>
        <td><b>${code||"—"}</b></td>
        <td>${cl.ragione_sociale||"—"}</td>
        <td><b>${c.descrizione||"—"}</b><br><span class="muted">${c.codice_commessa_crm||""}</span></td>
        <td>${tp.nome||"—"}</td>
        <td>${origin}</td>
        <td><b>${fmtMinutes(r.minuti_effettivi)}</b></td>`;
      tb.appendChild(tr);
    });

    const clients=new Map(),techs=new Map(),jobs=new Map();
    for(const r of j.rows){
      const c=r.ore_commesse||{},cl=c.ore_clienti||{},tp=c.ore_tipologie||{};
      const mins=Number(r.minuti_effettivi||0);
      const clientKey=cl.ragione_sociale||"Non classificato";
      const cv=clients.get(clientKey)||{minutes:0,sessions:0};
      cv.minutes+=mins;cv.sessions++;clients.set(clientKey,cv);

      const techKey=r.tecnico_nome||r.tecnico_uid||"—";
      const tv=techs.get(techKey)||{minutes:0,sessions:0,jobs:new Set()};
      tv.minutes+=mins;tv.sessions++;if(r.commessa_id)tv.jobs.add(r.commessa_id);techs.set(techKey,tv);

      const jobKey=r.commessa_id||c.codice_breve;
      if(jobKey){
        const v=jobs.get(jobKey)||{minutes:0,type:tp.nome||"Altro",typeCode:tp.codice||"P",status:c.stato||"",desc:c.descrizione||"",client:clientKey};
        v.minutes+=mins;jobs.set(jobKey,v);
      }
    }

    renderAdminVisuals(j.rows,clients,techs);

    const clientBody=$("#clientRows");clientBody.innerHTML="";
    [...clients.entries()].sort((a,b)=>b[1].minutes-a[1].minutes).slice(0,12).forEach(([name,v])=>{
      const tr=document.createElement("tr");
      tr.innerHTML=html`<td><b>${name}</b></td><td>${(v.minutes/60).toLocaleString("it-IT",{maximumFractionDigits:1})}</td><td>${v.sessions}</td>`;
      clientBody.appendChild(tr);
    });
    $("#clientEmpty").hidden=clients.size>0;
    $("#kpiClients").textContent=String(clients.size);

    const techBody=$("#technicianRows");techBody.innerHTML="";
    [...techs.entries()].sort((a,b)=>b[1].minutes-a[1].minutes).slice(0,15).forEach(([name,v])=>{
      const tr=document.createElement("tr");
      tr.innerHTML=html`<td><b>${name}</b></td><td>${(v.minutes/60).toLocaleString("it-IT",{maximumFractionDigits:1})}</td><td>${v.sessions}</td><td>${v.jobs.size}</td>`;
      techBody.appendChild(tr);
    });
    $("#technicianEmpty").hidden=techs.size>0;

    renderProductivity().catch(e=>console.error("produttività",e));
  }catch(e){
    console.error(e);
    const box=$("#adminEmpty");if(box){box.textContent="Impossibile caricare i dati della direzione.";box.hidden=false}
  }
}




// Tempo per tipologia: usa il totale ore dell'intera pratica (archivio completo),
// non solo le ore cadute nel periodo filtrato, che sottostimerebbero le pratiche lunghe.
async function renderProductivity(){
  const body=$("#productivityRows"),empty=$("#productivityEmpty");
  if(!archiveData){try{archiveData=await api("archiveJobs")}catch(e){body.innerHTML="";empty.textContent="Impossibile calcolare i tempi per tipologia: "+e.message;empty.hidden=false;return}}
  const types=new Map();
  for(const r of archiveData.rows||[]){
    const code=String(r.tipologia?.codice||"");const ore=Number(r.ore||0);
    if(r.stato!=="completata"||!code||code==="P"||!(ore>0))continue;
    const v=types.get(code)||{name:r.tipologia?.nome||code,values:[]};
    v.values.push(ore);types.set(code,v);
  }
  const f=x=>x.toLocaleString("it-IT",{maximumFractionDigits:1});
  body.innerHTML="";
  [...types.entries()].sort((a,b)=>a[0].localeCompare(b[0])).forEach(([code,v])=>{
    const vals=v.values,avg=vals.reduce((s,x)=>s+x,0)/vals.length,med=median(vals),min=Math.min(...vals),max=Math.max(...vals);
    const tr=document.createElement("tr");
    tr.innerHTML=html`<td><b>${code} · ${v.name}</b>${vals.length<5?html`<br><span class="muted">campione ridotto</span>`:""}</td><td>${vals.length}</td><td>${f(avg)} h</td><td><b>${f(med)} h</b></td><td>${f(min)}–${f(max)} h</td>`;
    body.appendChild(tr);
  });
  empty.textContent="Nessuna pratica completata e classificata nello storico.";
  empty.hidden=types.size>0;
}
let archiveData=null;
let archivePage=1;
const ARCHIVE_PAGE_SIZE=25;

function archiveStatusLabel(v){
  if(v==="completata")return "Completata";
  if(v==="in_lavorazione")return "In lavorazione";
  if(v==="archiviata")return "Archiviata";
  return v||"—";
}
function archiveDate(v){
  return v?new Date(v+"T12:00:00").toLocaleDateString("it-IT"):"—";
}
function archiveOrigin(v){
  if(v==="crm_agenda")return "CRM";
  if(v==="import_storico")return "Storico";
  if(v==="manuale")return "Manuale";
  return v||"—";
}
function archiveClock(v){
  return v?new Date(v).toLocaleTimeString("it-IT",{hour:"2-digit",minute:"2-digit"}):"—";
}
function populateArchiveFilters(){
  const rows=archiveData?.rows||[];
  const clients=[...new Map(rows.map(r=>[r.cliente?.id||r.cliente?.ragione_sociale,r.cliente?.ragione_sociale]).filter(x=>x[0]&&x[1])).entries()]
    .sort((a,b)=>String(a[1]).localeCompare(String(b[1]),"it"));
  const types=[...new Map(rows.map(r=>[r.tipologia?.codice,r.tipologia?.nome]).filter(x=>x[0]&&x[1])).entries()]
    .sort((a,b)=>String(a[0]).localeCompare(String(b[0]),"it"));
  const client=$("#archiveClient"),type=$("#archiveType");
  const prevClient=client.value,prevType=type.value;
  client.innerHTML='<option value="">Tutti</option>'+clients.map(([id,name])=>html`<option value="${id}">${name}</option>`).join("");
  type.innerHTML='<option value="">Tutti</option>'+types.map(([code,name])=>html`<option value="${code}">${code} · ${name}</option>`).join("");
  if(prevClient&&clients.some(x=>String(x[0])===prevClient))client.value=prevClient;
  if(prevType&&types.some(x=>String(x[0])===prevType))type.value=prevType;
}
function renderArchive(){
  const all=archiveData?.rows||[];
  const q=String($("#archiveSearch").value||"").trim().toLocaleLowerCase("it-IT");
  const client=$("#archiveClient").value;
  const type=$("#archiveType").value;
  const status=$("#archiveStatus").value;
  const rows=all.filter(r=>{
    if(client&&String(r.cliente?.id||r.cliente?.ragione_sociale)!==client)return false;
    if(type&&String(r.tipologia?.codice||"")!==type)return false;
    if(status&&String(r.stato||"")!==status)return false;
    if(q){
      const hay=[
        r.codice_lavoro,r.codice_breve,r.codice_commessa_crm,r.descrizione,
        r.cliente?.ragione_sociale,r.tipologia?.nome,r.tipologia?.codice
      ].filter(Boolean).join(" ").toLocaleLowerCase("it-IT");
      if(!hay.includes(q))return false;
    }
    return true;
  }).sort((a,b)=>{
    const ca=String(a.cliente?.ragione_sociale||""),cb=String(b.cliente?.ragione_sociale||"");
    const c=ca.localeCompare(cb,"it");if(c)return c;
    return String(a.descrizione||"").localeCompare(String(b.descrizione||""),"it");
  });

  const totalPages=Math.max(1,Math.ceil(rows.length/ARCHIVE_PAGE_SIZE));
  archivePage=Math.min(Math.max(1,archivePage),totalPages);
  const start=(archivePage-1)*ARCHIVE_PAGE_SIZE;
  const pageRows=rows.slice(start,start+ARCHIVE_PAGE_SIZE);
  $("#archiveVisibleCount").textContent=rows.length
    ? `${start+1}–${Math.min(start+pageRows.length,rows.length)} di ${rows.length} commesse filtrate · ${all.length} totali`
    : `0 commesse filtrate · ${all.length} totali`;
  $("#archiveEmpty").hidden=rows.length>0;
  const pager=$("#archivePager");
  pager.hidden=rows.length<=ARCHIVE_PAGE_SIZE;
  $("#archivePageInfo").textContent=`Pagina ${archivePage} di ${totalPages}`;
  $("#archivePrev").disabled=archivePage<=1;
  $("#archiveNext").disabled=archivePage>=totalPages;
  const body=$("#archiveRows");body.innerHTML="";
  for(const r of pageRows){
    const statusClass=r.stato==="completata"?" completed":"";
    const period=r.prima_attivita||r.ultima_attivita
      ? `${archiveDate(r.prima_attivita)} – ${archiveDate(r.ultima_attivita)}`:"—";
    const tr=document.createElement("tr");
    tr.innerHTML=html`<td><span class="archive-code">${r.codice_lavoro||"—"}</span><br><span class="muted">${r.codice_commessa_crm||""}</span></td>
      <td><b>${r.cliente?.ragione_sociale||"—"}</b></td>
      <td><b>${r.descrizione||"—"}</b></td>
      <td>${r.tipologia?.nome||"Altro"}</td>
      <td><span class="archive-status${statusClass}">${archiveStatusLabel(r.stato)}</span></td>
      <td><b>${Number(r.ore||0).toLocaleString("it-IT",{maximumFractionDigits:2})} h</b></td>
      <td>${r.attivita||0}</td>
      <td>${r.tecnici||0}</td>
      <td>${period}</td>
      <td><button class="archive-open" type="button" data-id="${r.id}">Apri</button></td>`;
    tr.querySelector(".archive-open").addEventListener("click",()=>openArchiveJob(r.id));
    body.appendChild(tr);
  }
}
async function openArchiveJob(id){
  const box=$("#archiveDetail");
  box.hidden=false;
  $("#archiveDetailTitle").textContent="Caricamento…";
  $("#archiveDetailSubtitle").textContent="";
  $("#archiveSessionRows").innerHTML="";
  try{
    const j=await api("archiveJobDetail",{commessaId:id});
    const job=j.job||{},cl=job.ore_clienti||{},tp=job.ore_tipologie||{};
    $("#archiveDetailTitle").textContent=`${job.codice_lavoro||"—"} · ${cl.ragione_sociale||"Cliente"} · ${job.descrizione||"Commessa"}`;
    $("#archiveDetailSubtitle").textContent=`${tp.nome||"Altro"} · ${archiveStatusLabel(job.stato)} · ${job.anno||"—"}`;
    $("#archiveDetailHours").textContent=Number(j.totals?.ore||0).toLocaleString("it-IT",{maximumFractionDigits:2})+" h";
    $("#archiveDetailSessions").textContent=String(j.totals?.attivita||0);
    $("#archiveDetailTechs").textContent=String(j.totals?.tecnici||0);
    $("#archiveDetailCrm").textContent=job.codice_commessa_crm||"—";

    const chips=$("#archiveTechSummary");chips.innerHTML="";
    for(const t of j.technicians||[]){
      const span=document.createElement("span");
      span.innerHTML=html`<b>${t.nome}</b> ${Number(t.ore||0).toLocaleString("it-IT",{maximumFractionDigits:2})} h · ${t.attivita} attività`;
      chips.appendChild(span);
    }

    const body=$("#archiveSessionRows");body.innerHTML="";
    for(const s of j.sessions||[]){
      const edited=s.modificata_manualmente?" · modificata":"";
      const tr=document.createElement("tr");
      tr.innerHTML=html`<td>${archiveDate(s.data_lavoro)}</td>
        <td><b>${s.tecnico_nome||s.tecnico_uid||"—"}</b></td>
        <td>${s.inizio||s.fine?`${archiveClock(s.inizio)}–${archiveClock(s.fine)}`:"—"}</td>
        <td><b>${s.crm_oggetto||"Attività"}</b>${s.motivo_modifica?html`<br><span class="muted">${s.motivo_modifica}</span>`:""}</td>
        <td><span class="archive-origin">${archiveOrigin(s.origine)}${edited}</span></td>
        <td><b>${fmtMinutes(s.minuti_effettivi)}</b></td>
        <td>${s.confermata?"Confermata":"Da confermare"}</td>`;
      body.appendChild(tr);
    }
    box.scrollIntoView({behavior:"smooth",block:"start"});
  }catch(e){
    $("#archiveDetailTitle").textContent="Errore";
    $("#archiveDetailSubtitle").textContent=e.message;
  }
}
async function loadArchive(){
  if(!profile||profile.ruolo!=="admin")return;
  try{
    archiveData=await api("archiveJobs");
    $("#archiveJobsCount").textContent=String(archiveData.totals?.commesse||0);
    $("#archiveSessionsCount").textContent=Number(archiveData.totals?.attivita||0).toLocaleString("it-IT");
    $("#archiveHoursCount").textContent=Number(archiveData.totals?.ore||0).toLocaleString("it-IT",{maximumFractionDigits:2});
    $("#archiveTechCount").textContent=String(archiveData.totals?.tecnici||0);
    populateArchiveFilters();
    archivePage=1;
    renderArchive();
  }catch(e){
    console.error(e);
    $("#archiveRows").innerHTML="";
    $("#archiveEmpty").textContent="Impossibile caricare l’archivio: "+e.message;
    $("#archiveEmpty").hidden=false;
  }
}
$("#reloadArchive")?.addEventListener("click",loadArchive);
["#archiveSearch","#archiveClient","#archiveType","#archiveStatus"].forEach(s=>{
  const el=$(s);if(!el)return;
  el.addEventListener(s==="#archiveSearch"?"input":"change",()=>{
    archivePage=1;
    renderArchive();
  });
});
$("#archiveReset")?.addEventListener("click",()=>{
  $("#archiveSearch").value="";
  $("#archiveClient").value="";
  $("#archiveType").value="";
  $("#archiveStatus").value="";
  archivePage=1;
  renderArchive();
});
$("#archivePrev")?.addEventListener("click",()=>{
  if(archivePage>1){archivePage--;renderArchive();$("#archiveRows").closest(".panel")?.scrollIntoView({behavior:"smooth",block:"start"})}
});
$("#archiveNext")?.addEventListener("click",()=>{
  archivePage++;renderArchive();$("#archiveRows").closest(".panel")?.scrollIntoView({behavior:"smooth",block:"start"})
});
$("#archiveDetailClose")?.addEventListener("click",()=>{$("#archiveDetail").hidden=true});

let economicsCatalog=null;
let economicsSummary=null;

function latestRateForTech(tech,rates){
  const name=String(tech.tecnico_nome||"").trim().toLocaleLowerCase("it-IT");
  return (rates||[]).find(r=>String(r.tecnico_uid||"")===String(tech.tecnico_uid||"")) ||
         (rates||[]).find(r=>String(r.tecnico_nome||"").trim().toLocaleLowerCase("it-IT")===name) || null;
}

function renderCostRates(){
  const body=$("#costRateRows");
  body.innerHTML="";
  const techs=economicsCatalog?.technicians||[];
  $("#costRateEmpty").hidden=techs.length>0;
  const defaultFrom=new Date().getFullYear()+"-01-01";
  for(const tech of techs){
    const rate=latestRateForTech(tech,economicsCatalog.rates);
    const tr=document.createElement("tr");
    tr.innerHTML=html`<td><b>${tech.tecnico_nome||tech.tecnico_uid}</b><br><span class="muted">${String(tech.tecnico_uid||"").startsWith("legacy:")?"Storico CRM":"Account attuale"}</span></td>
      <td><input class="rate-value" inputmode="decimal" value="${rate?.costo_orario??""}" placeholder="€/h"></td>
      <td><input class="rate-from" type="date" value="${rate?.valido_dal||defaultFrom}"></td>
      <td><input class="rate-to" type="date" value="${rate?.valido_al||""}"></td>
      <td><button class="save rate-save" type="button">Salva</button></td>`;
    const btn=tr.querySelector(".rate-save");
    btn.addEventListener("click",async()=>{
      const cost=numberInput(tr.querySelector(".rate-value").value);
      if(cost===null||cost<0){notify("Inserisci un costo orario valido.","warn");return}
      btn.disabled=true;
      try{
        await api("saveTechnicianCost",{
          tecnicoUid:tech.tecnico_uid,
          tecnicoNome:tech.tecnico_nome,
          costoOrario:cost,
          validoDal:tr.querySelector(".rate-from").value,
          validoAl:tr.querySelector(".rate-to").value||null
        });
        await loadEconomics();
      }catch(e){notify(e.message)}
      finally{btn.disabled=false}
    });
    body.appendChild(tr);
  }
}

function populateEconomicsJobs(){
  const select=$("#economicsJob");
  const jobs=economicsCatalog?.jobs||[];
  const previous=select.value;
  select.innerHTML='<option value="">Seleziona una pratica…</option>'+jobs.map(j=>{
    const cl=j.ore_clienti||{};
    return html`<option value="${j.id}">${j.codice_lavoro||"—"} · ${cl.ragione_sociale||"Cliente"} · ${j.descrizione}</option>`;
  }).join("");
  if(previous&&jobs.some(j=>j.id===previous))select.value=previous;
  fillJobEconomicsForm();
}

function fillJobEconomicsForm(){
  const id=$("#economicsJob").value;
  const job=(economicsCatalog?.jobs||[]).find(j=>j.id===id);
  $("#jobBudgetHours").value=job?.budget_ore??"";
  $("#jobExternalCosts").value=job?.costi_esterni??0;
  $("#jobSaleValue").value=job?.valore_vendita??"";
  $("#jobEconomicNote").value=job?.note_economiche??"";
}

function renderEconomicsSummary(){
  const e=economicsSummary;
  if(!e)return;
  $("#econCoverage").textContent=Number(e.coverage?.percent||0).toLocaleString("it-IT",{maximumFractionDigits:1})+"%";
  $("#econInternalCost").textContent=fmtMoney(e.knownInternalCost||0);
  $("#econRevenue").textContent=fmtMoney(e.comparable?.revenue||0);
  $("#econMargin").textContent=e.comparable?.jobs?fmtMoney(e.comparable.margin):"—";
  $("#econMarginMeta").textContent=e.comparable?.jobs
    ? `${e.comparable.jobs} commesse confrontabili · ${e.comparable.marginPct??"—"}% sui ricavi`
    : "Inserisci costi orari e valori venduti";

  const body=$("#economicsRows");
  body.innerHTML="";
  const rows=e.jobs||[];
  $("#economicsEmpty").hidden=rows.length>0;
  for(const j of rows){
    const complete=Boolean(j.copertura_completa);
    const marginClass=j.margine===null?"":(Number(j.margine)>=0?"money-positive":"money-negative");
    const tr=document.createElement("tr");
    tr.innerHTML=html`<td><b>${j.codice_lavoro||"—"}</b><br><span class="muted">${j.codice_commessa_crm||""}</span></td>
      <td><b>${j.cliente||"—"}</b><br><span class="muted">${j.descrizione||"—"}</span></td>
      <td>${Number(j.ore||0).toLocaleString("it-IT",{maximumFractionDigits:2})} h</td>
      <td>${j.budget_ore===null?"—":Number(j.budget_ore).toLocaleString("it-IT",{maximumFractionDigits:2})+" h"}</td>
      <td>${fmtMoney(j.costo_tecnico)}${raw(complete?"":'<br><span class="coverage-warning">parziale</span>')}</td>
      <td>${fmtMoney(j.costi_esterni||0)}</td>
      <td>${complete?fmtMoney(j.costo_totale):"—"}</td>
      <td>${j.valore_vendita===null?"—":fmtMoney(j.valore_vendita)}</td>
      <td class="${marginClass}">${j.margine===null?"—":fmtMoney(j.margine)+" ("+j.margine_pct+"%)"}</td>`;
    body.appendChild(tr);
  }

  const detail=$("#costDetailRows");
  detail.innerHTML="";
  const costRows=e.costRows||[];
  $("#costDetailEmpty").hidden=costRows.length>0;
  for(const r of costRows){
    const tr=document.createElement("tr");
    tr.innerHTML=html`<td>${new Date(r.data_lavoro+"T12:00:00").toLocaleDateString("it-IT")}</td>
      <td><b>${r.tecnico_nome||"—"}</b></td>
      <td><b>${r.codice_lavoro||"—"}</b><br><span class="muted">${r.codice_commessa_crm||""}</span></td>
      <td><b>${r.cliente||"—"}</b><br><span class="muted">${r.descrizione||"—"}</span></td>
      <td>${(Number(r.minuti||0)/60).toLocaleString("it-IT",{maximumFractionDigits:2})} h</td>
      <td>${r.costo_orario===null?raw('<span class="coverage-warning">Da valorizzare</span>'):fmtMoney(r.costo_orario)+"/h"}</td>
      <td><b>${r.costo_sessione===null?"—":fmtMoney(r.costo_sessione)}</b></td>`;
    detail.appendChild(tr);
  }
}

function renderEstimator(){
  const e=economicsSummary;
  const types=e?.typeStats||[];
  const sel=$("#estimateType"),old=sel.value;
  sel.innerHTML='<option value="">Seleziona tipologia…</option>'+types.map(t=>html`<option value="${t.codice}">${t.codice} · ${t.nome} · mediana ${t.mediana_ore} h (${t.n} casi)</option>`).join("");
  if(old&&types.some(t=>t.codice===old))sel.value=old;
  updateEstimator(false);
}

function updateEstimator(setHistoricalHours=false){
  const e=economicsSummary;
  if(!e)return;
  const type=(e.typeStats||[]).find(t=>t.codice===$("#estimateType").value);
  if(setHistoricalHours&&type)$("#estimateHours").value=type.mediana_ore;
  const hours=numberInput($("#estimateHours").value);
  const external=numberInput($("#estimateExternal").value)??0;
  const target=numberInput($("#estimateMargin").value);
  const rate=e.blendedHourlyCost;

  $("#estimateHourlyCost").textContent=rate===null?"—":fmtMoney(rate)+"/h";
  if(rate===null||hours===null||hours<0){
    $("#estimateTechnicalCost").textContent="—";
    $("#estimateTotalCost").textContent="—";
    $("#estimatePrice").textContent="—";
    $("#estimateNote").textContent=rate===null
      ?"Inserisci prima almeno un costo orario tecnico per ottenere una stima economica."
      :"Inserisci le ore previste.";
    return;
  }
  const tech=hours*rate,total=tech+external;
  $("#estimateTechnicalCost").textContent=fmtMoney(tech);
  $("#estimateTotalCost").textContent=fmtMoney(total);

  if(target===null||target<0||target>=100){
    $("#estimatePrice").textContent="—";
    $("#estimateNote").textContent="Inserisci un margine lordo obiettivo tra 0 e 99,9%.";
    return;
  }
  const price=total/(1-target/100);
  $("#estimatePrice").textContent=fmtMoney(price);
  $("#estimateNote").textContent=type
    ? `Base storica: ${type.n} pratiche chiuse, mediana ${type.mediana_ore} h. Il prezzo usa il costo orario medio delle ore già valorizzate.`
    :"La stima usa le ore inserite e il costo orario medio delle ore già valorizzate.";
}

async function loadEconomics(){
  if(!profile||profile.ruolo!=="admin")return;
  try{
    const [catalog,summary]=await Promise.all([api("economicsCatalog"),api("adminEconomics")]);
    economicsCatalog=catalog;
    economicsSummary=summary;
    renderCostRates();
    populateEconomicsJobs();
    renderEconomicsSummary();
    renderEstimator();
  }catch(e){
    console.error(e);
    notify("Impossibile caricare Economia & Margini: "+e.message);
  }
}

$("#reloadEconomics")?.addEventListener("click",loadEconomics);
$("#economicsJob")?.addEventListener("change",fillJobEconomicsForm);
$("#saveJobEconomics")?.addEventListener("click",async()=>{
  const id=$("#economicsJob").value;
  if(!id){notify("Seleziona una pratica.","warn");return}
  const btn=$("#saveJobEconomics"),msg=$("#jobEconomicsMessage");
  btn.disabled=true;msg.hidden=true;
  try{
    await api("saveJobEconomics",{
      commessaId:id,
      budgetOre:$("#jobBudgetHours").value,
      costiEsterni:$("#jobExternalCosts").value,
      valoreVendita:$("#jobSaleValue").value,
      noteEconomiche:$("#jobEconomicNote").value
    });
    msg.textContent="Dati economici della commessa salvati.";msg.hidden=false;
    await loadEconomics();
  }catch(e){msg.textContent=e.message;msg.hidden=false}
  finally{btn.disabled=false}
});
$("#estimateType")?.addEventListener("change",()=>updateEstimator(true));
["#estimateHours","#estimateExternal","#estimateMargin"].forEach(s=>$(s)?.addEventListener("input",()=>updateEstimator(false)));

function plannerDataFromXml(xmlText){
  const doc=new DOMParser().parseFromString(xmlText,"application/xml");
  if(doc.querySelector("parsererror")) throw new Error("Il file Planner non è un XML Excel valido.");
  const rows=[...doc.getElementsByTagNameNS("urn:schemas-microsoft-com:office:spreadsheet","Row")];
  if(rows.length<2) throw new Error("Nessuna riga trovata nel Planner.");
  const readRow=row=>{
    const out=[];let pos=1;
    const cells=[...row.getElementsByTagNameNS("urn:schemas-microsoft-com:office:spreadsheet","Cell")];
    for(const cell of cells){
      const idx=cell.getAttributeNS("urn:schemas-microsoft-com:office:spreadsheet","Index");
      if(idx){const n=Number(idx);while(pos<n){out.push("");pos++}}
      const data=cell.getElementsByTagNameNS("urn:schemas-microsoft-com:office:spreadsheet","Data")[0];
      out.push(data?.textContent||"");pos++;
    }
    return out;
  };
  const headers=readRow(rows[0]),ix=name=>headers.indexOf(name);
  const needed=["Data","CodiceComm","DescrizioneComm","StatoComm","CodiceCliente","RagioneSociale","NomeRisorsa","SiglaRisorsa","OreCaricate"];
  for(const name of needed) if(ix(name)<0) throw new Error("Colonna mancante nel Planner: "+name);
  const jobs=new Map(),history=[];
  rows.slice(1).forEach((row,rowIndex)=>{
    const v=readRow(row),get=n=>(v[ix(n)]||"").trim();
    const codiceComm=get("CodiceComm"),codiceCliente=get("CodiceCliente"),data=get("Data").slice(0,10);
    if(!codiceComm||!codiceCliente||!data)return;
    const jobKey=codiceCliente+"|"+codiceComm;
    const job={data,codiceComm,descrizioneComm:get("DescrizioneComm"),statoComm:get("StatoComm"),codiceCliente,ragioneSociale:get("RagioneSociale")};
    if(!jobs.has(jobKey))jobs.set(jobKey,job);
    const hours=Number(get("OreCaricate").replace(",","."));
    if(Number.isFinite(hours)&&hours>0){
      history.push({
        eventId:"planner-"+String(rowIndex+1).padStart(6,"0")+"-"+data+"-"+codiceComm+"-"+get("SiglaRisorsa"),
        data,codiceComm,
        nomeRisorsa:get("NomeRisorsa"),
        siglaRisorsa:get("SiglaRisorsa"),
        minuti:Math.round(hours*60),
        oggetto:get("Oggetto"),
        descrizioneRiga:get("DescrizioneRiga")
      });
    }
  });
  return {commesse:[...jobs.values()],history};
}
$("#importPlanner")?.addEventListener("click",async()=>{
  const file=$("#plannerFile")?.files?.[0],msg=$("#plannerImportMessage"),btn=$("#importPlanner");
  if(!file){msg.textContent="Seleziona prima il file .xls del Planner.";msg.hidden=false;return}
  btn.disabled=true;msg.hidden=false;msg.textContent="Lettura del Planner in corso…";
  try{
    const parsed=plannerDataFromXml(await file.text());
    msg.textContent=`Trovate ${parsed.commesse.length} commesse e ${parsed.history.length} righe storiche. Aggiornamento anagrafiche…`;
    const r=await api("importPlanner",{commesse:parsed.commesse});
    let imported=0,skipped=0;
    const batchSize=400;
    for(let i=0;i<parsed.history.length;i+=batchSize){
      const part=parsed.history.slice(i,i+batchSize);
      msg.textContent=`Anagrafiche aggiornate. Import storico ${Math.min(i+part.length,parsed.history.length)}/${parsed.history.length}…`;
      const h=await api("importHistoryBatch",{rows:part});
      imported+=h.saved||0;skipped+=h.skipped||0;
    }
    msg.textContent=`Import completato: ${r.received} commesse · ${imported} righe storiche salvate · ${skipped} saltate · ${r.createdClients} nuovi clienti · ${r.createdJobs} nuove commesse · ${r.updatedJobs} commesse aggiornate.`;
    $("#adminFrom").value="2026-01-01";
    $("#adminTo").value=localDate();
    await loadAdmin();
  }catch(e){msg.textContent=e.message||"Import non riuscito."}
  finally{btn.disabled=false}
});


document.querySelectorAll("[data-admin-jump]").forEach(btn=>btn.addEventListener("click",()=>{
  const id=btn.dataset.adminJump;
  const el=document.getElementById(id);
  const target=el?.closest(".panel")||el;
  if(target)target.scrollIntoView({behavior:"smooth",block:"start"});
}));
document.querySelectorAll("[data-admin-tab]").forEach(btn=>btn.addEventListener("click",()=>{
  const which=btn.dataset.adminTab;
  if(which)setTab(which);
}));

// --- Robustezza globale ---------------------------------------------------------
durationHint($("#manualDuration"));
document.querySelectorAll("[data-quick-minutes]").forEach(b=>b.addEventListener("click",()=>$("#manualDuration").dispatchEvent(new Event("input"))));
new MutationObserver(()=>document.querySelectorAll(".assignment-duration input").forEach(durationHint)).observe(document.body,{childList:true,subtree:true});
window.addEventListener("offline",()=>notify("Connessione assente: le modifiche non verranno salvate finché non torni online.","warn",10000));
window.addEventListener("online",()=>{notify("Connessione ripristinata.","ok");if(profile&&!$("#dayPanel").hidden&&!dayHasUnsavedWork())loadDay()});
window.addEventListener("unhandledrejection",ev=>{console.error(ev.reason);notify(ev.reason?.message||"Errore imprevisto. Ricarica la pagina se il problema persiste.")});
window.addEventListener("beforeunload",ev=>{if(profile&&dayHasUnsavedWork()){ev.preventDefault();ev.returnValue=""}});
