// The backend rechecks the target account, administrator role and every selected session.
async function loadCrmLinks(){
  const button=$("#loadCrmLinks");button.disabled=true;
  try{
    const data=await api("crmLinks");
    const body=$("#crmLinksRows");body.innerHTML=html``;
    const ambiguous=data.ambigui||{};
    $("#crmLinksAmbiguous").innerHTML=html`<p>Risorse senza account: ${(ambiguous.senza_tecnico||[]).join(", ")||"nessuna"}.</p>
      <p>Nomi con parole comuni, da verificare: ${(ambiguous.nomi_simili||[]).map(p=>`${p.a} / ${p.b}`).join(", ")||"nessuno"}.</p>
      <p>Tecnici con più risorse: ${(ambiguous.tecnici_con_piu_risorse||[]).map(t=>`${t.nome}: ${t.risorse.join(", ")}`).join("; ")||"nessuno"}.</p>
      ${(data.limiti?.storico||data.limiti?.attivita)?html`<p>Elenco parziale: raggiunto il limite di 1000 record.</p>`:""}`;
    for(const r of data.rows||[]){
      const tr=document.createElement("tr");
      tr.innerHTML=html`<td>${r.nome_crm}<br><b>${r.sigla_crm}</b></td>
        <td>${r.account_reale?(r.tecnico_nome||"non indicato"):"Nessun account tecnico"}<br><small>${r.tecnico_uid||"non indicato"}</small></td>
        <td>${r.origine_collegamento||"non indicato"}<br>${r.data_collegamento?new Date(r.data_collegamento).toLocaleString("it-IT"):"non indicato"}
          <details><summary>Storico collegamenti</summary>${(r.storico||[]).map(a=>html`<p>${new Date(a.created_at).toLocaleString("it-IT")} · ${a.tecnico_uid} · ${a.azione}<br>${a.dettagli?.vecchio_uid||a.dettagli?.prima?.tecnico_uid||"non indicato"} → ${a.dettagli?.nuovo_uid||a.dettagli?.dopo_uid||"non indicato"}</p>`)}</details></td>
        <td>${r.sessioni_risorsa} attribuite alla risorsa<br>${r.sessioni_uid_storiche} storiche sull’UID, risorsa non indicata</td>
        <td><b>${r.stato_collegamento}</b><br><label>Account per ${r.sigla_crm}<select class="crm-target"><option value="">Seleziona account…</option>${(data.technicians||[]).map(t=>html`<option value="${t.uid}">${t.nome||t.uid}</option>`)}</select></label><button class="crm-preview" type="button">Anteprima e conferma</button></td>`;
      const select=tr.querySelector("select");if(r.account_reale)select.value=r.tecnico_uid;
      tr.querySelector("button").addEventListener("click",async()=>{
        if(!select.value){notify("Seleziona un account tecnico.","warn");return;}
        try{await previewCrmLink(r,select.value,data.technicians||[]);}catch(e){notify(e.message);}
      });
      body.appendChild(tr);
      if(typeof addIdentityActions==="function")addIdentityActions(tr,r);
    }
    const pending=$("#crmLinkPending");pending.innerHTML=html``;
    for(const p of data.pending||[]){const tr=document.createElement("tr");tr.innerHTML=html`<td>${p.candidati?.[0]?.sigla||"non indicato"}</td><td>${fmtDateIt(p.data_lavoro)}</td><td>${p.titolo||"non indicato"}</td><td>${p.minuti}</td>`;pending.appendChild(tr);}
  }catch(e){notify(e.message);}finally{button.disabled=false;}
}
async function previewCrmLink(resource,targetUid,technicians){
  const data=await api("previewCrmLink",{resourceId:resource.id});
  const target=technicians.find(t=>t.uid===targetUid);
  const host=$("#crmLinkPreview");host.hidden=false;
  host.innerHTML=html`<h4>Conferma ${resource.sigla_crm} → ${target?.nome||targetUid}</h4>
    <p>${data.nota}</p><p>Nessuna sessione è selezionata automaticamente. Seleziona solo quelle da riassegnare.</p>
    <div class="table-wrap"><table><thead><tr><th>Seleziona</th><th>Data</th><th>Tecnico attuale</th><th>Pratica</th><th>Minuti</th></tr></thead><tbody>${(data.sessions||[]).map(s=>html`<tr><td><input type="checkbox" value="${s.id}" aria-label="Riassegna sessione del ${fmtDateIt(s.data_lavoro)}" ${s.tecnico_uid===targetUid?raw("disabled"):""}></td><td>${fmtDateIt(s.data_lavoro)}</td><td>${s.tecnico_nome||s.tecnico_uid}</td><td>${s.ore_commesse?.descrizione||"non indicato"}</td><td>${s.minuti_effettivi}</td></tr>`)}</tbody></table></div>
    <button class="crm-approve" type="button">Conferma collegamento e sessioni selezionate</button><button class="crm-cancel" type="button">Annulla</button>`;
  host.querySelector(".crm-cancel").addEventListener("click",()=>{host.hidden=true;host.innerHTML=html``;});
  host.querySelector(".crm-approve").addEventListener("click",async event=>{
    const button=event.currentTarget;button.disabled=true;
    try{
      const ids=new Set([...host.querySelectorAll("input:checked")].map(i=>i.value));
      const sessions=(data.sessions||[]).filter(s=>ids.has(s.id)).map(s=>({id:s.id,updated_at:s.updated_at}));
      const result=await api("approveCrmLink",{resourceId:resource.id,tecnicoUid:targetUid,previousUid:data.resource.tecnico_uid,previousApproval:data.resource.collegamento_approvato_at,sessions});
      host.hidden=true;host.innerHTML=html``;notify(`Collegamento confermato. ${result.riassegnate||0} sessioni riassegnate.`,"success");await loadCrmLinks();
    }catch(e){notify(e.message);button.disabled=false;}
  });
  host.scrollIntoView({behavior:"smooth",block:"nearest"});host.querySelector(".crm-approve").focus();
}
$("#loadCrmLinks").addEventListener("click",loadCrmLinks);
