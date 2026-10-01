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
function inputMinutes(v){const s=String(v||"").trim().toLowerCase().replace(/\s+/g,"");if(/^\d+$/.test(s))return Number(s);const h=(s.match(/(\d+)h/)||[])[1];const m=(s.match(/(\d+)m/)||[])[1];if(h==null&&m==null)return null;const n=Number(h||0)*60+Number(m||0);return Number.isFinite(n)&&n<=1440?n:null}
async function token(){const u=firebase.auth().currentUser;if(!u)throw new Error("Sessione scaduta.");return u.getIdToken()}
async function api(action,body={}){const r=await fetch(API,{method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${await token()}`},body:JSON.stringify({action,...body})});const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||"Richiesta non riuscita.");return j}
async function loadProfile(user){const snap=await db.collection("utenti").doc(user.uid).get({source:"server"});if(!snap.exists)throw new Error("Profilo utente non disponibile.");const p=snap.data();if(p.attivo!==true||!["admin","tecnico"].includes(p.ruolo))throw new Error("Account non attivo.");return {...p,uid:user.uid}}
function showLogin(msg=""){profile=null;loginView.hidden=false;appView.hidden=true;loginError.textContent=msg;loginError.hidden=!msg}
async function showApp(p){profile=p;loginView.hidden=true;appView.hidden=false;$("#userName").textContent=[p.nome,p.cognome].filter(Boolean).join(" ")||p.username;$("#userRole").textContent=p.ruolo==="admin"?"Amministratore":"Tecnico";$("#tabAdmin").hidden=p.ruolo!=="admin";await loadDay();if(p.ruolo==="admin")await loadAdmin()}
loginForm.addEventListener("submit",async e=>{e.preventDefault();loginBtn.disabled=true;loginError.hidden=true;try{await firebase.auth().signInWithEmailAndPassword(internalEmail($("#username").value),$("#password").value)}catch(err){showLogin(["auth/invalid-credential","auth/user-not-found","auth/wrong-password"].includes(err.code)?"Credenziali non valide.":err.message)}finally{loginBtn.disabled=false;$("#password").value=""}});
$("#logoutBtn").addEventListener("click",()=>firebase.auth().signOut());
firebase.auth().onAuthStateChanged(async user=>{if(!user){showLogin();return}try{showApp(await loadProfile(user))}catch(e){await firebase.auth().signOut().catch(()=>{});showLogin(e.message)}});
$("#dayDate").value=localDate();$("#adminFrom").value=monthStart();$("#adminTo").value=localDate();
$("#dayDate").addEventListener("change",loadDay);$("#refreshDay").addEventListener("click",loadDay);
function renderEmpty(){const box=$("#sessions");box.innerHTML='<div class="empty">Nessuna attività presente per questa giornata. Quando colleghiamo l’agenda CRM, qui compariranno automaticamente gli appuntamenti con le ore già calcolate.</div>'}
async function loadDay(){if(!profile)return;$("#dayMessage").hidden=true;try{const j=await api("day",{date:$("#dayDate").value});$("#dayTotal").textContent=fmtMinutes(j.totalMinutes);$("#dayStatus").textContent=j.dayStatus?.stato==="confermata"?"Confermata":"Da verificare";const box=$("#sessions");box.innerHTML="";if(!j.sessions.length){renderEmpty();return}j.sessions.forEach(s=>{const c=s.ore_commesse||{},cl=c.ore_clienti||{},tp=c.ore_tipologie||{};const row=document.createElement("article");row.className="work-row";const start=s.inizio?new Date(s.inizio).toLocaleTimeString("it-IT",{hour:"2-digit",minute:"2-digit"}):"—";const end=s.fine?new Date(s.fine).toLocaleTimeString("it-IT",{hour:"2-digit",minute:"2-digit"}):"—";row.innerHTML=`<div class="time">${start}–${end}</div><div class="job"><strong>${cl.ragione_sociale||"Cliente"} · ${c.descrizione||s.crm_oggetto||"Attività"}</strong><small>${c.codice_breve||""} ${tp.nome?"· "+tp.nome:""}</small><span class="badge">${s.origine==="crm_agenda"?"Da agenda CRM":s.origine==="import_storico"?"Storico":"Manuale"}${s.modificata_manualmente?" · modificata":""}</span></div><div class="duration"><input aria-label="Durata effettiva" value="${fmtMinutes(s.minuti_effettivi).replace(" ","")}"></div><button class="save" type="button">Salva</button>`;const inp=row.querySelector("input"),btn=row.querySelector(".save");btn.addEventListener("click",async()=>{const m=inputMinutes(inp.value);if(m==null){alert("Inserisci una durata come 2h30m.");return}btn.disabled=true;try{await api("saveSession",{id:s.id,minutiEffettivi:m});await loadDay()}catch(e){alert(e.message)}finally{btn.disabled=false}});box.appendChild(row)})}catch(e){$("#dayMessage").textContent=e.message;$("#dayMessage").hidden=false;renderEmpty()}}
$("#confirmDay").addEventListener("click",async()=>{const b=$("#confirmDay");b.disabled=true;try{const j=await api("confirmDay",{date:$("#dayDate").value});$("#dayMessage").textContent=`Giornata confermata: ${fmtMinutes(j.totalMinutes)}.`;$("#dayMessage").hidden=false;await loadDay()}catch(e){alert(e.message)}finally{b.disabled=false}});
function setTab(which){const day=which==="day";$("#dayPanel").hidden=!day;$("#adminPanel").hidden=day;$("#tabDay").classList.toggle("active",day);$("#tabAdmin").classList.toggle("active",!day)}
$("#tabDay").addEventListener("click",()=>setTab("day"));$("#tabAdmin").addEventListener("click",()=>setTab("admin"));
$("#loadAdmin").addEventListener("click",loadAdmin);
async function loadAdmin(){if(!profile||profile.ruolo!=="admin")return;try{const j=await api("adminSummary",{from:$("#adminFrom").value,to:$("#adminTo").value});$("#kpiHours").textContent=(j.totalMinutes/60).toLocaleString("it-IT",{maximumFractionDigits:1});$("#kpiSessions").textContent=j.sessions;$("#kpiTechs").textContent=j.technicians;$("#kpiJobs").textContent=j.jobs;const tb=$("#adminRows");tb.innerHTML="";$("#adminEmpty").hidden=j.rows.length>0;j.rows.slice(0,100).forEach(r=>{const c=r.ore_commesse||{},cl=c.ore_clienti||{},tp=c.ore_tipologie||{};const tr=document.createElement("tr");tr.innerHTML=`<td>${new Date(r.data_lavoro+"T12:00:00").toLocaleDateString("it-IT")}</td><td>${r.tecnico_nome||r.tecnico_uid}</td><td><b>${cl.ragione_sociale||"—"}</b><br><span class="muted">${c.descrizione||"—"}</span></td><td>${tp.nome||"—"}</td><td>${fmtMinutes(r.minuti_effettivi)}</td>`;tb.appendChild(tr)})}catch(e){console.error(e)}}


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
    msg.textContent=`Import completato: ${r.received} commesse lette · ${r.createdClients} nuovi clienti · ${r.createdJobs} nuove commesse · ${r.updatedJobs} aggiornate.`;
    await loadAdmin();
  }catch(e){msg.textContent=e.message||"Import non riuscito."}
  finally{btn.disabled=false}
});
