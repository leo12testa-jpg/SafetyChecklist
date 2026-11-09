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
  let startAfterPair = false;

  function element(tag, id, css, label) {
    const node = document.createElement(tag);
    if (id) node.id = id;
    if (css) node.className = css;
    if (label) node.textContent = label;
    return node;
  }
  const connect = element('button','dg-connect-local','btn','Collega il generatore sul PC');
  connect.type='button';
  // Pairing is an internal step of the one visible action, not a second button.
  connect.hidden = true;
  if (connect.style) connect.style.display = 'none';
  const action = element('button','dg-analyze-sources','btn btn-primary','Prepara fascicolo DUVRI');
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
  // Keep the historic questionnaire in the DOM for legacy handlers, but show
  // only the two document uploads and this local action in DUVRI mode.
  // Hidden elements do not grant authorization or bypass any existing gate.
  function hideLegacySection(node) {
    if (!node) return;
    node.hidden = true;
    if (node.style) node.style.display = 'none';
  }
  if (typeof DOCUMENT_GENERATION_CLOUD_ENABLED === 'undefined' || DOCUMENT_GENERATION_CLOUD_ENABLED !== true) {
    for (const selector of [
      '.dg-prototype-alert', '.dg-workflow-strip', '.dg-customer-instructions',
      '#dg-form', '.dg-result-panel', '.dg-queue-panel', '.dg-auto-gate',
      '#dg-generate-reasons', '#dg-template-details', '#dg-auto-results'
    ]) hideLegacySection(screen.querySelector?.(selector));
  }
  // The inactive cloud-only draft button must not duplicate the local action.
  if (typeof DOCUMENT_GENERATION_CLOUD_ENABLED === 'undefined' || DOCUMENT_GENERATION_CLOUD_ENABLED !== true) {
    const legacy=document.getElementById('dg-generate-duvri');
    if (legacy) { legacy.hidden=true; if (legacy.style) legacy.style.display='none'; }
    const legacyConsent=document.getElementById('dg-generation-consent');
    if (legacyConsent?.parentElement) { legacyConsent.parentElement.hidden=true; if (legacyConsent.parentElement.style) legacyConsent.parentElement.style.display='none'; }
    const legacyState=document.getElementById('dg-generate-action-state');
    if (legacyState) {
      legacyState.hidden=true; if (legacyState.style) legacyState.style.display='none';
      const oldWarning=legacyState.nextElementSibling;
      if (oldWarning?.tagName==='P') { oldWarning.hidden=true; if (oldWarning.style) oldWarning.style.display='none'; }
    }
  }

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
  function openPair() {
    localStatus.textContent='Apri la finestra locale e premi “Autorizza SafetyChecklist”.';
    popup = window.open(ORIGIN+'/pair','colligo-pair','popup,width=600,height=530');
    if (!popup) { startAfterPair=false; localStatus.textContent='Il browser ha bloccato la finestra. Consenti i popup per SafetyChecklist.'; }
  }
  connect.addEventListener('click',openPair);
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
      localStatus.textContent='PC collegato. Premi “Prepara fascicolo DUVRI” per avviare la lettura locale.';
      try{popup?.close();}catch(_){}
    } catch(_) {
      ready=false;token=null;startAfterPair=false;
      localStatus.textContent='Collegamento non riuscito. Controlla il servizio Windows e i permessi di rete locale del browser.';
    }
    update();
    if (ready && startAfterPair && !action.disabled) {
      startAfterPair=false;
      // Continuation of the explicitly requested action after manual pairing.
      action.click();
    }
  });
  action.addEventListener('click',async()=>{
    if (uploading) return;
    // First use pairs the browser with the already running Windows gateway.
    if (!ready) { startAfterPair=true; openPair(); return; }
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
