/* Colligo DUVRI: two-upload, one-action, source-bound Word review draft.
 * Local-only processing; no remote AI, risk approval, signatures or issuance.
 */
(() => {
  'use strict';
  const ORIGIN = 'http://127.0.0.1:4198';
  const PAIR_TYPE = 'COLLIGO_LOCAL_PAIR_V1';
  // Never show a localhost button when the private cloud worker is enabled.
  if (typeof DOCUMENT_GENERATION_CLOUD_ENABLED !== 'undefined' && DOCUMENT_GENERATION_CLOUD_ENABLED===true) return;
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
  const action = element('button','dg-analyze-sources','btn btn-primary','Genera DUVRI');
  action.type='button';
  action.disabled = true;
  const localStatus=element('p','dg-local-status','dg-small-note','Servizio locale non collegato.');
  localStatus.setAttribute('role','status');
  localStatus.setAttribute('aria-live','polite');
  const note=element('p',null,'dg-small-note',
    'I documenti sono elaborati sul tuo PC, senza invio a servizi AI esterni. Il file Word è una bozza non emettibile: il tecnico deve verificare fonti, interferenze, misure e firme prima dell’uso ufficiale.');
  area.append(connect,action,localStatus,note);
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
      localStatus.textContent='PC collegato. Premi “Genera DUVRI” per creare la bozza Word locale.';
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
      if (typeof result.job_id!=='string' || !/^FASCICOLO_[0-9]{8}_[0-9]{6}_[a-f0-9]{12}$/.test(result.job_id))
        throw new Error('Identificativo del fascicolo non valido');
      const endpoint=ORIGIN+'/api/jobs/'+result.job_id+'/draft';
      localStatus.textContent='Fascicolo letto. Compilazione Word locale in corso…';
      const generated=await fetch(endpoint,{
        method:'POST',mode:'cors',cache:'no-store',targetAddressSpace:'loopback',
        headers:{'X-Colligo-Local-Token':token}
      });
      const report=await generated.json();
      if (!generated.ok || report.state!=='draft_needs_human_review' ||
          report.word_generated!==true || report.issuance_allowed!==false ||
          report.document_status!=='NON_EMETTIBILE' ||
          report.download_path!=='/api/jobs/'+result.job_id+'/draft/download' ||
          typeof report.sha256!=='string' || !/^[a-f0-9]{64}$/.test(report.sha256))
        throw new Error('Compilazione Word non disponibile: servizio Windows da aggiornare o modello non valido');
      localStatus.textContent='Word creato sul PC. Verifica integrità e download…';
      const download=await fetch(ORIGIN+report.download_path,{
        method:'GET',mode:'cors',cache:'no-store',targetAddressSpace:'loopback',
        headers:{'X-Colligo-Local-Token':token}
      });
      const mime=download.headers?.get?.('Content-Type')||'';
      if (!download.ok || !mime.includes('application/vnd.openxmlformats-officedocument.wordprocessingml.document'))
        throw new Error('Download Word non riuscito');
      const blob=await download.blob();
      const bytes=await blob.arrayBuffer();
      if (!globalThis.crypto?.subtle) throw new Error('Verifica crittografica del Word non disponibile');
      const digest=await globalThis.crypto.subtle.digest('SHA-256',bytes);
      const hex=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
      if (hex!==report.sha256) throw new Error('Impronta del Word non corrispondente; download bloccato');
      const url=URL.createObjectURL(blob);
      try {
        const a=document.createElement('a');
        a.href=url;
        a.download='DUVRI_BOZZA_NON_EMETTIBILE.docx';
        document.body.appendChild(a);
        a.click();a.remove();
      } finally {setTimeout(()=>URL.revokeObjectURL(url),3000);}
      const temporal=Number.isSafeInteger(report.scheduled_overlap_questions)
        ?report.scheduled_overlap_questions:0;
      const scheduleQuality=report.schedule_quality||{};
      const scheduleWarnings=(Number(scheduleQuality.rows_without_verified_time_or_date)||0)+
        (Number(scheduleQuality.firm_names_not_in_checklist)||0)+
        (Number(scheduleQuality.schedule_rows_not_examined)||0);
      const coordination=temporal>0
        ?' '+temporal+' sovrapposizioni orarie da verificare; NON sono rischi accertati.'
        :' Nessuna sovrapposizione oraria dimostrata automaticamente.';
      const incomplete=scheduleWarnings>0||scheduleQuality.pair_limit_reached===true
        ?' ATTENZIONE: cronoprogramma incompleto o dati da riconciliare.':'';
      const aiAgents=Array.isArray(report.ai_agents_executed)
        ?report.ai_agents_executed.filter(x=>typeof x==='string'): [];
      const aiCount=Number.isSafeInteger(report.ai_hypotheses_to_review)
        ?report.ai_hypotheses_to_review:0;
      const aiNote=aiAgents.length
        ?' AI locale eseguita: '+aiAgents.length+' analizzatori, '+aiCount+' ipotesi da verificare.'
        :' AI non eseguita: verifica modello locale e completezza delle fonti.';
      const aiLimits=report.ai_exhaustive_analysis===false
        ?' Lettura AI non esaustiva; verificare tutti gli allegati.':'';
      localStatus.textContent='Bozza Word scaricata: '+report.source_count+' fonti, '+
        report.source_candidates_rendered+' dati estratti.'+coordination+incomplete+
        aiNote+aiLimits+
        ' DA REVISIONARE: interferenze, HSE, D1/D2, fonti e firme. NON EMETTIBILE.';
    } catch(error) {
      localStatus.textContent='Generazione o download non completato: '+(error?.message||'errore locale')+'. Nessun DUVRI è stato emesso.';
    } finally {uploading=false;update();}
  });
  screen.addEventListener('dg-intake-change',update);
  update();
})();
