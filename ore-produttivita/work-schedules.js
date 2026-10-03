READ_ACTIONS.add("workSchedules");
const WORK_DAYS=["Lunedì","Martedì","Mercoledì","Giovedì","Venerdì","Sabato","Domenica"];
$("#workScheduleWeek").innerHTML=html`${WORK_DAYS.map((day,index)=>html`<label>${day}<input data-weekday="${index}" aria-label="Ore previste ${day}" value="${index<5?"8h":"0h"}" required inputmode="decimal"></label>`)}`;
async function loadWorkSchedules(){
  const button=$("#loadWorkSchedules");button.disabled=true;
  try{
    const data=await api("workSchedules");
    $("#workScheduleTech").innerHTML=html`<option value="">Seleziona tecnico…</option>${(data.technicians||[]).map(t=>html`<option value="${t.uid}">${t.nome||t.uid}</option>`)}`;
    $("#workScheduleRows").innerHTML=html`${(data.schedules||[]).map(s=>html`<tr><td>${s.tecnico_nome||s.tecnico_uid}</td><td>${s.valido_dal}</td>${s.settimana_minuti.map(minutes=>html`<td>${fmtMinutes(minutes)}</td>`)}</tr>`)}`;
  }catch(e){notify(e.message);}finally{button.disabled=false;}
}
$("#loadWorkSchedules").addEventListener("click",loadWorkSchedules);
$("#workScheduleForm").addEventListener("submit",async event=>{
  event.preventDefault();const week=[...document.querySelectorAll("#workScheduleWeek input")].map(i=>inputMinutes(i.value));
  if(week.some(m=>m===null)){notify("Durata non valida: usa ad esempio 4h o 4:30.","warn");return;}
  const button=$("#saveWorkSchedule");if(button.disabled)return;button.disabled=true;
  try{await api("saveWorkSchedule",{tecnicoUid:$("#workScheduleTech").value,validoDal:$("#workScheduleFrom").value,settimanaMinuti:week});notify("Nuovo orario salvato; lo storico resta valido.","ok");await loadWorkSchedules();}catch(e){notify(e.message);}finally{button.disabled=false;}
});
