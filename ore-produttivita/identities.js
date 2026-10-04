function addIdentityActions(row,resource){
 const host=document.createElement("div");host.innerHTML=html`<button class="identity-existing" type="button">Collega anche lo storico</button><button class="identity-new" type="button">Crea tecnico e collega</button>`;
 row.lastElementChild.appendChild(host);
 host.querySelector(".identity-existing").addEventListener("click",()=>{const uid=row.querySelector(".crm-target").value;if(!uid){notify("Seleziona prima un account.","warn");return;}previewIdentity(resource,uid).catch(e=>notify(e.message));});
 host.querySelector(".identity-new").addEventListener("click",()=>previewIdentity(resource,null).catch(e=>notify(e.message)));
}
async function createTechnician(fields){
 const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),25000);
 try{
  const token=await firebase.auth().currentUser.getIdToken();
  const response=await fetch(API.replace("ore-produttivita-api","manage-users"),{method:"POST",headers:{authorization:`Bearer ${token}`,"content-type":"application/json"},signal:controller.signal,body:JSON.stringify({action:"create",ruolo:"tecnico",...fields})});
  const data=await response.json();if(!response.ok)throw new Error(data.error||"Creazione account non riuscita.");if(!data.user?.uid)throw new Error("Creazione non verificata: controlla l’elenco account prima di riprovare.");return data.user.uid;
 }finally{clearTimeout(timeout);}
}
async function previewIdentity(resource,targetUid){
 const data=await api("previewIdentity",{resourceId:resource.id});
 const host=$("#crmLinkPreview");host.hidden=false;
 host.innerHTML=html`<h4>Identità ${resource.sigla_crm}</h4><p>${data.sessions} sessioni · ${fmtMinutes(data.minutes)} su ${data.legacyUid}. L’UID originale resta invariato; lo storico viene attribuito all’account scelto nelle analisi.</p>
  <p>Alias attuale: ${data.alias?.tecnico_uid||"non indicato"}. Nessuna sessione sarà trasferita.</p>
  ${targetUid?html`<p>Account destinazione: ${targetUid}</p>`:html`<form id="identityAccountForm"><label>Nome<input name="nome" required maxlength="80" autocomplete="off"></label><label>Cognome<input name="cognome" required maxlength="80" autocomplete="off"></label><label>Username<input name="username" required pattern="[a-z0-9]([a-z0-9._]|-){1,38}[a-z0-9]" autocomplete="off"></label><label>Password iniziale<input name="password" type="password" required minlength="12" maxlength="128" autocomplete="new-password"></label><p>Ruolo: tecnico. Compila solo gli account dell’elenco approvato da Colligo.</p></form>`}
  <label><input class="identity-check" type="checkbox">Confermo che risorsa, storico e account appartengono alla stessa persona</label>
  <button class="identity-confirm" type="button">${targetUid?"Conferma alias e collegamento":"Crea account, alias e collegamento"}</button><button class="identity-cancel" type="button">Annulla</button><p class="identity-result" role="status"></p>`;
 let createdUid=targetUid,creationAttempted=false;
 host.querySelector(".identity-cancel").addEventListener("click",()=>{host.hidden=true;host.innerHTML=html``;});
 host.querySelector(".identity-confirm").addEventListener("click",async event=>{
  const button=event.currentTarget;
  if(!host.querySelector(".identity-check").checked){notify("Conferma prima l’identità della persona.","warn");return;}
  const form=host.querySelector("form");if(form&&!createdUid&&!form.reportValidity())return;
  button.disabled=true;
  try{
   if(!createdUid){if(creationAttempted)throw new Error("Creazione già richiesta: controlla l’elenco account prima di riprovare.");creationAttempted=true;const fields=Object.fromEntries(new FormData(form));createdUid=await createTechnician(fields);form.querySelector('[name="password"]').value="";host.querySelector(".identity-result").textContent=`Account creato: ${createdUid}. Collegamento in corso.`;}
   await api("approveIdentity",{resourceId:resource.id,tecnicoUid:createdUid,previousUid:data.resource.tecnico_uid,previousApproval:data.resource.collegamento_approvato_at,previousAlias:data.alias?.tecnico_uid||null});
   notify("Identità approvata; storico preservato.","ok");host.hidden=true;host.innerHTML=html``;archiveData=null;await loadCrmLinks();await loadAdmin();
  }catch(e){host.querySelector(".identity-result").textContent=createdUid&&!targetUid?`Account creato (${createdUid}), collegamento non completato: ${e.message}. Usa l’account esistente per riprendere.`:e.message;notify(e.message);}
  finally{button.disabled=false;}
 });
 host.scrollIntoView({behavior:"smooth",block:"nearest"});
}
