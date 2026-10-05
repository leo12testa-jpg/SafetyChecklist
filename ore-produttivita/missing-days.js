let missingPersonalSeq=0;
async function loadMissingPersonal(){
 const host=$("#missingPersonal"),seq=++missingPersonalSeq;
 try{
  const data=await api("missingDays",{scope:"mine"});if(seq!==missingPersonalSeq)return;
  const rows=(data.rows||[]).filter(r=>!r.confirmed);host.hidden=!rows.length;
  host.innerHTML=html`<strong>${rows.length} giornate precedenti non confermate</strong><p>Apri la data per verificarla.</p>${rows.map(row=>html`<button type="button" data-missing-date="${row.date}">${archiveDate(row.date)}</button>`)}`;
  for(const button of host.querySelectorAll("button"))button.addEventListener("click",()=>{
   if(dayHasUnsavedWork()){notify("Salva o annulla le modifiche prima di cambiare data.","warn");return;}
   $("#dayDate").value=button.dataset.missingDate;loadDay();
  });
 }catch(e){if(seq!==missingPersonalSeq)return;host.hidden=false;host.innerHTML=html`<p>Impossibile verificare le giornate precedenti: ${e.message}</p>`;}
}
async function loadMissingAdmin(){
 const button=$("#loadMissingDays");button.disabled=true;
 try{
  const data=await api("missingDays",{scope:"all"});$("#missingPeriod").textContent=`${archiveDate(data.from)} – ${archiveDate(data.to)} · ${data.people} account attivi · ${data.rows.length} giornate da verificare`;
  $("#missingAdminRows").innerHTML=html`${(data.rows||[]).map(r=>html`<tr><td>${r.tecnico_nome}</td><td>${archiveDate(r.date)}</td><td>${fmtMinutes(r.expectedMinutes)}<br><small>${r.expectedSource}</small></td><td>${fmtMinutes(r.reportedMinutes)}</td><td>${fmtMinutes(r.absenceMinutes)}</td><td>${r.confirmed?"Confermata":"Non confermata"}${r.underHours?html`<br>Ore sotto il previsto`:""}</td></tr>`)}`;
 }catch(e){notify(e.message);}finally{button.disabled=false;}
}
$("#loadMissingDays").addEventListener("click",loadMissingAdmin);
if(profile&&!$("#dayPanel").hidden)loadMissingPersonal();
