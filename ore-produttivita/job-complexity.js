const COMPLEXITY_UI={fascia_lavoratori:{label:"Fascia lavoratori",options:{"1-9":"1–9","10-49":"10–49","50-249":"50–249","250+":"250+"}},numero_sedi:{label:"Numero sedi",number:true},numero_mansioni:{label:"Mansioni omogenee",number:true},tipo_intervento:{label:"Tipo intervento",options:{prima_redazione:"Prima redazione",aggiornamento:"Aggiornamento",revisione:"Revisione"}},settore:{label:"Settore / ATECO"}};
function complexityControls(host,values={},filter=false){
 host.innerHTML=html`${Object.entries(COMPLEXITY_UI).map(([key,field])=>html`<label>${field.label}${field.options?html`<select data-complexity="${key}"><option value="">${filter?"Tutti":"non indicato"}</option>${filter?html`<option value="__missing__">non indicato</option>`:""}${Object.entries(field.options).map(([value,name])=>html`<option value="${value}">${name}</option>`)}</select>`:html`<input data-complexity="${key}" type="${field.number?"number":"text"}" ${field.number?raw('min="1" max="100000" step="1"'):raw('maxlength="200"')} placeholder="${filter?"Tutti":"non indicato"}">${filter?html`<span><input type="checkbox" data-missing="${key}"> solo non indicato</span>`:""}`}</label>`)}`;
 for(const input of host.querySelectorAll("[data-complexity]"))input.value=values[input.dataset.complexity]??"";
 for(const box of host.querySelectorAll("[data-missing]"))box.addEventListener("change",()=>{host.querySelector(`[data-complexity="${box.dataset.missing}"]`).disabled=box.checked;});
}
function readComplexity(host){
 const values={};for(const input of host.querySelectorAll("[data-complexity]")){const key=input.dataset.complexity,missing=host.querySelector(`[data-missing="${key}"]`)?.checked;if(!input.validity.valid&&!missing)throw new Error("Controlla sedi, mansioni e settore.");const text=input.value.trim();values[key]=missing?"__missing__":!text?null:COMPLEXITY_UI[key].number?Number(text):text;}return values;
}
function matchesJobComplexity(job,filters){return Object.keys(COMPLEXITY_UI).every(key=>{const f=filters[key],v=job[key]??null;return f==null?true:f==="__missing__"?v===null:key==="settore"?String(v||"").toLocaleLowerCase("it-IT")===f.toLocaleLowerCase("it-IT"):v===f;});}
function renderJobComplexity(data){
 const job=data.job,host=$("#jobComplexity");host.innerHTML=html`<h3>Fattori di complessità</h3><p>Valori indicati dall’admin; nessuna deduzione automatica.</p><form id="jobComplexityForm"><div class="complexity-fields"></div><button type="submit">Salva complessità</button></form>`;
 complexityControls(host.querySelector(".complexity-fields"),job);
 host.querySelector("form").addEventListener("submit",async event=>{
  event.preventDefault();const form=event.currentTarget;if(!form.reportValidity())return;const button=form.querySelector("button");button.disabled=true;
  try{const values=readComplexity(form),result=await api("saveJobComplexity",{commessaId:job.id,updatedAt:job.updated_at,complexity:values});Object.assign(job,values,{updated_at:result.updatedAt});archiveData=null;archiveLoadedAt=0;economicsSummary=null;await renderProductivity();notify("Complessità salvata.","ok");}
  catch(e){notify(e.message);}finally{button.disabled=false;}
 });
}
function initComplexityFilters(){
 for(const [id,callback]of [["#productivityFilters",()=>renderProductivity()],["#estimateComplexityFilters",async()=>{$("#estimateHours").value="";await loadEconomics();if(!$("#estimateHours").value)updateEstimator(true);}]] ){
  const host=$(id);complexityControls(host,{},true);let timer;
  host.addEventListener("change",()=>{clearTimeout(timer);timer=setTimeout(()=>Promise.resolve().then(callback).catch(e=>notify(e.message)),150);});
 }
}
initComplexityFilters();
