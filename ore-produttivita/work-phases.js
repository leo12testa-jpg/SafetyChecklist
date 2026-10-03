const PHASE_LABELS={sopralluogo:"Sopralluogo",trasferta:"Trasferta",redazione:"Redazione",revisione:"Revisione/correzioni",riunione_cliente:"Riunione con cliente",misurazioni:"Misurazioni",formazione_erogata:"Formazione erogata",altro:"Altro"};
function phaseHasUnsavedWork(){return [...document.querySelectorAll("#sessions .phase-select")].some(s=>s.value!==s.dataset.original)||[...document.querySelectorAll("#sessions .phase-reason")].some(i=>i.value.trim());}
function addPhaseEditor(row,session,dayConfirmed){
  const host=document.createElement("div");host.className="phase-editor";
  const frozen=(session.confermata||dayConfirmed)&&profile?.ruolo!=="admin";
  host.innerHTML=html`<label>Fase<select class="phase-select" aria-label="Fase di lavoro" ${frozen?raw("disabled"):""}><option value="">Da classificare · non indicato</option>${Object.entries(PHASE_LABELS).map(([value,label])=>html`<option value="${value}">${label}</option>`)}</select></label>
    ${(session.confermata||dayConfirmed)&&profile?.ruolo==="admin"?html`<label>Motivo modifica<input class="phase-reason" aria-label="Motivo modifica fase confermata" maxlength="300"></label>`:""}
    <button class="save-phase" type="button" ${frozen?raw("disabled"):""}>Salva fase</button>`;
  row.querySelector(".proto-desc").appendChild(host);
  const select=host.querySelector("select"),button=host.querySelector("button");select.value=session.fase||"";select.dataset.original=select.value;
  select.addEventListener("change",()=>{const hours=row.querySelector(".proto-hours input");row.classList.toggle("dirty",select.value!==select.dataset.original||hours.value!==hours.dataset.original);});
  button.addEventListener("click",async()=>{
    button.disabled=true;
    try{
      const phase=select.value||null,result=await api("savePhase",{id:session.id,fase:phase,updatedAt:session.updated_at,motivo:host.querySelector(".phase-reason")?.value||null});
      session.fase=phase;session.updated_at=result.updatedAt||session.updated_at;session.confermata=false;select.dataset.original=select.value;
      const reason=host.querySelector(".phase-reason");if(reason)reason.value="";
      const hours=row.querySelector(".proto-hours input");row.classList.toggle("dirty",hours.value!==hours.dataset.original);
      const state=row.querySelector(".row-state");state.textContent="Da verificare";state.classList.remove("done");
      $("#dayStatus").textContent="Da verificare";$("#dayCompleteBadge").textContent="Da completare";$("#dayCompleteBadge").classList.remove("done");
      notify("Fase salvata.","ok");
    }catch(e){notify(e.message);}finally{button.disabled=false;}
  });
}
function renderPhaseSummary(rows){
  const groups=new Map();
  for(const row of rows||[]){const type=row.ore_commesse?.ore_tipologie;const code=type?.codice||"non indicato",phase=row.fase||"";const key=code+"|"+phase;
    const value=groups.get(key)||{code,name:type?.nome||"non indicato",phase,minutes:0};value.minutes+=Number(row.minuti_effettivi||0);groups.set(key,value);
  }
  $("#phaseSummaryRows").innerHTML=html`${[...groups.values()].sort((a,b)=>a.code.localeCompare(b.code)||a.phase.localeCompare(b.phase)).map(g=>html`<tr><td>${g.code} · ${g.name}</td><td>${PHASE_LABELS[g.phase]||"non indicato"}</td><td>${(g.minutes/60).toLocaleString("it-IT",{maximumFractionDigits:2})}</td></tr>`)}`;
}
