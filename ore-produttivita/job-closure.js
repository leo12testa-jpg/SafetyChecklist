function inactivityDays(job,today){
 if(!["in_lavorazione","sospesa"].includes(job.stato))return null;
 const last=job.ultima_attivita||job.data_apertura;if(!last)return null;
 const days=(Date.parse(today+"T12:00:00Z")-Date.parse(last+"T12:00:00Z"))/86400000;
 return Number.isFinite(days)?Math.floor(days):null;
}
function renderJobClosure(data){
 const job=data.job,host=$("#jobClosure"),closing=job.stato!=="completata";
 host.innerHTML=html`<h3>Chiusura della pratica</h3><p>Ultima consegna: ${job.consegna_data||"non indicato"} · Revisioni cliente: ${job.revisioni_cliente??"non indicato"} · Nota: ${job.nota_chiusura||"non indicato"}</p>
 ${["in_lavorazione","sospesa","completata"].includes(job.stato)?html`<form id="jobClosureForm">${closing?html`<label>Data consegna<input name="delivery" type="date" required></label><label>Revisioni richieste dal cliente<input name="revisions" type="number" min="0" max="100000" step="1" required></label>`:""}<label>Nota<textarea name="note" maxlength="2000"></textarea></label><button type="submit">${closing?"Chiudi pratica":"Riapri pratica"}</button></form>`:""}
 <h4>Registro chiusure e riaperture</h4>${(data.closureHistory||[]).length?html`<ul>${data.closureHistory.map(e=>html`<li>${new Date(e.created_at).toLocaleString("it-IT",{timeZone:"Europe/Rome"})} · ${e.azione} · ${e.attore_uid} · ${e.nota||"non indicato"}</li>`)}</ul>`:html`<p>Nessun evento registrato. Le chiusure storiche senza registro restano valide.</p>`}`;
 host.querySelector("form")?.addEventListener("submit",async event=>{
  event.preventDefault();const form=event.currentTarget;if(!form.reportValidity())return;
  const button=form.querySelector("button"),fields=new FormData(form);button.disabled=true;
  try{
   await api("changeJobState",{commessaId:job.id,updatedAt:job.updated_at,operation:closing?"close":"reopen",consegnaData:fields.get("delivery"),revisioniCliente:closing?Number(fields.get("revisions")):null,nota:fields.get("note")});
   archiveData=null;archiveLoadedAt=0;await loadArchive();await openArchiveJob(job.id);await loadAdmin();notify(closing?"Pratica chiusa.":"Pratica riaperta.","ok");
  }catch(e){notify(e.message);}finally{button.disabled=false;}
 });
}
