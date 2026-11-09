/* Colligo DUVRI: source-grounded intake to a user-approved localhost service.
 * Prepares private source evidence; does not call AI or generate a Word document.
 */
(() => {
  'use strict';
  const ORIGIN = 'http://127.0.0.1:4198';
  const PAIR_TYPE = 'COLLIGO_LOCAL_PAIR_V1';
  const screen = document.querySelector('[data-screen="document-generation"]');
  const area = document.getElementById('dg-generate-action');
  if (!screen || !area || document.getElementById('dg-connect-local')) return;
  let token = null;
  let popup = null;
  let uploading = false;
  let ready = false;

  function element(tag, id, css, label) {
    const node = document.createElement(tag);
    if (id) node.id = id;
    if (css) node.className = css;
    if (label) node.textContent = label;
    return node;
  }
  const connect = element('button','dg-connect-local','btn','Collega il generatore sul PC');
  connect.type='button';
  const action = element('button','dg-analyze-sources','btn btn-primary','Analizza le fonti (sul PC)');
  action.type='button';
  action.disabled = true;
  const localStatus=element('p','dg-local-status','dg-small-note','Servizio locale non collegato.');
  localStatus.setAttribute('role','status');
  localStatus.setAttribute('aria-live','polite');
  const consentLabel=element('label',null,'dg-small-note');
  const syntheticConsent=element('input','dg-local-consent');
  syntheticConsent.type='checkbox';
  consentLabel.append(syntheticConsent,document.createTextNode(' Confermo che per questa prova userò soltanto documenti sintetici o inventati, senza dati cliente.'));
  const note=element('p',null,'dg-small-note',
    'Fase 1: lettura e tracciamento delle fonti. Non è ancora una generazione DUVRI: dati da verificare, nessun invio AI, nessuna emissione.');
  area.append(connect,consentLabel,action,localStatus,note);

  function snapshot() {
    const selection = globalThis.documentIntakeSelection;
    return {
      checklist:selection?.checklist?.()||null,
      attachments:selection?.documents?.()||[],
      busy:Boolean(selection?.busy?.())
    };
  }
  function validate(snap) {
    const files=[snap.checklist,...snap.attachments.map(e=>e.file)].filter(Boolean);
    if (!ready) return 'Collega prima il generatore locale sul PC.';
    if (!syntheticConsent.checked) return 'Conferma la prova con soli dati inventati.';
    if (snap.busy) return 'Lettura dei file in corso: riprova quando termina.';
    if (!snap.checklist || !/\.docx$/i.test(snap.checklist.name) || !snap.checklist.size)
      return 'Carica una checklist Word DOCX.';
    if (files.length>12 || files.reduce((a,f)=>a+f.size,0)>45*1024*1024)
      return 'Massimo 12 file complessivi e 45 MB.';
    if (files.some(f=>f.size<=0)) return 'Sono presenti file vuoti.';
    return '';
  }
  function update() {
    action.disabled = uploading || Boolean(validate(snapshot()));
  }
  connect.addEventListener('click',()=>{
    localStatus.textContent='Apri la finestra locale e premi “Autorizza SafetyChecklist”.';
    popup = window.open(ORIGIN+'/pair','colligo-pair','popup,width=600,height=530');
    if (!popup) localStatus.textContent='Il browser ha bloccato la finestra. Consenti i popup per SafetyChecklist.';
  });
  window.addEventListener('message',async (event)=>{
    if (event.origin!==ORIGIN || event.source!==popup || event.data?.type!==PAIR_TYPE ||
        typeof event.data.token!=='string' || event.data.token.length<40) return;
    token=event.data.token;
    try {
      const response=await fetch(ORIGIN+'/health',{
        method:'GET',mode:'cors',cache:'no-store',targetAddressSpace:'loopback'
      });
      const health=await response.json();
      if (!response.ok || health.state!=='ready_for_local_intake' || health.issuance_allowed!==false)
        throw new Error('Servizio locale non valido.');
      ready=true;
      localStatus.textContent='PC collegato. Carica un fascicolo sintetico e premi “Analizza le fonti”.';
      try{popup?.close();}catch(_){}
    } catch(_) {
      ready=false;token=null;
      localStatus.textContent='Collegamento non riuscito. Controlla il servizio Windows e i permessi di rete locale del browser.';
    }
    update();
  });
  action.addEventListener('click',async()=>{
    if (uploading) return;
    const snap=snapshot();
    const issue=validate(snap);
    if (issue) { localStatus.textContent=issue;update();return; }
    uploading=true;update();
    localStatus.textContent='Analisi locale in corso: nessun documento viene inviato online…';
    try {
      const body=new FormData();
      body.append('checklist',snap.checklist,snap.checklist.name);
      for (const item of snap.attachments) body.append('files',item.file,item.file.name);
      const response=await fetch(ORIGIN+'/api/intake',{
        method:'POST',mode:'cors',cache:'no-store',targetAddressSpace:'loopback',
        headers:{'X-Colligo-Local-Token':token},body
      });
      const result=await response.json();
      if (!response.ok || result.state!=='needs_human_review' || result.issuance_allowed!==false ||
          result.word_generated!==false) throw new Error(result.error||'Risposta locale non valida');
      localStatus.textContent='Fascicolo privato creato sul PC: '+result.source_count+' fonti, '+
        result.candidate_count+' campi possibili, '+result.unreadable_count+
        ' allegati da leggere o verificare manualmente. NON è stato generato un DUVRI. Resta da collegare revisione tecnica e compilatore Word.';
      syntheticConsent.checked=false;
    } catch(error) {
      localStatus.textContent='Acquisizione non completata: '+(error?.message||'errore locale')+ '. Nessun documento è stato emesso.';
    } finally {uploading=false;update();}
  });
  syntheticConsent.addEventListener('change',update);
  screen.addEventListener('dg-intake-change',update);
  update();
})();
