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
      if (!Number.isSafeInteger(report.source_count) || report.source_count<1 ||
          !Number.isSafeInteger(report.source_candidates_rendered) || report.source_candidates_rendered<0)
        throw new Error('Rapporto Word privo di conteggi delle fonti verificabili');
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
      // An intact hash must still refer to a DOCX (ZIP) rather than arbitrary bytes.
      const signature=new Uint8Array(bytes,0,Math.min(4,bytes.byteLength));
      if (signature.length<4 || signature[0]!==0x50 || signature[1]!==0x4b ||
          signature[2]!==0x03 || signature[3]!==0x04)
        throw new Error('Il file scaricato non presenta la firma DOCX richiesta');
      const url=URL.createObjectURL(blob);
      try {
        const a=document.createElement('a');
        a.href=url;
        a.download='DUVRI_BOZZA_NON_EMETTIBILE.docx';
        document.body.appendChild(a);
        a.click();a.remove();
      } finally {setTimeout(()=>URL.revokeObjectURL(url),3000);}
      const selectedSources=1+snap.attachments.length;
      const sourceCoverageNote=report.source_count===selectedSources
        ?' Conteggio fonti coerente con i caricamenti (non prova la lettura completa).'
        :' ATTENZIONE: '+selectedSources+' file caricati, '+report.source_count+
          ' fonti dichiarate dal motore; verificare eventuali file mancanti o fonti aggiuntive.';
      const extractedNote=report.source_candidates_rendered===0
        ?' ATTENZIONE: nessun dato estratto riportato nella bozza.':'';
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
        ?' Analizzatori AI dichiarati dal motore: '+aiAgents.length+
          ', '+aiCount+' ipotesi da verificare (nessuna validazione HSE automatica).'
        :' Nessun analizzatore AI dichiarato: verificare modello locale e fonti.';
      const aiLimits=report.ai_exhaustive_analysis===false
        ?' Lettura AI non esaustiva; verificare tutti gli allegati.':'';
      const agentDivergences=Number.isSafeInteger(report.ai_cross_agent_divergences_to_resolve)&&
        report.ai_cross_agent_divergences_to_resolve>0?report.ai_cross_agent_divergences_to_resolve:0;
      const agentDivergenceNote=agentDivergences
        ?' ATTENZIONE: '+agentDivergences+' divergenze tra proposte AI nel Word. Non selezionare misure senza revisione HSE.':'';
      const aiTruncated=Number.isSafeInteger(report.ai_hypotheses_truncated)&&
        report.ai_hypotheses_truncated>0?report.ai_hypotheses_truncated:0;
      const aiTruncatedNote=aiTruncated
        ?' ATTENZIONE: '+aiTruncated+' proposte AI fuori dal limite di elaborazione.':'';
      const deferred=Number.isSafeInteger(report.ai_specialist_tasks_deferred)&&
        report.ai_specialist_tasks_deferred>0?report.ai_specialist_tasks_deferred:0;
      const deferredNote=deferred>0
        ?' '+deferred+' analisi specialistiche AI non eseguite per limite elaborazione; necessaria revisione HSE.':'';
      const noSelectable=Number.isSafeInteger(report.sources_without_selectable_text)
        ?report.sources_without_selectable_text:0;
      const withLimit=Number.isSafeInteger(report.sources_with_reading_limits)
        ?report.sources_with_reading_limits:0;
      const coverageNote=noSelectable>0
        ?' '+noSelectable+' fonti senza testo selezionabile: esame manuale necessario.'
        :'';
      const aiPasses=Number.isSafeInteger(report.ai_batches_planned)&&
        Number.isSafeInteger(report.ai_batches_completed)&&report.ai_batches_planned>0
        ?' AI: '+report.ai_batches_completed+'/'+report.ai_batches_planned+' lotti completati.'
        :'';
      const reviewNote=withLimit>0
        ?' '+withLimit+' file presentano limiti di lettura o richiedono verifica visiva.'
        :'';
      const batchesIncomplete=Number.isSafeInteger(report.ai_batches_planned)&&
        Number.isSafeInteger(report.ai_batches_completed)&&
        report.ai_batches_completed<report.ai_batches_planned;
      const batchesNote=batchesIncomplete
        ?' ATTENZIONE: elaborazione AI parziale; i lotti non completati richiedono controllo manuale.':'';
      const visualEligible=Number.isSafeInteger(report.visual_sources_eligible)
        ?report.visual_sources_eligible:0;
      const visualSampled=Number.isSafeInteger(report.visual_sources_sampled)
        ?report.visual_sources_sampled:0;
      const visualNotes=Number.isSafeInteger(report.visual_observations_to_confirm)
        ?report.visual_observations_to_confirm:0;
      const visualDeferred=Number.isSafeInteger(report.visual_pages_deferred)
        ?report.visual_pages_deferred:0;
      const visualNote=visualEligible>0
        ?(report.visual_review_status==='VISION_MODEL_UNAVAILABLE'
           ?' ATTENZIONE: foto e pagine PDF NON esaminate visivamente da un modello AI.'
           :' Copertura visiva dichiarata dal motore: '+visualSampled+'/'+visualEligible+
             ' fonti campionate, '+visualNotes+' osservazioni NON verificate.'+
             (visualDeferred>0?' '+visualDeferred+' pagine non esaminate.':''))
        :'';
      localStatus.textContent='Download bozza Word avviato: '+report.source_count+' fonti, '+
        report.source_candidates_rendered+' dati estratti.'+sourceCoverageNote+extractedNote+
        coordination+incomplete+aiNote+aiPasses+batchesNote+coverageNote+reviewNote+
        visualNote+deferredNote+agentDivergenceNote+aiTruncatedNote+aiLimits+
        ' DA REVISIONARE: interferenze, HSE, D1/D2, fonti e firme. NON EMETTIBILE.';
    } catch(error) {
      localStatus.textContent='Generazione o download non completato: '+(error?.message||'errore locale')+'. Nessun DUVRI è stato emesso.';
    } finally {uploading=false;update();}
  });
  screen.addEventListener('dg-intake-change',update);
  update();
})();
