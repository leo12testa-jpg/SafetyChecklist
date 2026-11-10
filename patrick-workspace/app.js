"use strict";
(function(){
const PROJECT="https://twznfiygzzbqdgudpwav.supabase.co";
const KEY="sb_publishable_Ljz9zk26Q6_se1Zh28lENw_gOPQ14QW";
const TABLE="patrick_workspace_records";
const STORAGE="patrick_workspace_auth_v1";
const titles={home:"Panoramica",agenda:"Agenda",notes:"Note",tasks:"Attività",contacts:"Contatti"};
const categories={note:"Nota",event:"Appuntamento",task:"Attività",contact:"Contatto"};
let session=null,user=null,records=[],activeView="home",selectedDate=dayKey(new Date()),month=new Date(),query="",saving=false;
let lastSync=0;
const $=id=>document.getElementById(id);
const safe=x=>String(x==null?"":x).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function dayKey(d){return [d.getFullYear(),pad(d.getMonth()+1),pad(d.getDate())].join("-")}
function pad(n){return String(n).padStart(2,"0")}
function localValue(iso){if(!iso)return "";let d=new Date(iso);return dayKey(d)+"T"+pad(d.getHours())+":"+pad(d.getMinutes())}
function dateTime(iso){return iso?new Date(iso).toLocaleString("it-IT",{day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"}):"Senza data"}
function dateOnly(iso){return iso?new Date(iso).toLocaleDateString("it-IT",{weekday:"short",day:"2-digit",month:"short"}):""}
function byDate(a,b,key){return (new Date(a[key]||0)).getTime()-(new Date(b[key]||0)).getTime()}
function isToday(s){return s&&dayKey(new Date(s))===dayKey(new Date())}
function button(label,action,id,cls){return '<button class="'+(cls||"mini")+'" data-'+action+'="'+safe(id)+'">'+label+'</button>'}
function empty(title,body){return '<div class="empty"><span class="empty-icon">◌</span><strong>'+safe(title)+'</strong><p>'+safe(body)+'</p></div>'}
function showError(message){$("errorBanner").hidden=false;$("errorBanner").textContent=message}
function clearError(){$("errorBanner").hidden=true;$("errorBanner").textContent=""}
function authFeedback(message,error){$("authMessage").textContent=message;$("authMessage").className="feedback"+(error?" error":"")}
function clean(s){return String(s||"").trim()}
function parseResponse(text){try{return JSON.parse(text)}catch(e){return{text:text}}}
function setSession(s){session=s; if(s){localStorage.setItem(STORAGE,JSON.stringify(s))}else{localStorage.removeItem(STORAGE)}}
async function request(path,method,body,auth,retry){
 if(auth&&session&&session.expires_at&&Date.now()/1000>=session.expires_at-65){await refresh()}
 const h={"apikey":KEY,"Content-Type":"application/json","Accept":"application/json"};
 if(auth&&session?.access_token)h.Authorization="Bearer "+session.access_token;
 if(path.includes("/rest/v1/"))h.Prefer="return=representation";
 let response;
 try{response=await fetch(PROJECT+path,{method:method||"GET",headers:h,body:body===undefined?undefined:JSON.stringify(body)})}
 catch(e){throw new Error("Connessione non disponibile. Controlla la rete e riprova.")}
 if(response.status===401&&auth&&retry!==false&&session?.refresh_token){await refresh();return request(path,method,body,auth,false)}
 const text=await response.text(),value=text?parseResponse(text):{};
 if(!response.ok)throw new Error(value.msg||value.error_description||value.message||value.error||("Errore di rete "+response.status));
 return value;
}
async function refresh(){if(!session?.refresh_token)throw new Error("Sessione scaduta: accedi di nuovo.");
 const data=await request("/auth/v1/token?grant_type=refresh_token","POST",{refresh_token:session.refresh_token},false,false);
 if(!data.access_token)throw new Error("Sessione scaduta: accedi di nuovo.");
 setSession(data);user=data.user||user;return data;
}
async function identify(){if(!session?.access_token)return false;
 try{const profile=await request("/auth/v1/user","GET",undefined,true,true);if(!profile.id)throw Error("Account non disponibile");user=profile;return true}
 catch(e){setSession(null);user=null;return false}
}
function showAuth(){ $("authScreen").hidden=false;$("appShell").hidden=true; $("authPassword").value=""; }
function showApp(){ $("authScreen").hidden=true;$("appShell").hidden=false;$("accountEmail").textContent=user?.email||"Account personale";$("todayLine").textContent=new Date().toLocaleDateString("it-IT",{weekday:"long",day:"numeric",month:"long",year:"numeric"});}
async function login(e){e.preventDefault();if(saving)return;const email=clean($("authEmail").value),password=$("authPassword").value;if(!email||!password)return;
 saving=true;$("loginButton").disabled=true;authFeedback("Verifica credenziali in corso…");
 try{const data=await request("/auth/v1/token?grant_type=password","POST",{email,password},false,false);
 if(!data.access_token)throw Error("Accesso non completato.");
 setSession(data);user=data.user;showApp();await loadAll();
 }catch(e){authFeedback("Impossibile accedere: "+e.message,true)}
 finally{saving=false;$("loginButton").disabled=false}
}
async function signup(){if(saving)return;const email=clean($("authEmail").value),password=$("authPassword").value;if(!email||password.length<8){authFeedback("Inserisci email e una password di almeno 8 caratteri.",true);return}
 if(!confirm("Creare un account personale con questa email? Potrebbe essere richiesta una conferma via email."))return;
 saving=true;$("signupButton").disabled=true;authFeedback("Creazione account…");
 try{const data=await request("/auth/v1/signup?redirect_to="+encodeURIComponent(location.origin+location.pathname),"POST",{email,password},false,false);
 if(data.access_token){setSession(data);user=data.user;showApp();await loadAll()}else{authFeedback("Controlla la tua casella email e conferma l'iscrizione, poi effettua l'accesso.")}
 }catch(e){authFeedback("Registrazione non riuscita: "+e.message,true)}
 finally{saving=false;$("signupButton").disabled=false}
}
async function logout(){const token=session?.access_token;setSession(null);user=null;records=[];showAuth();if(token){try{await fetch(PROJECT+"/auth/v1/logout",{method:"POST",headers:{"apikey":KEY,"Authorization":"Bearer "+token}})}catch(e){}}}
async function loadAll(){clearError();$("syncLabel").textContent="Sincronizzazione in corso…";
 try{const data=await request("/rest/v1/"+TABLE+"?select=*&order=created_at.desc","GET",undefined,true,true);if(!Array.isArray(data))throw Error("Risposta dati inattesa");records=data;
 lastSync=Date.now();$("syncLabel").textContent="Dati sincronizzati · "+new Date().toLocaleTimeString("it-IT",{hour:"2-digit",minute:"2-digit"});render();}
 catch(e){showError("Impossibile caricare i dati: "+e.message);$("syncLabel").textContent="Sincronizzazione non riuscita";render()}
}
function nav(view){if(!titles[view])return;activeView=view;query="";$("searchInput").value="";render()}
function setHeader(){document.querySelectorAll("[data-view]").forEach(b=>b.classList.toggle("selected",b.dataset.view===activeView));$("pageTitle").textContent=query?"Risultati ricerca":titles[activeView];}
function contacts(){return records.filter(r=>r.category==="contact")}
function displayContact(r){const c=records.find(x=>x.id===r.contact_id&&x.category==="contact");return c?.title||r.contact_name||""}
function render(){if($("appShell").hidden)return;setHeader();const el=$("view");if(query){el.innerHTML=renderSearch();return}
 if(activeView==="home")el.innerHTML=renderHome();
 else if(activeView==="agenda")el.innerHTML=renderAgenda();
 else if(activeView==="notes")el.innerHTML=renderNotes();
 else if(activeView==="tasks")el.innerHTML=renderTasks();
 else el.innerHTML=renderContacts();
}
function renderHome(){
 const events=records.filter(r=>r.category==="event"&&r.starts_at);
 const due=records.filter(r=>r.category==="task"&&r.status!=="completata");
 const notes=records.filter(r=>r.category==="note");
 const todayEvents=events.filter(r=>isToday(r.starts_at)).sort((a,b)=>byDate(a,b,"starts_at"));
 const later=events.filter(r=>new Date(r.starts_at).getTime()>=Date.now()&&!isToday(r.starts_at)).sort((a,b)=>byDate(a,b,"starts_at"));
 const todo=due.sort((a,b)=>byDate(a,b,"due_at"));
 return '<section class="section-head"><div><h2>La tua giornata, a colpo d’occhio.</h2><p>Note, telefonate e impegni nello stesso posto.</p></div>'+button("+ Appuntamento","new","event","btn subtle")+'</section>'+
 '<div class="stats"><div class="stat"><small>Appuntamenti oggi</small><strong>'+todayEvents.length+'</strong><em>in agenda</em></div><div class="stat"><small>Attività aperte</small><strong>'+due.length+'</strong><em>da completare</em></div><div class="stat"><small>Note salvate</small><strong>'+notes.length+'</strong><em>nel tuo archivio</em></div><div class="stat"><small>Contatti</small><strong>'+contacts().length+'</strong><em>clienti e collaboratori</em></div></div>'+
 '<div class="home-grid"><div class="stack"><section class="panel"><div class="panel-head"><div><h3>Appuntamenti di oggi</h3><div class="panel-sub">Non perdere nulla di importante</div></div>'+button("Agenda →","go","agenda","panel-action")+'</div><div class="stack">'+(todayEvents.length?todayEvents.map(itemMarkup).join(""):empty("Giornata libera","Nessun appuntamento previsto per oggi."))+'</div></section>'+
 '<section class="panel"><div class="panel-head"><div><h3>Prossimi appuntamenti</h3><div class="panel-sub">Quello che arriva dopo</div></div></div><div class="stack">'+(later.length?later.slice(0,4).map(itemMarkup).join(""):empty("Niente in programma","Aggiungi un appuntamento quando serve."))+'</div></section></div>'+
 '<div class="stack"><section class="panel"><div class="panel-head"><div><h3>Appunto rapido</h3><div class="panel-sub">Ideale durante una telefonata</div></div><span class="pill">SALVA ONLINE</span></div><form id="quickForm" class="quick-form"><input name="title" maxlength="240" placeholder="Es. Telefonata con cliente" aria-label="Titolo nota"><textarea name="details" required maxlength="20000" placeholder="Scrivi subito quello che ti stanno dicendo…"></textarea><div class="quick-foot"><small>Puoi modificarla e collegarla a un contatto dopo.</small><button class="btn primary" type="submit">Salva nota</button></div></form></section>'+
 '<section class="panel"><div class="panel-head"><div><h3>Da fare</h3><div class="panel-sub">Le priorità aperte</div></div>'+button("Vedi tutte →","go","tasks","panel-action")+'</div><div class="stack">'+(todo.length?todo.slice(0,4).map(itemMarkup).join(""):empty("Tutto in ordine","Nessuna attività aperta."))+'</div></section></div></div>';
}
function itemMarkup(r){const date=r.category==="event"?r.starts_at:r.category==="task"?r.due_at:null;const desc=r.category==="contact"?(r.company||r.phone||r.email):r.details||displayContact(r);
return '<div class="item"><div class="item-left"><div class="item-icon">'+({event:"▦",note:"▤",task:"✓",contact:"♧"}[r.category]||"•")+'</div><div class="item-main"><strong>'+safe(r.title)+'</strong><p>'+safe((desc||"").slice(0,130))+'</p>'+(date?'<small>'+safe(dateTime(date))+'</small>':r.contact_id?'<small>↳ '+safe(displayContact(r))+'</small>':"")+'</div></div><div class="item-tools">'+(r.category==="task"?'<span class="pill '+safe(r.status==="completata"?"completata":r.priority)+'">'+safe(r.status==="completata"?"Fatta":r.priority)+'</span>':"")+button("Apri","edit",r.id)+'</div></div>';
}
function renderAgenda(){
 const first=new Date(month.getFullYear(),month.getMonth(),1),offset=(first.getDay()+6)%7;
 const start=new Date(first.getFullYear(),first.getMonth(),1-offset);
 const days=["lun","mar","mer","gio","ven","sab","dom"];
 const evts=records.filter(r=>r.category==="event"&&r.starts_at);
 let grid=days.map(d=>'<div class="calendar-weekday">'+d+'</div>').join("");
 for(let i=0;i<42;i++){const d=new Date(start.getFullYear(),start.getMonth(),start.getDate()+i),key=dayKey(d),list=evts.filter(r=>dayKey(new Date(r.starts_at))===key);
 grid+='<button type="button" data-day="'+key+'" class="calendar-day'+(d.getMonth()!==month.getMonth()?" outside":"")+(key===selectedDate?" active":"")+(key===dayKey(new Date())?" today":"")+'"><b>'+d.getDate()+'</b><span class="dots">'+list.slice(0,5).map(() =>'<i class="dot"></i>').join("")+'</span></button>';}
 const chosen=evts.filter(r=>dayKey(new Date(r.starts_at))===selectedDate).sort((a,b)=>byDate(a,b,"starts_at"));
 return '<div class="toolbar"><div class="toolbar-group"><button class="mini" data-month="-1">‹</button><span class="month-title">'+safe(first.toLocaleDateString("it-IT",{month:"long",year:"numeric"}))+'</span><button class="mini" data-month="1">›</button><button class="mini" data-today="1">Oggi</button></div>'+button("+ Appuntamento","new","event","btn primary")+'</div><section class="calendar"><div class="calendar-grid">'+grid+'</div></section><section class="calendar-agenda panel"><div class="panel-head"><h3>'+safe(new Date(selectedDate+"T12:00:00").toLocaleDateString("it-IT",{weekday:"long",day:"numeric",month:"long"}))+'</h3></div><div class="stack">'+(chosen.length?chosen.map(itemMarkup).join(""):empty("Nessun appuntamento","Crea un evento per questo giorno."))+'</div></section>';
}
function renderNotes(){const notes=records.filter(r=>r.category==="note");
 return '<section class="section-head"><div><h2>Note e telefonate</h2><p>Ogni informazione importante, sempre recuperabile.</p></div>'+button("+ Nuova nota","new","note","btn primary")+'</section><div class="list-grid">'+(notes.length?notes.map(r=>'<article class="note-card"><h3>'+safe(r.title)+'</h3><p>'+safe(r.details)+'</p>'+(displayContact(r)?'<span class="pill">'+safe(displayContact(r))+'</span>':"")+'<footer><small>'+safe(dateTime(r.created_at))+'</small><span>'+button("Modifica","edit",r.id)+button("Attività","convert",r.id)+'</span></footer></article>').join(""):empty("Ancora nessuna nota","Scrivi la prima nota dalla dashboard o da qui."))+'</div>';}
function renderTasks(){const tasks=records.filter(r=>r.category==="task").sort((a,b)=>(a.status==="completata")-(b.status==="completata")||byDate(a,b,"due_at"));
 return '<section class="section-head"><div><h2>Attività e follow-up</h2><p>Tieni sotto controllo le scadenze.</p></div>'+button("+ Nuova attività","new","task","btn primary")+'</section><div class="stack">'+(tasks.length?tasks.map(r=>'<div class="item"><div class="item-left"><button title="Segna completata / riapri" class="check-btn '+(r.status==="completata"?"done":"")+'" data-done="'+safe(r.id)+'">'+(r.status==="completata"?"✓":"○")+'</button><div class="item-main"><strong'+(r.status==="completata"?' style="text-decoration:line-through;color:#9baab5"':"")+'>'+safe(r.title)+'</strong><p>'+safe((r.details||"").slice(0,200))+'</p><small>'+safe(r.due_at?dateTime(r.due_at):"Nessuna scadenza")+' '+(displayContact(r)?"· "+safe(displayContact(r)):"")+'</small></div></div><div class="item-tools"><span class="pill '+safe(r.status==="completata"?"completata":r.priority)+'">'+safe(r.status==="completata"?"Fatta":r.priority)+'</span>'+button("Modifica","edit",r.id)+'</div></div>').join(""):empty("Nessuna attività","Aggiungi attività, promemoria e follow-up."))+'</div>';
}
function renderContacts(){const cs=contacts().slice().sort((a,b)=>a.title.localeCompare(b.title,"it"));
 return '<section class="section-head"><div><h2>Rubrica clienti</h2><p>Contatti e informazioni per le tue conversazioni.</p></div>'+button("+ Aggiungi contatto","new","contact","btn primary")+'</section><div class="list-grid">'+(cs.length?cs.map(r=>'<article class="note-card"><h3>'+safe(r.title)+'</h3><p>'+safe([r.company,r.phone,r.email].filter(Boolean).join("\n"))+'</p><footer><small>'+records.filter(x=>x.contact_id===r.id).length+' elementi collegati</small><span>'+button("Nota","contactnote",r.id)+button("Apri","edit",r.id)+'</span></footer></article>').join(""):empty("Rubrica vuota","Aggiungi il primo cliente o collaboratore."))+'</div>';
}
function renderSearch(){const words=query.toLocaleLowerCase("it");const found=records.filter(r=>[r.title,r.details,r.company,r.phone,r.email,r.tags,displayContact(r)].join(" ").toLocaleLowerCase("it").includes(words));
 return '<section class="section-head"><div><h2>Risultati per “'+safe(query)+'”</h2><p>'+found.length+' elementi trovati nel tuo archivio.</p></div></section><div class="stack">'+(found.length?found.map(r=>'<div><span class="pill">'+safe(categories[r.category])+'</span>'+itemMarkup(r)+'</div>').join(""):empty("Nessun risultato","Prova con un altro nome o parola chiave."))+'</div>';
}
function openDialog(kind,id,contact){
 const r=id?records.find(x=>x.id===id):null,cat=r?.category||kind||"note";
 if(id&&!r)return;const form=$("recordForm");form.reset();form.dataset.editId=id||"";form.dataset.kind=cat;$("deleteRecordButton").hidden=!id;$("formMessage").textContent="";$("formTitle").textContent=(id?"Modifica ":"Nuova ")+categories[cat].toLocaleLowerCase("it");const sel=$("fieldContact");
 sel.innerHTML='<option value="">Nessuno</option>'+contacts().map(c=>'<option value="'+safe(c.id)+'">'+safe(c.title)+(c.company?" · "+safe(c.company):"")+'</option>').join("");
 for(const name of ["category","title","details","priority","status","contact_id","company","phone","email","tags"]){const node=form.elements.namedItem(name);if(node&&r&&r[name]!=null)node.value=r[name]}
 form.elements.namedItem("category").value=cat;form.elements.namedItem("starts_at").value=localValue(r?.starts_at);form.elements.namedItem("due_at").value=localValue(r?.due_at);
 if(!r&&cat==="event"){form.elements.namedItem("starts_at").value=selectedDate+"T09:00"}
 if(!r&&contact){form.elements.namedItem("contact_id").value=contact}
 $("recordDialog").showModal();
}
function configureFields(){const cat=$("fieldCategory").value;$("recordForm").dataset.kind=cat;$("formTitle").textContent=($("recordForm").dataset.editId?"Modifica ":"Nuova ")+categories[cat].toLocaleLowerCase("it")}
async function saveRecord(e){e.preventDefault();if(saving)return;const f=$("recordForm"),category=f.elements.namedItem("category").value,title=clean(f.elements.namedItem("title").value);
 if(!title){$("formMessage").textContent="Inserisci un titolo.";return}
 const value=n=>clean(f.elements.namedItem(n)?.value);
 const id=f.dataset.editId,contactId=category==="contact"?"":value("contact_id");
 const contact=contacts().find(c=>c.id===contactId);
 const data={category,title,details:value("details"),starts_at:category==="event"&&value("starts_at")?new Date(value("starts_at")).toISOString():null,due_at:category==="task"&&value("due_at")?new Date(value("due_at")).toISOString():null,contact_id:contactId||null,contact_name:contact?.title||"",company:category==="contact"?value("company"):"",phone:category==="contact"?value("phone"):"",email:category==="contact"?value("email"):"",priority:value("priority")||"media",status:value("status")||"aperta",tags:category==="contact"?"":value("tags"),updated_at:new Date().toISOString()};
 saving=true;$("saveRecord").disabled=true;$("formMessage").textContent="Salvataggio online…";
 try{if(id){await request("/rest/v1/"+TABLE+"?id=eq."+encodeURIComponent(id),"PATCH",data,true,true)}
 else{await request("/rest/v1/"+TABLE,"POST",data,true,true)}
 $("recordDialog").close();await loadAll();
 }catch(e){$("formMessage").textContent="Errore: "+e.message}
 finally{saving=false;$("saveRecord").disabled=false}
}
async function saveQuick(e){e.preventDefault();if(saving)return;const form=e.target,title=clean(form.elements.namedItem("title").value)||"Nota telefonica",details=clean(form.elements.namedItem("details").value);if(!details)return;saving=true;
 const btn=form.querySelector('[type="submit"]');btn.disabled=true;btn.textContent="Salvataggio…";
 try{await request("/rest/v1/"+TABLE,"POST",{category:"note",title,details,tags:"telefonata"},true,true);await loadAll()}
 catch(err){showError("Impossibile salvare la nota: "+err.message)}
 finally{saving=false;btn.disabled=false;btn.textContent="Salva nota"}
}
async function toggleTask(id){const r=records.find(x=>x.id===id&&x.category==="task");if(!r)return;
 try{await request("/rest/v1/"+TABLE+"?id=eq."+encodeURIComponent(id),"PATCH",{status:r.status==="completata"?"aperta":"completata",updated_at:new Date().toISOString()},true,true);await loadAll()}
 catch(e){showError(e.message)}
}
async function deleteRecord(id){const r=records.find(x=>x.id===id);if(!r||!confirm("Eliminare definitivamente “"+r.title+"”?"))return;
 try{await request("/rest/v1/"+TABLE+"?id=eq."+encodeURIComponent(id),"DELETE",undefined,true,true);$("recordDialog").close();await loadAll()}
 catch(e){showError("Eliminazione non riuscita: "+e.message)}
}
function exportBackup(){const blob=new Blob([JSON.stringify({exportedAt:new Date().toISOString(),records},null,2)],{type:"application/json;charset=utf-8"}),url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download="patrick-workspace-backup-"+dayKey(new Date())+".json";document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000)}
document.addEventListener("click",async e=>{
 const b=e.target.closest("button");if(!b)return;
 if(b.dataset.view){nav(b.dataset.view);return}
 if(b.dataset.go){nav(b.dataset.go);return}
 if(b.dataset.new){openDialog(b.dataset.new);return}
 if(b.dataset.edit){openDialog(null,b.dataset.edit);return}
 if(b.dataset.done){await toggleTask(b.dataset.done);return}
 if(b.dataset.delete){await deleteRecord(b.dataset.delete);return}
 if(b.dataset.contactnote){openDialog("note",null,b.dataset.contactnote);return}
 if(b.dataset.convert){const r=records.find(x=>x.id===b.dataset.convert);openDialog("task");if(r){$("recordForm").elements.namedItem("title").value="Follow-up: "+r.title;$("recordForm").elements.namedItem("details").value=r.details;$("recordForm").elements.namedItem("contact_id").value=r.contact_id||""}return}
 if(b.dataset.day){selectedDate=b.dataset.day;month=new Date(b.dataset.day+"T12:00:00");render();return}
 if(b.dataset.month){month=new Date(month.getFullYear(),month.getMonth()+Number(b.dataset.month),1);selectedDate=dayKey(month);render();return}
 if(b.dataset.today){month=new Date();selectedDate=dayKey(month);render();return}
});
$("authForm").addEventListener("submit",login);
$("signupButton").addEventListener("click",signup);
$("logoutButton").addEventListener("click",()=>logout());
$("exportButton").addEventListener("click",exportBackup);
$("addButton").addEventListener("click",()=>openDialog(activeView==="agenda"?"event":activeView==="tasks"?"task":activeView==="contacts"?"contact":"note"));
$("closeDialog").addEventListener("click",()=>$("recordDialog").close());
$("cancelForm").addEventListener("click",()=>$("recordDialog").close());
$("deleteRecordButton").addEventListener("click",async()=>{const id=$("recordForm").dataset.editId;if(id)await deleteRecord(id)});
$("fieldCategory").addEventListener("change",configureFields);
$("recordForm").addEventListener("submit",saveRecord);
$("searchInput").addEventListener("input",e=>{query=clean(e.target.value);render()});
$("view").addEventListener("submit",e=>{if(e.target.id==="quickForm")saveQuick(e)});
$("recordDialog").addEventListener("click",e=>{if(e.target===$("recordDialog"))$("recordDialog").close()});
document.head.insertAdjacentHTML("beforeend",'<style>@media(max-width:900px){.topbar{flex-wrap:wrap}.searchbox{display:flex;order:3;flex:1 0 100%}.searchbox input{width:100%}}</style>');
async function start(){try{session=JSON.parse(localStorage.getItem(STORAGE)||"null")}catch(e){session=null}
 if(session){if(await identify()){showApp();await loadAll();return}}
 showAuth();}
function refreshOnReturn(){if(!$("appShell").hidden&&!saving&&!$("recordDialog").open&&Date.now()-lastSync>15000){loadAll()}}
window.addEventListener("focus",refreshOnReturn);
document.addEventListener("visibilitychange",()=>{if(!document.hidden)refreshOnReturn()});
start();
})();