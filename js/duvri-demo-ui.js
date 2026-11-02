/* DUVRI local demo only. Must never misrepresent synthetic examples as HSE analysis. */
(()=>{
  'use strict';
  const button=document.getElementById('dg-demo-generate');
  const status=document.getElementById('dg-demo-status');
  const screen=document.getElementById('screen-document-generation');
  if (!button||!status||!screen) return;
  const getSelection=()=>globalThis.documentIntakeSelection;
  const eligible=()=>{
    const selection=getSelection();
    if(!selection) return null;
    const checklist=selection.checklist();
    const documents=selection.documents();
    if(selection.busy()||!checklist||!/\.docx$/i.test(checklist.name)||documents.length===0) return null;
    return {checklist,documents};
  };
  function update(){
    const pair=eligible();
    button.disabled=!pair;
    if(!pair && !status.dataset.downloaded) {
      status.textContent='Per la dimostrazione carica una checklist Word e almeno un allegato.';
    }else if(pair && !status.dataset.downloaded){
      status.textContent='File pronti. La demo genera un Word con scenario sintetico, senza analisi AI.';
    }
  }
  screen.addEventListener('dg-intake-change',()=>{delete status.dataset.downloaded;update();});
  button.addEventListener('click',async()=>{
    const selected=eligible();
    if(!selected||typeof JSZip!=='function'||typeof duvriDemoGenerator==='undefined') return;
    button.disabled=true;
    status.textContent='Generazione del Word dimostrativo sul dispositivo…';
    try{
      // Check that the selected checklist is a real DOCX ZIP before generating a demo.
      const inputZip=await JSZip.loadAsync(await selected.checklist.arrayBuffer());
      if(!inputZip.file('word/document.xml')) throw new Error('La checklist scelta non è un DOCX Word valido.');
      const docx=await duvriDemoGenerator.generateDocx(JSZip,{
        checklistName:selected.checklist.name,
        attachments:selected.documents.map(x=>({name:x.file.name}))
      });
      const objectUrl=URL.createObjectURL(docx);
      const a=document.createElement('a');
      a.href=objectUrl;
      a.download='DUVRI_DIMOSTRATIVO_NON_UFFICIALE.docx';
      document.body.appendChild(a);a.click();a.remove();
      setTimeout(()=>URL.revokeObjectURL(objectUrl),30000);
      status.dataset.downloaded='true';
      status.textContent='Esempio Word generato e scaricato localmente. Contenuti e interferenze sono fittizi: non è un DUVRI utilizzabile.';
    }catch(error){
      delete status.dataset.downloaded;
      status.textContent='Impossibile generare la demo: '+
        (error&&error.message?error.message:'errore')+'. Nessun DUVRI è stato creato.';
    }finally{update();}
  });
  update();
})();
