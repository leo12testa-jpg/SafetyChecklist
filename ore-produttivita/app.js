const firebaseConfig={apiKey:"AIzaSyAdgCc8TQ1TVfF8l0NMxtm7NS95ZOl4lCA",authDomain:"safety-checklist-colligo.firebaseapp.com",projectId:"safety-checklist-colligo",storageBucket:"safety-checklist-colligo.firebasestorage.app",messagingSenderId:"792044189701",appId:"1:792044189701:web:8e421f500963a25951846c"};
const API="https://twznfiygzzbqdgudpwav.supabase.co/functions/v1/ore-produttivita-api";
firebase.initializeApp(firebaseConfig);
const db=firebase.firestore();
firebase.auth().setPersistence(firebase.auth.Auth.Persistence.LOCAL);
const $=s=>document.querySelector(s);
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
function inputMinutes(v){const s=String(v||"").trim().toLowerCase().replace(/\s+/g,"");if(/^\d+$/.test(s))return Number(s);const h=(s.match(/(\d+)h/)||[])[1];const m=(s.match(/(\d+)m/)||[])[1];if(h==null&&m==null)return null;const n=Number(h||0)*60+Number(m||0);return Number.isFinite(n)&&n<=1440?n:null}
async function token(){const u=firebase.auth().currentUser;if(!u)throw new Error("Sessione scaduta.");return u.getIdToken()}
async function api(action,body={}){const r=await fetch(API,{method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${await token()}`},body:JSON.stringify({action,...body})});const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||"Richiesta non riuscita.");return j}
async function loadProfile(user){const snap=await db.collection("utenti").doc(user.uid).get({source:"server"});if(!snap.exists)throw new Error("Profilo utente non disponibile.");const p=snap.data();if(p.attivo!==true||!["admin","tecnico"].includes(p.ruolo))throw new Error("Account non attivo.");return {...p,uid:user.uid}}
function showLogin(msg=""){profile=null;loginView.hidden=false;appView.hidden=true;loginError.textContent=msg;loginError.hidden=!msg}
async function showApp(p){profile=p;loginView.hidden=true;appView.hidden=false;$("#userName").textContent=[p.nome,p.cognome].filter(Boolean).join(" ")||p.username;$("#userRole").textContent=p.ruolo==="admin"?"Amministratore":"Tecnico";$("#tabAdmin").hidden=p.ruolo!=="admin";$("#tabEconomics").hidden=p.ruolo!=="admin";await loadDay();if(p.ruolo==="admin")await loadAdmin()}
loginForm.addEventListener("submit",async e=>{e.preventDefault();loginBtn.disabled=true;loginError.hidden=true;try{await firebase.auth().signInWithEmailAndPassword(internalEmail($("#username").value),$("#password").value)}catch(err){showLogin(["auth/invalid-credential","auth/user-not-found","auth/wrong-password"].includes(err.code)?"Credenziali non valide.":err.message)}finally{loginBtn.disabled=false;$("#password").value=""}});
$("#logoutBtn").addEventListener("click",()=>firebase.auth().signOut());
firebase.auth().onAuthStateChanged(async user=>{if(!user){showLogin();return}try{showApp(await loadProfile(user))}catch(e){await firebase.auth().signOut().catch(()=>{});showLogin(e.message)}});
$("#dayDate").value=localDate();$("#adminFrom").value=monthStart();$("#adminTo").value=localDate();
$("#dayDate").addEventListener("change",loadDay);$("#refreshDay").addEventListener("click",loadDay);
let manualCatalogLoaded=false;
async function loadManualCatalog(){
  const client=$("#manualClient"),job=$("#manualJob");
  if(!manualCatalogLoaded){
    const j=await api("catalog");
    client.innerHTML='<option value="">Seleziona cliente…</option>'+j.clienti.map(c=>`<option value="${c.id}">${String(Number(c.codice_breve))} · ${c.ragione_sociale}</option>`).join("");
    manualCatalogLoaded=true;
  }
  if(!client.value){job.innerHTML='<option value="">Seleziona prima il cliente…</option>';return}
  const j=await api("commesse",{clienteId:client.value});
  job.innerHTML='<option value="">Seleziona commessa…</option>'+j.commesse.map(c=>`<option value="${c.id}">${c.codice_lavoro||""} · ${c.descrizione}</option>`).join("");
}
$("#manualToggle").addEventListener("click",async()=>{
  $("#manualCard").hidden=false;
  try{await loadManualCatalog()}catch(e){alert(e.message)}
});
$("#manualClose").addEventListener("click",()=>{$("#manualCard").hidden=true});
$("#manualClient").addEventListener("change",()=>loadManualCatalog().catch(e=>alert(e.message)));
$("#manualSave").addEventListener("click",async()=>{
  const btn=$("#manualSave"),m=inputMinutes($("#manualDuration").value),commessaId=$("#manualJob").value;
  if(!commessaId){alert("Seleziona una commessa.");return}
  if(m==null||m<=0){alert("Inserisci una durata valida, ad esempio 2h30m.");return}
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
  }catch(e){alert(e.message)}
  finally{btn.disabled=false}
});

function fmtClock(v){if(!v)return "—";return new Date(v).toLocaleTimeString("it-IT",{hour:"2-digit",minute:"2-digit"})}
function fmtSyncTime(v){if(!v)return "Non sincronizzato";return new Date(v).toLocaleString("it-IT",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"})}
async function loadSyncStatus(){
  if(!profile)return;
  try{
    const j=await api("syncStatus",{date:$("#dayDate").value});
    $("#crmSyncStatus").textContent=j.lastSync?.created_at?fmtSyncTime(j.lastSync.created_at):"Non sincronizzato";
    const issues=j.openIssues||[];
    const card=$("#syncIssuesCard"),box=$("#syncIssues"),count=$("#syncIssueCount");
    count.textContent=String(issues.length);
    card.hidden=issues.length===0;
    box.innerHTML="";
    for(const issue of issues){
      const row=document.createElement("article");
      row.className="work-entry";
      const candidates=Array.isArray(issue.candidati)?issue.candidati:[];
      const code=issue.codice_lavoro||issue.codice_commessa_crm||"Senza codice";
      const reason=issue.motivo==="ambiguous"?"Più pratiche compatibili":"Codice non riconosciuto";
      row.innerHTML=`<div class="entry-head">
          <div class="entry-code">${code}</div>
          <div class="entry-copy">
            <div class="entry-client">Attività CRM da verificare</div>
            <div class="entry-title">${issue.titolo||"Attività CRM"}</div>
            <div class="entry-meta">
              <span>${reason}</span>
              <span class="entry-origin">Da verificare</span>
              <span>${fmtMinutes(issue.minuti)}</span>
            </div>
          </div>
        </div>
        <div class="entry-side">
          <div class="entry-time"><strong>${fmtClock(issue.inizio)}–${fmtClock(issue.fine)}</strong><span>Orario agenda</span></div>
          <div class="issue-action"></div>
          <div class="issue-save"></div>
        </div>`;
      const action=row.querySelector(".issue-action"),save=row.querySelector(".issue-save");
      if(candidates.length){
        const select=document.createElement("select");
        select.style.width="100%";select.style.minHeight="40px";select.style.border="1px solid var(--line)";select.style.borderRadius="10px";select.style.padding="8px";
        select.innerHTML='<option value="">Scegli pratica…</option>'+candidates.map(c=>`<option value="${c.id}">${c.codiceComm||""} · ${c.descrizione||"Commessa"}</option>`).join("");
        const btn=document.createElement("button");btn.type="button";btn.className="save";btn.textContent="Abbina";
        btn.addEventListener("click",async()=>{
          if(!select.value){alert("Seleziona la pratica corretta.");return}
          btn.disabled=true;
          try{await api("resolveSyncIssue",{issueId:issue.id,commessaId:select.value});await loadDay()}
          catch(e){alert(e.message)}
          finally{btn.disabled=false}
        });
        action.appendChild(select);save.appendChild(btn);
      }else{
        action.innerHTML='<span class="muted" style="font-size:12px">Correggi il codice nell’agenda CRM e sincronizza di nuovo.</span>';
      }
      box.appendChild(row);
    }
  }catch(e){
    console.error("sync status",e);
    $("#crmSyncStatus").textContent="Errore sync";
  }
}
function renderEmpty(){const box=$("#sessions");box.innerHTML='<div class="empty">Nessuna attività presente per questa giornata. Quando colleghiamo l’agenda CRM, qui compariranno automaticamente gli appuntamenti con le ore già calcolate.</div>'}
async function loadDay(){if(!profile)return;$("#dayMessage").hidden=true;try{const j=await api("day",{date:$("#dayDate").value});$("#dayTotal").textContent=fmtMinutes(j.totalMinutes);$("#dayStatus").textContent=j.dayStatus?.stato==="confermata"?"Confermata":"Da verificare";const box=$("#sessions");box.innerHTML="";if(!j.sessions.length){renderEmpty();await loadSyncStatus();return}j.sessions.forEach(s=>{
  const c=s.ore_commesse||{},cl=c.ore_clienti||{},tp=c.ore_tipologie||{};
  const displayCode=((cl.codice_breve?String(Number(cl.codice_breve)):"")+(tp.codice||"P"));
  const origin=s.origine==="crm_agenda"?"CRM":s.origine==="import_storico"?"Storico":"Manuale";
  const row=document.createElement("article");
  row.className="work-entry";
  const start=s.inizio?new Date(s.inizio).toLocaleTimeString("it-IT",{hour:"2-digit",minute:"2-digit"}):"—";
  const end=s.fine?new Date(s.fine).toLocaleTimeString("it-IT",{hour:"2-digit",minute:"2-digit"}):"—";
  row.innerHTML=`<div class="entry-head">
    <div class="entry-code">${displayCode||"—"}</div>
    <div class="entry-copy">
      <div class="entry-client">${cl.ragione_sociale||"Cliente non disponibile"}</div>
      <div class="entry-title">${c.descrizione||s.crm_oggetto||"Attività"}</div>
      <div class="entry-meta">
        <span><b>Tipo:</b> ${tp.nome||"Altro"}</span>
        <span><b>Commessa CRM:</b> ${c.codice_commessa_crm||"—"}</span>
        <span class="entry-origin">${origin}${s.modificata_manualmente?" · modificata":""}</span>
      </div>
    </div>
  </div>
  <div class="entry-side">
    <div class="entry-time"><strong>${start}–${end}</strong><span>${s.inizio&&s.fine?"Orario agenda":"Senza fascia oraria"}</span></div>
    <div class="entry-duration"><input aria-label="Durata effettiva" value="${fmtMinutes(s.minuti_effettivi).replace(" ","")}"></div>
    <button class="save" type="button">Salva</button>
  </div>`;
  const inp=row.querySelector("input"),btn=row.querySelector(".save");
  btn.addEventListener("click",async()=>{
    const m=inputMinutes(inp.value);
    if(m==null){alert("Inserisci una durata come 2h30m.");return}
    btn.disabled=true;
    try{await api("saveSession",{id:s.id,minutiEffettivi:m});await loadDay()}
    catch(e){alert(e.message)}
    finally{btn.disabled=false}
  });
  box.appendChild(row)
});
await loadSyncStatus()}catch(e){$("#dayMessage").textContent=e.message;$("#dayMessage").hidden=false;renderEmpty()}}
$("#confirmDay").addEventListener("click",async()=>{const b=$("#confirmDay");b.disabled=true;try{const j=await api("confirmDay",{date:$("#dayDate").value});$("#dayMessage").textContent=`Giornata confermata: ${fmtMinutes(j.totalMinutes)}.`;$("#dayMessage").hidden=false;await loadDay()}catch(e){alert(e.message)}finally{b.disabled=false}});
function setTab(which){
  const day=which==="day",admin=which==="admin",economics=which==="economics";
  $("#dayPanel").hidden=!day;
  $("#adminPanel").hidden=!admin;
  $("#economicsPanel").hidden=!economics;
  $("#tabDay").classList.toggle("active",day);
  $("#tabAdmin").classList.toggle("active",admin);
  $("#tabEconomics").classList.toggle("active",economics);
  if(admin)loadAdmin();
  if(economics)loadEconomics();
}
$("#tabDay").addEventListener("click",()=>setTab("day"));
$("#tabAdmin").addEventListener("click",()=>setTab("admin"));
$("#tabEconomics").addEventListener("click",()=>setTab("economics"));
$("#loadAdmin").addEventListener("click",loadAdmin);
async function loadAdmin(){
  if(!profile||profile.ruolo!=="admin")return;
  try{
    const [j,crm]=await Promise.all([api("adminSummary",{from:$("#adminFrom").value,to:$("#adminTo").value}),api("crmResources")]);
    $("#kpiHours").textContent=(j.totalMinutes/60).toLocaleString("it-IT",{maximumFractionDigits:1});
    $("#kpiSessions").textContent=j.sessions;
    $("#kpiTechs").textContent=j.technicians;
    $("#kpiJobs").textContent=j.jobs;

    const resources=crm.resources||[];
    $("#crmResourceCount").textContent=String(resources.length);
    $("#crmResourceEmpty").hidden=resources.length>0;
    const crmBody=$("#crmResourceRows");
    crmBody.innerHTML="";
    for(const r of resources){
      const last=r.ultima_sync?new Date(r.ultima_sync).toLocaleString("it-IT",{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"}):"Mai";
      const tr=document.createElement("tr");
      tr.innerHTML=`<td><b>${r.sigla_crm||"—"}</b></td>
        <td>${r.tecnico_nome||r.nome_crm||"—"}</td>
        <td>${last}</td>
        <td>${r.ultima_sync?'<span class="entry-origin">Letta</span>':'<span class="coverage-warning">Da sincronizzare</span>'}</td>`;
      crmBody.appendChild(tr);
    }

    const tb=$("#adminRows");tb.innerHTML="";
    $("#adminEmpty").hidden=j.rows.length>0;
    j.rows.slice(0,100).forEach(r=>{
      const c=r.ore_commesse||{},cl=c.ore_clienti||{},tp=c.ore_tipologie||{};
      const code=(cl.codice_breve&&tp.codice)?String(Number(cl.codice_breve))+tp.codice:"";
      const tr=document.createElement("tr");
      const origin=r.origine==="crm_agenda"?"CRM":r.origine==="import_storico"?"Storico":"Manuale";
      tr.innerHTML=`<td>${new Date(r.data_lavoro+"T12:00:00").toLocaleDateString("it-IT")}</td>
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

    const clientBody=$("#clientRows");clientBody.innerHTML="";
    [...clients.entries()].sort((a,b)=>b[1].minutes-a[1].minutes).slice(0,12).forEach(([name,v])=>{
      const tr=document.createElement("tr");
      tr.innerHTML=`<td><b>${name}</b></td><td>${(v.minutes/60).toLocaleString("it-IT",{maximumFractionDigits:1})}</td><td>${v.sessions}</td>`;
      clientBody.appendChild(tr);
    });
    $("#clientEmpty").hidden=clients.size>0;

    const techBody=$("#technicianRows");techBody.innerHTML="";
    [...techs.entries()].sort((a,b)=>b[1].minutes-a[1].minutes).slice(0,15).forEach(([name,v])=>{
      const tr=document.createElement("tr");
      tr.innerHTML=`<td><b>${name}</b></td><td>${(v.minutes/60).toLocaleString("it-IT",{maximumFractionDigits:1})}</td><td>${v.sessions}</td><td>${v.jobs.size}</td>`;
      techBody.appendChild(tr);
    });
    $("#technicianEmpty").hidden=techs.size>0;

    const types=new Map();
    for(const job of jobs.values()){
      if(job.status!=="completata"||job.typeCode==="P")continue;
      const v=types.get(job.typeCode)||{name:job.type,values:[]};
      v.values.push(job.minutes/60);types.set(job.typeCode,v);
    }
    const prodBody=$("#productivityRows");prodBody.innerHTML="";
    [...types.entries()].sort((a,b)=>a[0].localeCompare(b[0])).forEach(([code,v])=>{
      const vals=v.values,avg=vals.reduce((s,x)=>s+x,0)/vals.length,med=median(vals),min=Math.min(...vals),max=Math.max(...vals);
      const tr=document.createElement("tr");
      tr.innerHTML=`<td><b>${code} · ${v.name}</b></td><td>${vals.length}</td><td>${avg.toLocaleString("it-IT",{maximumFractionDigits:1})} h</td><td><b>${med.toLocaleString("it-IT",{maximumFractionDigits:1})} h</b></td><td>${min.toLocaleString("it-IT",{maximumFractionDigits:1})}–${max.toLocaleString("it-IT",{maximumFractionDigits:1})} h</td>`;
      prodBody.appendChild(tr);
    });
    $("#productivityEmpty").hidden=types.size>0;
  }catch(e){
    console.error(e);
    const box=$("#adminEmpty");if(box){box.textContent="Impossibile caricare i dati della direzione.";box.hidden=false}
  }
}



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
    tr.innerHTML=`<td><b>${tech.tecnico_nome||tech.tecnico_uid}</b><br><span class="muted">${String(tech.tecnico_uid||"").startsWith("legacy:")?"Storico CRM":"Account attuale"}</span></td>
      <td><input class="rate-value" inputmode="decimal" value="${rate?.costo_orario??""}" placeholder="€/h"></td>
      <td><input class="rate-from" type="date" value="${rate?.valido_dal||defaultFrom}"></td>
      <td><input class="rate-to" type="date" value="${rate?.valido_al||""}"></td>
      <td><button class="save rate-save" type="button">Salva</button></td>`;
    const btn=tr.querySelector(".rate-save");
    btn.addEventListener("click",async()=>{
      const cost=numberInput(tr.querySelector(".rate-value").value);
      if(cost===null||cost<0){alert("Inserisci un costo orario valido.");return}
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
      }catch(e){alert(e.message)}
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
    return `<option value="${j.id}">${j.codice_lavoro||"—"} · ${cl.ragione_sociale||"Cliente"} · ${j.descrizione}</option>`;
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
    tr.innerHTML=`<td><b>${j.codice_lavoro||"—"}</b><br><span class="muted">${j.codice_commessa_crm||""}</span></td>
      <td><b>${j.cliente||"—"}</b><br><span class="muted">${j.descrizione||"—"}</span></td>
      <td>${Number(j.ore||0).toLocaleString("it-IT",{maximumFractionDigits:2})} h</td>
      <td>${j.budget_ore===null?"—":Number(j.budget_ore).toLocaleString("it-IT",{maximumFractionDigits:2})+" h"}</td>
      <td>${fmtMoney(j.costo_tecnico)}${complete?"":'<br><span class="coverage-warning">parziale</span>'}</td>
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
    tr.innerHTML=`<td>${new Date(r.data_lavoro+"T12:00:00").toLocaleDateString("it-IT")}</td>
      <td><b>${r.tecnico_nome||"—"}</b></td>
      <td><b>${r.codice_lavoro||"—"}</b><br><span class="muted">${r.codice_commessa_crm||""}</span></td>
      <td><b>${r.cliente||"—"}</b><br><span class="muted">${r.descrizione||"—"}</span></td>
      <td>${(Number(r.minuti||0)/60).toLocaleString("it-IT",{maximumFractionDigits:2})} h</td>
      <td>${r.costo_orario===null?'<span class="coverage-warning">Da valorizzare</span>':fmtMoney(r.costo_orario)+"/h"}</td>
      <td><b>${r.costo_sessione===null?"—":fmtMoney(r.costo_sessione)}</b></td>`;
    detail.appendChild(tr);
  }
}

function renderEstimator(){
  const e=economicsSummary;
  const types=e?.typeStats||[];
  const sel=$("#estimateType"),old=sel.value;
  sel.innerHTML='<option value="">Seleziona tipologia…</option>'+types.map(t=>`<option value="${t.codice}">${t.codice} · ${t.nome} · mediana ${t.mediana_ore} h (${t.n} casi)</option>`).join("");
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
    alert("Impossibile caricare Economia & Margini: "+e.message);
  }
}

$("#reloadEconomics")?.addEventListener("click",loadEconomics);
$("#economicsJob")?.addEventListener("change",fillJobEconomicsForm);
$("#saveJobEconomics")?.addEventListener("click",async()=>{
  const id=$("#economicsJob").value;
  if(!id){alert("Seleziona una pratica.");return}
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

