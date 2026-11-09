/* Colligo DUVRI — avvio autenticato di una BOZZA Word dai due upload esistenti.
 * Nessuna emissione, approvazione HSE o invio cloud implicito.
 * L'endpoint server deve essere attivo: il pulsante non simula una generazione.
 */
'use strict';
const duvriGenerateAction = (() => {
  const MAX_FILES = 12;
  const MAX_TOTAL_BYTES = 45 * 1024 * 1024;
  const MAX_FILE_BYTES = 15 * 1024 * 1024;
  const SUPPORTED_EXTENSIONS = new Set(['docx','pdf','xlsx','zip','png','jpg','jpeg','txt','csv']);
  const LAYOUT_ID = 'COLLIGO-DUVRI-CORPORATE-2026-V1';

  function validate(checklist, attachments, enabled, consent) {
    const reasons = [];
    if (!enabled) reasons.push('Generazione non disponibile: gateway e worker documentali non sono attivi.');
    if (!checklist || !/\.docx$/i.test(checklist.name || '') || !Number(checklist.size)) {
      reasons.push('Carica una checklist Word (.docx) non vuota.');
    }
    if (!Array.isArray(attachments)) reasons.push('Elenco degli allegati non disponibile.');
    const files = [checklist, ...(Array.isArray(attachments) ? attachments.map((x) => x.file) : [])].filter(Boolean);
    if (files.length > MAX_FILES) reasons.push('Massimo 12 file complessivi (1 checklist e 11 allegati).');
    if (files.some((f) => !Number.isFinite(f.size) || f.size <= 0)) reasons.push('Sono presenti file vuoti o non validi.');
    if (files.some((f) => !SUPPORTED_EXTENSIONS.has(String(f.name || '').toLowerCase().split('.').pop()))) {
      reasons.push('Formato non supportato. Usa Word .docx, Excel .xlsx, PDF, immagini JPG/PNG o gli altri allegati previsti.');
    }
    if (files.some((f) => Number(f.size) > MAX_FILE_BYTES)) reasons.push('Massimo 15 MB per singolo file.');
    if (files.reduce((n, f) => n + (Number(f.size) || 0), 0) > MAX_TOTAL_BYTES) {
      reasons.push('Dimensione massima complessiva: 45 MB.');
    }
    if (!consent) reasons.push('Devi autorizzare espressamente l’invio dei documenti al backend privato.');
    return reasons;
  }

  function metadata(checklist, attachments, title) {
    const safeTitle = String(title || '').trim().slice(0, 180);
    return {
      schema: 'colligo-duvri-client-intake/0.1',
      documentType: 'duvri',
      title: safeTitle || 'BOZZA DUVRI - TITOLO DA CONFERMARE',
      siteType: 'unknown',
      complexity: 'to_be_assessed',
      sourceChecklist: { name: checklist.name, size: checklist.size },
      documents: attachments.map(({ file, category }) => ({
        name: file.name, size: file.size,
        category: String(category || 'altri-allegati')
      })),
      layoutProfileId: LAYOUT_ID,
      layoutMasterPolicy: 'keep_official_template_sections_margins_headers_footers',
      draftOnly: true,
      humanReviewRequired: true,
      issuanceAllowed: false,
      aiDataProcessingConsent: false,
      decisionGates: ['TITOLO_IV_ART26', 'HSE_REVIEW', 'D1', 'D2']
    };
  }

  function cloudAvailable() {
    return typeof DOCUMENT_GENERATION_CLOUD_ENABLED !== 'undefined' &&
      DOCUMENT_GENERATION_CLOUD_ENABLED === true &&
      typeof DOCUMENT_JOBS_ENDPOINT !== 'undefined' &&
      typeof appIdentity !== 'undefined';
  }

  async function downloadVerified(jobId, token) {
    if (!/^[0-9a-f-]{36}$/i.test(jobId || '') || !token)
      throw new Error('Fascicolo o sessione non valida');
    const endpoint = new URL(DOCUMENT_JOBS_ENDPOINT);
    endpoint.searchParams.set('job', jobId);
    endpoint.searchParams.set('action', 'status');
    const status = await fetch(endpoint.toString(), {
      method: 'GET', headers: { authorization: 'Bearer ' + token }, cache: 'no-store'
    });
    const report = await status.json().catch(() => ({}));
    if (!status.ok || report.job?.id !== jobId || report.issuance_allowed !== false ||
        report.job.state !== 'needs_review' || report.download_ready !== true)
      throw new Error('Bozza Word non ancora disponibile per revisione');
    endpoint.searchParams.set('action', 'download');
    const downloaded = await fetch(endpoint.toString(), {
      method: 'GET', headers: { authorization: 'Bearer ' + token }, cache: 'no-store'
    });
    const sha = downloaded.headers.get('x-duvri-sha256') || '';
    const mime = downloaded.headers.get('content-type') || '';
    if (!downloaded.ok || !/^[a-f0-9]{64}$/.test(sha) ||
        !mime.includes('application/vnd.openxmlformats-officedocument.wordprocessingml.document'))
      throw new Error('Word non disponibile o senza verifica di integrità');
    const blob = await downloaded.blob();
    if (blob.size > MAX_FILE_BYTES) throw new Error('Word oltre la dimensione consentita');
    const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
    const hex = Array.from(new Uint8Array(digest), b=>b.toString(16).padStart(2,'0')).join('');
    if (hex !== sha) throw new Error('Verifica SHA-256 del Word fallita');
    const url = URL.createObjectURL(blob);
    try {
      const a = document.createElement('a');
      a.href = url; a.download = 'DUVRI_BOZZA_NON_EMETTIBILE.docx';
      document.body.appendChild(a); a.click(); a.remove();
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 3000);
    }
    return true;
  }

  function init() {
    const screen = document.querySelector('[data-screen="document-generation"]');
    const gate = screen.querySelector('.dg-auto-gate');
    if (!screen || !gate || document.getElementById('dg-generate-duvri')) return;
    const area = document.createElement('div');
    area.className = 'dg-form-actions';
    area.id = 'dg-generate-action';
    const btn = document.createElement('button');
    btn.id = 'dg-generate-duvri';
    btn.type = 'button';
    btn.className = 'btn btn-primary';
    btn.textContent = 'Genera DUVRI';
    btn.disabled = true;
    const consentLabel = document.createElement('label');
    consentLabel.className = 'dg-small-note';
    const consent = document.createElement('input');
    consent.type = 'checkbox';
    consent.id = 'dg-generation-consent';
    consentLabel.append(consent, document.createTextNode(' Autorizzo il caricamento della checklist e degli allegati nell’archivio privato Colligo per la preparazione della bozza DUVRI.'));
    const state = document.createElement('p');
    state.id = 'dg-generate-action-state';
    state.className = 'dg-small-note';
    state.setAttribute('role', 'status');
    state.setAttribute('aria-live', 'polite');
    const warning = document.createElement('p');
    warning.className = 'dg-small-note';
    warning.textContent = 'Solo BOZZA NON EMETTIBILE. Restano obbligatorie le verifiche tecniche, la decisione Titolo IV/art. 26 e le approvazioni HSE/D1/D2. Il modello Colligo deve essere configurato sul server.';
    const recent = document.createElement('div');
    recent.id = 'dg-recent-dossiers';
    recent.className = 'dg-small-note';
    recent.hidden = true;
    area.append(consentLabel, btn, state, warning, recent);
    gate.insertAdjacentElement('afterend', area);
    // Exactly two document uploads and one action in cloud mode; legacy
    // questionnaire/queue widgets remain in the DOM for backwards compatibility.
    if (typeof DOCUMENT_GENERATION_CLOUD_ENABLED !== 'undefined' &&
        DOCUMENT_GENERATION_CLOUD_ENABLED===true) {
      for (const selector of [
        '.dg-prototype-alert','.dg-workflow-strip','.dg-customer-instructions',
        '#dg-form','.dg-result-panel','.dg-queue-panel','.dg-auto-gate',
        '#dg-generate-reasons','#dg-template-details','#dg-auto-results'
      ]) {
        const node=screen.querySelector(selector);
        if(node){node.hidden=true;if(node.style)node.style.display='none';}
      }
    }
    let running = false;

    function snapshot() {
      const selection = globalThis.documentIntakeSelection;
      return {
        checklist: selection?.checklist?.() || null,
        attachments: selection?.documents?.() || [],
        busy: Boolean(selection?.busy?.())
      };
    }

    function refresh() {
      const snap = snapshot();
      const issues = validate(snap.checklist, snap.attachments, cloudAvailable(), consent.checked);
      if (snap.busy) issues.unshift('Attendi il completamento della lettura dei file.');
      btn.disabled = running || issues.length > 0;
      if (!running) state.textContent = issues[0] || 'Pronto: la bozza sarà accodata sul backend privato.';
    }

    async function loadRecent() {
      if (!cloudAvailable()) return;
      try {
        await appIdentity.ready();
        const token = await appIdentity.token();
        if (!token) return;
        const endpoint = new URL(DOCUMENT_JOBS_ENDPOINT);
        endpoint.searchParams.set('action', 'list');
        const response = await fetch(endpoint.toString(), {
          method: 'GET', headers: { authorization: 'Bearer ' + token }, cache: 'no-store'
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !Array.isArray(data.jobs) || data.issuance_allowed !== false)
          return;
        recent.replaceChildren();
        const jobs = data.jobs.slice(0, 8);
        recent.hidden = jobs.length === 0;
        if (jobs.length) {
          const title = document.createElement('p');
          title.textContent = 'Fascicoli DUVRI recenti (solo tuo account)';
          recent.appendChild(title);
        }
        for (const job of jobs) {
          if (!/^[0-9a-f-]{36}$/i.test(job.id || '')) continue;
          const row = document.createElement('p');
          const states = {
            collecting:'Caricamento interrotto', awaiting_worker:'In attesa elaborazione',
            processing:'In elaborazione', needs_review:'Bozza da revisionare',
            failed:'Elaborazione bloccata', cancelled:'Annullato'
          };
          row.appendChild(document.createTextNode(
            'Fascicolo '+job.id.slice(0,8)+' — '+(states[job.state] || 'Da verificare')+' '
          ));
          if (job.state === 'needs_review' && job.download_ready === true) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'btn';
            button.textContent = 'Scarica Word';
            button.addEventListener('click', async () => {
              button.disabled = true;
              try {
                const latestToken = await appIdentity.token();
                await downloadVerified(job.id, latestToken);
                state.textContent = 'Bozza DUVRI Word scaricata. NON EMETTIBILE: revisione HSE obbligatoria.';
              } catch (error) {
                state.textContent = 'Download non riuscito: '+(error?.message || 'errore locale');
              } finally { button.disabled = false; }
            });
            row.appendChild(button);
          }
          recent.appendChild(row);
        }
      } catch (_) {
        // The prior job list is informative. A failed refresh never discards a dossier.
      }
    }

    consent.addEventListener('change', refresh);
    screen.addEventListener('dg-intake-change', refresh);
    btn.addEventListener('click', async () => {
      if (running) return;
      const snap = snapshot();
      const issues = validate(snap.checklist, snap.attachments, cloudAvailable(), consent.checked);
      if (snap.busy || issues.length) { refresh(); return; }
      running = true;
      refresh();
      state.textContent = 'Trasferimento dei file e creazione del lavoro in corso…';
      try {
        const endpoint = new URL(DOCUMENT_JOBS_ENDPOINT);
        if (endpoint.protocol !== 'https:' &&
            !(endpoint.protocol === 'http:' && ['127.0.0.1','localhost'].includes(endpoint.hostname))) {
          throw new Error('Indirizzo del backend non sicuro.');
        }
        await appIdentity.ready();
        const token = await appIdentity.token();
        if (!token) throw new Error('Accesso scaduto: effettua nuovamente il login.');
        const files = [snap.checklist, ...snap.attachments.map(entry => entry.file)];
        const requestId = crypto.randomUUID();
        endpoint.searchParams.set('action', 'create');
        const response = await fetch(endpoint.toString(), {
          method: 'POST',
          headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
          body: JSON.stringify({request_id:requestId,files:files.map(file=>({
            name:file.name,size:file.size
          }))})
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !/^[0-9a-f-]{36}$/i.test(data.job?.id||'') ||
            data.job.state!=='collecting' || data.issuance_allowed!==false)
          throw new Error(data.error || 'Backend documentale non pronto.');
        const jobId=data.job.id;
        for (let i=0;i<files.length;i++) {
          state.textContent='Invio documenti '+(i+1)+' di '+files.length+'…';
          endpoint.searchParams.set('action','upload');
          endpoint.searchParams.set('job',jobId);
          endpoint.searchParams.set('slot',String(i));
          const uploaded=await fetch(endpoint.toString(),{
            method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/octet-stream'},
            body:files[i]
          });
          const receipt=await uploaded.json().catch(()=>({}));
          if(!uploaded.ok || receipt.received!==true || receipt.slot!==i ||
             typeof receipt.sha256!=='string' || !/^[a-f0-9]{64}$/.test(receipt.sha256))
            throw new Error(receipt.error || 'Invio file non completato: '+files[i].name);
        }
        endpoint.searchParams.set('action','finalize');
        endpoint.searchParams.delete('slot');
        const closed=await fetch(endpoint.toString(),{
          method:'POST',headers:{authorization:'Bearer '+token}
        });
        const completed=await closed.json().catch(()=>({}));
        if(!closed.ok || completed.job?.id!==jobId ||
           completed.job?.state!=='awaiting_worker' || completed.issuance_allowed!==false)
          throw new Error(completed.error || 'Fascicolo non completato');
        state.textContent='Fascicolo acquisito in modo privato. Elaborazione Word in corso: nessun DUVRI è ancora stato emesso.';
        // The backend must attest needs_review and SHA before downloading.
        for(let attempt=0;attempt<90;attempt++){
          await new Promise(resolve=>setTimeout(resolve,4000));
          endpoint.searchParams.set('action','status');
          const check=await fetch(endpoint.toString(),{
            method:'GET',headers:{authorization:'Bearer '+token},cache:'no-store'
          });
          const report=await check.json().catch(()=>({}));
          if(!check.ok || report.job?.id!==jobId || report.issuance_allowed!==false)
            throw new Error(report.error || 'Impossibile verificare lo stato del lavoro');
          if(report.job.state==='failed' || report.job.state==='cancelled')
            throw new Error('La generazione è stata bloccata: verifica il fascicolo.');
          if(report.job.state==='needs_review' && report.download_ready===true){
            await downloadVerified(jobId, token);
            state.textContent='DUVRI Word scaricato: BOZZA NON EMETTIBILE. Verifica HSE, interferenze, D1/D2 e firme.';
            await loadRecent();
            break;
          }
          if(attempt===89)
            state.textContent='Fascicolo salvato e in attesa del worker. Nessun DUVRI generato; verifica lo stato quando sarà disponibile.';
        }
        consent.checked = false;
        document.getElementById('dg-refresh-jobs')?.click();
      } catch (error) {
        state.textContent = 'Generazione non avviata: ' + (error?.message || 'errore di collegamento') + '.';
      } finally {
        running = false;
        // Mantieni il messaggio di esito invece di sostituirlo con il primo blocker.
        btn.disabled = true;
      }
    });
    refresh();
    if (cloudAvailable()) void loadRecent();
  }

  return { validate, metadata, init, LAYOUT_ID };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = duvriGenerateAction;
if (typeof document !== 'undefined') duvriGenerateAction.init();
