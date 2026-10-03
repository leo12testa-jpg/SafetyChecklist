const INTERNAL_LABELS={formazione_interna:"Formazione interna",amministrazione:"Amministrazione",commerciale_preventivi:"Commerciale/preventivi",aggiornamento_normativo:"Aggiornamento normativo",riunioni_interne:"Riunioni interne",altro_interno:"Altro interno",assenza:"Assenza"};
function internalOptions(selected){return Object.entries(INTERNAL_LABELS).map(([value,label])=>html`<option value="${value}" ${value===selected?raw("selected"):""}>${label}</option>`);}
function internalHasUnsavedWork(){
  if($("#internalDuration")?.value.trim())return true;
  return [...document.querySelectorAll("#internalActivities input,#internalActivities select")].some(i=>i.value!==i.dataset.original);
}
function renderAdminInternalActivities(rows){
  const host=$("#adminInternalRows");host.innerHTML=html``;
  for(const r of rows){const tr=document.createElement("tr");tr.innerHTML=html`<td>${r.tecnico_nome||r.tecnico_uid}<br>${r.data_lavoro}</td><td><select aria-label="Categoria interna di ${r.tecnico_nome||r.tecnico_uid}">${internalOptions(r.categoria)}</select></td><td><input aria-label="Durata interna di ${r.tecnico_nome||r.tecnico_uid}" value="${fmtMinutes(r.minuti_effettivi).replace(" ","")}" inputmode="decimal"></td><td><button type="button">Salva</button></td>`;
    const button=tr.querySelector("button");button.addEventListener("click",async()=>{
      const minutes=inputMinutes(tr.querySelector("input").value);if(minutes===null){notify("Durata non valida.","warn");return;}
      button.disabled=true;try{await api("saveInternal",{id:r.id,date:r.data_lavoro,categoria:tr.querySelector("select").value,minutiEffettivi:minutes});notify("Attività aggiornata.","ok");await loadAdmin();}catch(e){notify(e.message);button.disabled=false;}
    });host.appendChild(tr);
  }
}
function renderInternalActivities(rows){
  const host=$("#internalActivities");host.innerHTML=html``;
  for(const r of rows||[]){
    const row=document.createElement("div");row.className="internal-entry";
    row.innerHTML=html`<label>Categoria<select aria-label="Categoria attività interna">${internalOptions(r.categoria)}</select></label><label>Durata<input aria-label="Durata attività interna" value="${fmtMinutes(r.minuti_effettivi).replace(" ","")}" inputmode="decimal"></label><span>${r.confermata?"Confermata":"Da verificare"}</span><button type="button">Salva attività interna</button>`;
    const select=row.querySelector("select"),input=row.querySelector("input"),button=row.querySelector("button");
    select.dataset.original=select.value;input.dataset.original=input.value;
    const changed=()=>row.classList.toggle("dirty",select.value!==select.dataset.original||input.value!==input.dataset.original);
    input.addEventListener("input",changed);select.addEventListener("change",changed);
    input.addEventListener("keydown",event=>{if(event.key==="Enter"){event.preventDefault();button.click();}if(event.key==="Escape"){select.value=select.dataset.original;input.value=input.dataset.original;changed();}});
    button.addEventListener("click",async()=>{
      const minutes=inputMinutes(input.value);if(minutes===null){notify("Durata non valida.","warn");return;}
      button.disabled=true;try{await api("saveInternal",{id:r.id,date:$("#dayDate").value,categoria:select.value,minutiEffettivi:minutes});select.dataset.original=select.value;input.dataset.original=input.value;notify("Attività interna salvata.","ok");await loadDay();}catch(e){notify(e.message);}finally{button.disabled=false;}
    });host.appendChild(row);
  }
}
$("#internalDuration").addEventListener("input",()=>{const value=$("#internalDuration").value;const minutes=inputMinutes(value);$("#internalDurationPreview").textContent=value.trim()?(minutes===null?"Formato non valido":"= "+fmtMinutes(minutes)):"";});
$("#internalForm").addEventListener("submit",async event=>{
  event.preventDefault();const minutes=inputMinutes($("#internalDuration").value);if(minutes===null){notify("Durata non valida.","warn");return;}
  const button=$("#saveInternal");if(button.disabled)return;button.disabled=true;
  try{await api("saveInternal",{date:$("#dayDate").value,categoria:$("#internalCategory").value,minutiEffettivi:minutes});$("#internalDuration").value="";$("#internalDurationPreview").textContent="";notify("Attività interna aggiunta.","ok");await loadDay();}catch(e){notify(e.message);}finally{button.disabled=false;}
});
