/* Static synthetic preview: no fetch(), no XHR, no remote uploads. */
(() => {
  'use strict';
  const get = id => document.getElementById(id);
  const checklist=get('checklist'), attachments=get('attachments'), sample=get('demo'), generate=get('generate');
  const selection=get('selection'), result=get('result'), testOnly=get('testOnly'), title=get('title');
  let example=false;
  const fiction=['Checklist_DUVRI_SIMULAZIONE.docx','Cronoprogramma_SINTETICO.pdf','Planimetria_DIMOSTRATIVA.pdf'];
  const step=(id,ok)=>get(id).classList.toggle('done',ok);
  function names(){
    if(example) return fiction;
    const files=[...(checklist.files||[]),...(attachments.files||[])];
    return files.map(f=>f.name);
  }
  function refresh(){
    if(example){selection.textContent='Fascicolo sintetico pronto: 1 checklist Word e 2 allegati fittizi. Nessun file reale selezionato.';}
    else if(checklist.files?.length){selection.textContent=`Checklist: ${checklist.files[0].name} · ${attachments.files.length} allegati selezionati · nella demo vengono usati solo i nomi.`;}
    else{selection.textContent='Nessun fascicolo selezionato. Puoi usare il fascicolo sintetico già predisposto.';}
    step('st-file',example||!!checklist.files?.length);
    step('st-generate',false);step('st-download',false);
  }
  checklist.addEventListener('change',()=>{example=false;refresh()});
  attachments.addEventListener('change',()=>{example=false;refresh()});
  sample.addEventListener('click',()=>{checklist.value='';attachments.value='';example=true;refresh();result.classList.remove('error');result.textContent='Esempio caricato. Premi “Genera bozza DUVRI (Word)”.';});
  generate.addEventListener('click',async()=>{
    const errors=[];
    if(!testOnly.checked)errors.push('Conferma l’uso esclusivo di dati inventati.');
    if(!example && !checklist.files?.length)errors.push('Carica una checklist .docx di test oppure usa il fascicolo sintetico.');
    if(!example && checklist.files?.length && !/\.docx$/i.test(checklist.files[0].name))errors.push('La checklist deve essere un DOCX.');
    if(names().length>12)errors.push('Massimo 12 file per la prova.');
    if(typeof JSZip!=='function')errors.push('Libreria di generazione DOCX non disponibile.');
    if(errors.length){result.classList.add('error');result.textContent=errors.join(' ');return;}
    generate.disabled=true;
    result.classList.remove('error');result.textContent='Preparazione del DOCX sintetico sul dispositivo…';
    try{
      const blob=await ColligoDemoWord.generate(JSZip,{
        title:title.value || 'Intervento dimostrativo',
        files:names(),demoDate:new Date().toLocaleDateString('it-IT')
      });
      if(!blob || !blob.size)throw new Error('Il documento Word prodotto è vuoto.');
      step('st-generate',true);
      const link=document.createElement('a');
      const url=URL.createObjectURL(blob);
      link.href=url;link.download='BOZZA_DUVRI_SIMULAZIONE_NON_EMETTIBILE.docx';
      document.body.appendChild(link);link.click();link.remove();
      setTimeout(()=>URL.revokeObjectURL(url),3000);
      step('st-download',true);
      result.textContent=`Bozza Word sintetica generata (${Math.round(blob.size/1024)} KB). Contiene soltanto dati inventati, i nomi dei file selezionati e verifiche HSE aperte. Non utilizzare come DUVRI reale.`;
    }catch(err){result.classList.add('error');result.textContent='Il file Word non è stato prodotto: '+(err.message||'errore inatteso');}
    finally{generate.disabled=false;}
  });
  refresh();
})();