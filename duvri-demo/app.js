/* No file contents are read. No network. For fictional demo use only. */
(function(){
  'use strict';
  const $=id=>document.getElementById(id);
  const checklist=$('checklist'), docs=$('docs'), sample=$('sample'), generate=$('generate');
  const summary=$('summary'), result=$('result'), consent=$('consent'), title=$('title');
  const fiction=['Checklist_DUVRI_SIMULAZIONE.docx','Cronoprogramma_DIMOSTRATIVO.pdf','Planimetria_INVENTATA.pdf'];
  let useSample=false;
  function filenames(){
    return useSample?fiction:[...(checklist.files||[]),...(docs.files||[])].map(f=>f.name);
  }
  function refresh(){
    if(useSample){
      summary.textContent='Fascicolo fittizio pronto: una checklist Word e due allegati dimostrativi.';
    }else if(checklist.files?.length){
      summary.textContent='Checklist: '+checklist.files[0].name+'; allegati: '+(docs.files?.length||0)+'. Saranno utilizzati soltanto i nomi, non il contenuto.';
    }else summary.textContent='Nessuna checklist selezionata. Usa il fascicolo sintetico per provare subito.';
  }
  checklist.addEventListener('change',()=>{useSample=false;refresh();});
  docs.addEventListener('change',()=>{useSample=false;refresh();});
  sample.addEventListener('click',()=>{
    checklist.value='';docs.value='';useSample=true;refresh();
    result.classList.remove('error');
    result.textContent='Fascicolo inventato caricato. Premi “Genera bozza DUVRI (Word)”.';
  });
  generate.addEventListener('click',async()=>{
    const errors=[];
    if(!consent.checked) errors.push('Conferma l’utilizzo esclusivo di dati inventati.');
    if(!useSample && !checklist.files?.length) errors.push('Seleziona la checklist Word o il fascicolo sintetico.');
    if(!useSample && checklist.files?.length && !/\.docx$/i.test(checklist.files[0].name)) errors.push('La checklist deve essere DOCX.');
    const names=filenames();
    if(names.length>12) errors.push('Massimo 12 file.');
    if(typeof JSZip!=='function') errors.push('La libreria Word non è caricata.');
    if(errors.length){
      result.classList.add('error');result.textContent=errors.join(' ');
      return;
    }
    generate.disabled=true;
    result.classList.remove('error');result.textContent='Generazione della bozza sul dispositivo…';
    try{
      const blob=await ColligoSyntheticDuvri.generate(JSZip,{
        title:title.value||'Intervento inventato',files:names,
        date:new Date().toLocaleDateString('it-IT')
      });
      if(!blob||blob.size<500) throw new Error('Word non valido o vuoto.');
      const url=URL.createObjectURL(blob);
      const a=document.createElement('a');
      a.href=url;a.download='BOZZA_DUVRI_SOLO_SIMULAZIONE_NON_EMETTIBILE.docx';
      document.body.appendChild(a);a.click();a.remove();
      setTimeout(()=>URL.revokeObjectURL(url),3000);
      result.textContent='Word sintetico creato e scaricato ('+Math.round(blob.size/1024)+' KB). Nessun file è stato inviato a server. Il documento NON è emettibile.';
    }catch(err){
      result.classList.add('error');
      result.textContent='La generazione non è riuscita: '+(err.message||'errore');
    }finally{generate.disabled=false;}
  });
  refresh();
})();