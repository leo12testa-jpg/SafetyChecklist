/* Sezione pilota per la raccolta dati della generazione documentale. Non invia file o dati a un servizio cloud/AI. */
(() => {
  'use strict';

  const screen = document.querySelector('[data-screen="document-generation"]');
  if (!screen) return;

  const form = document.getElementById('dg-form');
  const contractors = document.getElementById('dg-contractors');
  const addContractorButton = document.getElementById('dg-add-contractor');
  const checklistInput = document.getElementById('dg-checklist-file');
  const checklistFileStatus = document.getElementById('dg-checklist-file-status');
  const filesInput = document.getElementById('dg-files');
  const filesList = document.getElementById('dg-files-list');
  const resultPanel = document.getElementById('dg-result');
  const resultTitle = document.getElementById('dg-result-title');
  const resultSummary = document.getElementById('dg-result-summary');
  const missingList = document.getElementById('dg-missing-list');
  const downloadButton = document.getElementById('dg-download-json');
  const resetButton = document.getElementById('dg-reset');
  const submitButton = form.querySelector('button[type="submit"]');
  const cloudStatus = document.getElementById('dg-cloud-status');
  const orgUsageSummary = document.getElementById('dg-org-usage-summary');
  const queueList = document.getElementById('dg-queue-list');
  const refreshJobsButton = document.getElementById('dg-refresh-jobs');
  let preparedRecord = null;
  let currentJobId = null;
  let submitting = false;
  const cloudEnabled = typeof DOCUMENT_GENERATION_CLOUD_ENABLED !== 'undefined' &&
    DOCUMENT_GENERATION_CLOUD_ENABLED === true;

  function escapeText(value) {
    return String(value == null ? '' : value);
  }

  function statusLabel(status) {
    const labels = {
      queued: 'In coda',
      processing: 'In elaborazione',
      retry_wait: 'Nuovo tentativo programmato',
      awaiting_input: 'Informazioni da integrare',
      awaiting_configuration: 'Configurazione da completare',
      needs_review: 'Da revisionare',
      approved: 'Approvato dal revisore',
      rejected: 'Rifiutato',
      error: 'Errore',
      cancelled: 'Annullato'
    };
    return labels[status] || 'Stato non riconosciuto';
  }

  async function requestJobs(action, options = {}) {
    if (!cloudEnabled || typeof DOCUMENT_JOBS_ENDPOINT === 'undefined') {
      throw new Error('Il backend documentale cloud non è ancora attivo.');
    }
    if (typeof appIdentity === 'undefined') throw new Error('Servizio di autenticazione non disponibile.');
    await appIdentity.ready();
    const token = await appIdentity.token();
    const url = new URL(DOCUMENT_JOBS_ENDPOINT);
    url.searchParams.set('action', action);
    Object.entries(options.query || {}).forEach(([key, value]) => url.searchParams.set(key, String(value)));
    const isForm = options.body instanceof FormData;
    const response = await fetch(url.toString(), {
      method: options.method || (options.body ? 'POST' : 'GET'),
      headers: {
        authorization: 'Bearer ' + token,
        ...(options.body && !isForm ? { 'content-type': 'application/json' } : {})
      },
      ...(options.body ? { body: isForm ? options.body : JSON.stringify(options.body) } : {})
    });
    const contentType = response.headers.get('content-type') || '';
    if (!response.ok) {
      let message = 'Richiesta documentale non riuscita.';
      if (contentType.includes('application/json')) {
        const error = await response.json().catch(() => ({}));
        if (error && typeof error.error === 'string') message = error.error;
      }
      throw new Error(message);
    }
    if (!contentType.includes('application/json')) throw new Error('Risposta del backend non valida.');
    return await response.json();
  }

  async function downloadJobFile(jobId, fileId, filename) {
    if (!cloudEnabled) return;
    try {
      await appIdentity.ready();
      const token = await appIdentity.token();
      const url = new URL(DOCUMENT_JOBS_ENDPOINT);
      url.searchParams.set('action', 'download');
      url.searchParams.set('id', jobId);
      url.searchParams.set('file_id', fileId);
      const response = await fetch(url.toString(), { headers: { authorization: 'Bearer ' + token } });
      if (!response.ok) throw new Error('Download non disponibile.');
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = filename || 'documento';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);
    } catch (error) {
      cloudStatus.textContent = error.message || 'Impossibile scaricare il file.';
    }
  }

  function queueMessage(title, detail) {
    queueList.replaceChildren();
    const empty = document.createElement('div');
    empty.className = 'dg-queue-empty';
    const strong = document.createElement('strong');
    strong.textContent = title;
    const text = document.createElement('p');
    text.textContent = detail;
    empty.append(strong, text);
    queueList.appendChild(empty);
  }

  async function loadCloudUsage() {
    if (!orgUsageSummary) return;
    if (!cloudEnabled || typeof appIdentity === 'undefined' || !appIdentity.isAdmin()) {
      orgUsageSummary.hidden = true;
      return;
    }
    try {
      const data = await requestJobs('usage');
      const title = document.createElement('strong');
      title.textContent = 'Consumo AI SafetyChecklist — mese corrente';
      const paragraph = document.createElement('p');
      const money = (value) => 'USD ' + (Number(value) || 0).toFixed(4);
      const jobCount = Number(data.jobsMeasured) || 0;
      const callCount = Number(data.callsMeasured) || 0;
      let sentence = money(data.estimatedSpendUsd) + ' stimati su un budget di riferimento di ' +
        money(data.budgetUsd) + ' · ' + callCount + ' chiamate AI · ' +
        (Number(data.inputTokens) || 0).toLocaleString('it-IT') + ' token input · ' +
        (Number(data.outputTokens) || 0).toLocaleString('it-IT') + ' token output.';
      if (data.allCallCostsKnown && data.averageCostPerJobUsd && data.estimatedJobsRemaining !== null) {
        sentence += ' Media stimata: ' + money(data.averageCostPerJobUsd) +
          ' per job con utilizzo registrato; circa ' + data.estimatedJobsRemaining +
          ' job equivalenti nel budget di riferimento.';
      } else if (jobCount) {
        sentence += ' Alcuni costi non sono stimabili con il listino configurato.';
      } else {
        sentence += ' Nessun consumo AI registrato da SafetyChecklist in questo periodo.';
      }
      paragraph.textContent = sentence;
      const note = document.createElement('p');
      note.className = 'dg-usage-note';
      note.textContent = 'Stima dei soli lavori SafetyChecklist, non saldo ufficiale dell’organizzazione. Playground, altre chiavi e altri agenti possono consumare lo stesso credito. Verifica sempre i 40 USD residui nella Claude Console.';
      orgUsageSummary.replaceChildren(title, paragraph, note);
      orgUsageSummary.hidden = false;
    } catch (error) {
      orgUsageSummary.textContent = 'Riepilogo consumi non disponibile: ' + (error.message || 'verificare configurazione backend.');
      orgUsageSummary.hidden = false;
    }
  }

  async function showJobDetails(jobId, card) {
    const previous = card.querySelector('.dg-job-details');
    if (previous) { previous.remove(); return; }
    const details = document.createElement('div');
    details.className = 'dg-job-details';
    details.textContent = 'Caricamento dettagli…';
    card.appendChild(details);
    try {
      const data = await requestJobs('status', { query: { id: jobId } });
      details.replaceChildren();
      const heading = document.createElement('h5');
      heading.textContent = 'Dettagli del lavoro';
      details.appendChild(heading);
      const status = document.createElement('p');
      status.textContent = (data.job.status_message || statusLabel(data.job.status)) + ' · fase: ' + (data.job.phase || '—');
      details.appendChild(status);

      if (Array.isArray(data.files) && data.files.length) {
        const title = document.createElement('strong');
        title.textContent = 'File associati';
        details.appendChild(title);
        const fileList = document.createElement('ul');
        data.files.forEach((file) => {
          const li = document.createElement('li');
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'dg-link-button';
          button.textContent = 'Scarica ' + file.filename + ' (' + Math.round(Number(file.size_bytes || 0) / 1024) + ' KB)';
          button.addEventListener('click', () => downloadJobFile(jobId, file.id, file.filename));
          li.appendChild(button);
          fileList.appendChild(li);
        });
        details.appendChild(fileList);
      }

      if (Array.isArray(data.events) && data.events.length) {
        const usageEvents = data.events.filter((event) => event.details && event.details.usageKind === 'ai_usage');
        if (usageEvents.length) {
          const usageBox = document.createElement('div');
          usageBox.className = 'dg-usage-summary';
          const usageTitle = document.createElement('strong');
          usageTitle.textContent = 'Consumo AI misurato';
          const inputTokens = usageEvents.reduce((sum, event) => sum + (Number(event.details.inputTokens) || 0), 0);
          const outputTokens = usageEvents.reduce((sum, event) => sum + (Number(event.details.outputTokens) || 0), 0);
          const knownCosts = usageEvents.filter((event) => typeof event.details.estimatedCostUsd === 'number' && Number.isFinite(event.details.estimatedCostUsd));
          const totalCost = knownCosts.reduce((sum, event) => sum + Number(event.details.estimatedCostUsd), 0);
          const usageSummary = document.createElement('p');
          usageSummary.textContent = inputTokens.toLocaleString('it-IT') + ' token input · ' +
            outputTokens.toLocaleString('it-IT') + ' token output · ' +
            (knownCosts.length === usageEvents.length
              ? 'circa 
        const title = document.createElement('strong');
        title.textContent = 'Cronologia agenti';
        details.appendChild(title);
        const eventList = document.createElement('ul');
        data.events.forEach((event) => {
          const li = document.createElement('li');
          const stamp = event.created_at ? new Date(event.created_at).toLocaleString('it-IT') + ' — ' : '';
          li.textContent = stamp + (event.agent ? event.agent + ': ' : '') + (event.message || event.event_type || '');
          eventList.appendChild(li);
        });
        details.appendChild(eventList);
      }

      if (data.job.status === 'needs_review' && typeof appIdentity !== 'undefined' && appIdentity.isAdmin()) {
        const reviewBox = document.createElement('div');
        reviewBox.className = 'dg-review-actions';
        const comment = document.createElement('textarea');
        comment.rows = 2;
        comment.maxLength = 2000;
        comment.placeholder = 'Note per la revisione (facoltative)';
        const actions = document.createElement('div');
        actions.className = 'dg-review-buttons';
        [['approved','Approva'],['changes_requested','Richiedi modifiche'],['rejected','Rifiuta']].forEach(([decision, label]) => {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = decision === 'approved' ? 'btn btn-primary' : 'btn';
          button.textContent = label;
          button.addEventListener('click', async () => {
            button.disabled = true;
            try {
              await requestJobs('review', { method: 'POST', body: { id: jobId, decision, comment: comment.value } });
              await loadCloudJobs();
            } catch (error) {
              cloudStatus.textContent = error.message || 'Revisione non riuscita.';
            } finally {
              button.disabled = false;
            }
          });
          actions.appendChild(button);
        });
        reviewBox.append(comment, actions);
        details.appendChild(reviewBox);
      }
    } catch (error) {
      details.textContent = error.message || 'Dettagli non disponibili.';
    }
  }

  async function loadCloudJobs() {
    if (!cloudEnabled) {
      cloudStatus.textContent = 'Backend cloud non attivo: le schede vengono preparate soltanto in locale. Il caricamento e la generazione non sono disponibili.';
      queueMessage('Coda cloud non attiva', 'Prima di abilitare il servizio occorre distribuire il gateway, applicare lo schema approvato e attivare il worker schedulato.');
      return;
    }
    refreshJobsButton.disabled = true;
    cloudStatus.textContent = 'Lettura delle elaborazioni cloud…';
    try {
      const result = await requestJobs('list');
      const jobs = Array.isArray(result.jobs) ? result.jobs : [];
      queueList.replaceChildren();
      if (!jobs.length) {
        queueMessage('Nessun lavoro documentale', 'Quando invierai una checklist, il lavoro comparirà qui e continuerà sul cloud anche se spegni il dispositivo.');
      } else {
        jobs.forEach((job) => {
          const card = document.createElement('article');
          card.className = 'dg-job-card';
          const top = document.createElement('div');
          top.className = 'dg-job-card-top';
          const title = document.createElement('h4');
          title.textContent = job.title || 'Documento senza titolo';
          const badge = document.createElement('span');
          badge.className = 'dg-job-status';
          badge.dataset.status = String(job.status || 'unknown');
          badge.textContent = statusLabel(job.status);
          top.append(title, badge);
          const meta = document.createElement('p');
          meta.className = 'dg-job-meta';
          meta.textContent = (job.document_type || 'documento') + ' · ' +
            (job.created_at ? new Date(job.created_at).toLocaleString('it-IT') : 'data non disponibile') +
            (job.phase ? ' · fase ' + job.phase : '');
          const message = document.createElement('p');
          message.className = 'dg-job-message';
          message.textContent = job.status_message || '';
          const actions = document.createElement('div');
          actions.className = 'dg-job-actions';
          const detailButton = document.createElement('button');
          detailButton.type = 'button';
          detailButton.className = 'btn';
          detailButton.textContent = 'Dettagli';
          detailButton.addEventListener('click', () => showJobDetails(job.id, card));
          actions.appendChild(detailButton);

          if (['queued','retry_wait','awaiting_input','awaiting_configuration'].includes(job.status)) {
            const cancelButton = document.createElement('button');
            cancelButton.type = 'button';
            cancelButton.className = 'btn';
            cancelButton.textContent = 'Annulla';
            cancelButton.addEventListener('click', async () => {
              cancelButton.disabled = true;
              try {
                await requestJobs('cancel', { method: 'POST', body: { id: job.id } });
                await loadCloudJobs();
              } catch (error) {
                cloudStatus.textContent = error.message || 'Annullamento non riuscito.';
              } finally {
                cancelButton.disabled = false;
              }
            });
            actions.appendChild(cancelButton);
          }
          if (['error','retry_wait','awaiting_configuration','awaiting_input'].includes(job.status)) {
            const retryButton = document.createElement('button');
            retryButton.type = 'button';
            retryButton.className = 'btn';
            retryButton.textContent = 'Rimetti in coda';
            retryButton.addEventListener('click', async () => {
              retryButton.disabled = true;
              try {
                await requestJobs('retry', { method: 'POST', body: { id: job.id } });
                await loadCloudJobs();
              } catch (error) {
                cloudStatus.textContent = error.message || 'Ripresa non riuscita.';
              } finally {
                retryButton.disabled = false;
              }
            });
            actions.appendChild(retryButton);
          }

          card.append(top, meta, message, actions);
          queueList.appendChild(card);
        });
      }
      cloudStatus.textContent = 'Collegamento cloud raggiungibile. Stati e cronologia sono letti dal server.';
    } catch (error) {
      cloudStatus.textContent = error.message || 'Impossibile leggere le elaborazioni cloud.';
      queueMessage('Elenco non disponibile', 'Verifica la connessione e la configurazione del backend; i lavori già salvati sul cloud non dipendono dal browser.');
    } finally {
      refreshJobsButton.disabled = false;
    }
  }

  function renderPreparedRecord(record, missing, mode = 'local') {
    resultTitle.textContent = mode === 'cloud' ? 'Lavoro documentale accodato' : 'Scheda dati pronta per il test';
    const selectedType = form.elements.documentType.selectedOptions[0]?.textContent || 'Documento';
    resultSummary.textContent = selectedType + ' · ' + (record.sourceChecklist ? record.sourceChecklist.name : 'Checklist non selezionata') + ' · ' +
      record.contractors.length + (record.contractors.length === 1 ? ' scheda impresa' : ' schede impresa') + ' · ' +
      record.documents.length + (record.documents.length === 1 ? ' allegato di supporto' : ' allegati di supporto') +
      ' · ' + missing.length + (missing.length === 1 ? ' verifica da completare' : ' verifiche da completare');
    renderMissing(missing);
    resultPanel.hidden = false;
    resultPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function contractorCardCount() {
    return contractors.querySelectorAll('.dg-contractor-card').length;
  }

  function updateContractorCards() {
    const cards = Array.from(contractors.querySelectorAll('.dg-contractor-card'));
    cards.forEach((card, index) => {
      const number = card.querySelector('.dg-contractor-number');
      const remove = card.querySelector('[data-dg-remove-contractor]');
      if (number) number.textContent = 'Impresa ' + (index + 1);
      if (remove) remove.hidden = cards.length === 1;
    });
  }

  addContractorButton.addEventListener('click', () => {
    const template = document.getElementById('dg-contractor-template');
    if (!template) return;
    contractors.appendChild(template.content.cloneNode(true));
    refreshJobsButton?.addEventListener('click', loadCloudJobs);
  document.addEventListener('click', (event) => {
    const trigger = event.target.closest('[data-nav="document-generation"]');
    if (trigger) loadCloudJobs();
  });
  if (cloudEnabled) {
    const localNotice = screen.querySelector('.dg-prototype-alert p');
    if (localNotice) localNotice.textContent = 'Il backend documentale è attivo. La checklist e gli allegati verranno caricati in area privata; il processo cloud prosegue senza tenere aperto il browser.';
    if (submitButton) submitButton.textContent = 'Carica checklist e avvia agenti';
    queueMessage('Carica la checklist per avviare il primo lavoro', 'Una volta ricevuta la conferma di accodamento, puoi chiudere il browser o spegnere il dispositivo.');
    loadCloudJobs();
  } else {
    loadCloudJobs();
  }

  updateContractorCards();
  });

  contractors.addEventListener('click', (event) => {
    const removeButton = event.target.closest('[data-dg-remove-contractor]');
    if (!removeButton || contractorCardCount() <= 1) return;
    removeButton.closest('.dg-contractor-card')?.remove();
    updateContractorCards();
  });

  checklistInput.addEventListener('change', () => {
    const file = checklistInput.files && checklistInput.files[0];
    checklistFileStatus.textContent = file
      ? 'Checklist selezionata: ' + file.name + ' · ' + (file.size < 1024 * 1024 ? Math.max(1, Math.round(file.size / 1024)) + ' KB' : (file.size / (1024 * 1024)).toFixed(1) + ' MB') + '. In questa versione resta sul dispositivo.'
      : 'Checklist non selezionata: scegli il file compilato per continuare.';
    checklistFileStatus.classList.toggle('is-selected', !!file);
  });

  filesInput.addEventListener('change', () => {
    filesList.replaceChildren();
    const files = Array.from(filesInput.files || []);
    if (!files.length) {
      const empty = document.createElement('li');
      empty.textContent = 'Nessun documento selezionato.';
      filesList.appendChild(empty);
      return;
    }
    files.forEach((file) => {
      const item = document.createElement('li');
      const size = file.size < 1024 * 1024
        ? Math.max(1, Math.round(file.size / 1024)) + ' KB'
        : (file.size / (1024 * 1024)).toFixed(1) + ' MB';
      item.textContent = file.name + ' · ' + size;
      filesList.appendChild(item);
    });
  });

  function readContractors() {
    return Array.from(contractors.querySelectorAll('.dg-contractor-card')).map((card, index) => {
      const get = (field) => card.querySelector('[data-field="' + field + '"]')?.value.trim() || '';
      return {
        index: index + 1,
        company: get('company'),
        scope: get('scope'),
        preposto: { name: get('preposto'), roleOrArea: get('prepostoRole') },
        equipment: get('equipment'),
        ppe: get('ppe')
      };
    });
  }

  function checkedModules() {
    return Array.from(form.querySelectorAll('[name="modules"]:checked')).map((input) => input.value);
  }

  function collectMissing(data) {
    const missing = [];
    if (!data.job.title) missing.push('Titolo esatto del DUVRI da confermare: non inventare il titolo del frontespizio.');
    if (!data.job.documentDate) missing.push('Data da riportare sul DUVRI da confermare esplicitamente.');
    if (!data.client.legalName) missing.push('Ragione sociale del committente da estrarre e/o confermare.');
    if (!data.site.address) missing.push('Sede e indirizzo dell’intervento da estrarre e/o confermare.');
    if (!data.site.context || data.site.context === 'unknown' || data.site.context === 'other') missing.push('Tipo di area (interno, cantiere/esterno o misto) da confermare dopo l’analisi della checklist.');
    if (!data.work.description) missing.push('Descrizione dell’appalto da ricostruire dalla checklist e confermare.');
    if (!data.aiDataProcessingConsent) missing.push('Consenso al trasferimento di checklist e allegati al provider AI da raccogliere prima di attivare l’elaborazione cloud.');
    data.contractors.forEach((company, index) => {
      if (!company.company) missing.push('Impresa ' + (index + 1) + ': ragione sociale da estrarre dalla checklist e confermare.');
      const label = company.company || ('Impresa ' + (index + 1));
      if (!company.preposto.name) missing.push(label + ': nominativo del preposto da acquisire o confermare.');
      if (!company.preposto.roleOrArea) missing.push(label + ': mansione/area di competenza del preposto da specificare.');
      if (!company.equipment) missing.push(label + ': elenco mezzi/macchinari/attrezzature e proprietà da completare.');
      if (!company.ppe) missing.push(label + ': DPI previsti da documentare o confermare.');
      if (!company.scope) missing.push(label + ': descrizione delle attività da dettagliare.');
    });
    const fileNames = [
      ...(data.sourceChecklist ? [data.sourceChecklist.name] : []),
      ...data.documents.map((file) => file.name)
    ].map((name) => name.toLowerCase());
    if (!fileNames.some((name) => name.includes('dvr'))) missing.push('DVR specifico: verificare se disponibile o pertinente e acquisirlo se necessario.');
    if (!fileNames.some((name) => name.includes('cronoprogramma') || name.includes('programma lavori') || name.includes('planning'))) {
      missing.push('Cronoprogramma lavori: verificare disponibilità e acquisirlo se necessario.');
    }
    if (!fileNames.some((name) => name.includes('planimetr') || name.includes('planimetry') || name.includes('layout'))) {
      missing.push('Planimetria/layout dell’area: verificare se necessario e acquisirlo.');
    }
    if (data.modules.includes('confined-space') && !fileNames.some((name) => name.includes('procedura') || name.includes('permesso'))) {
      missing.push('Modulo spazi confinati: verificare procedure e permessi pertinenti prima della valutazione tecnica.');
    }
    return missing;
  }

  function createRecord() {
    const data = new FormData(form);
    const checklist = checklistInput.files && checklistInput.files[0];
    const checklistFile = checklist ? {
      name: checklist.name,
      size: checklist.size,
      mimeType: checklist.type || 'application/octet-stream',
      lastModified: checklist.lastModified,
      contentIncluded: false
    } : null;
    const documents = Array.from(filesInput.files || []).map((file) => ({
      name: file.name,
      size: file.size,
      mimeType: file.type || 'application/octet-stream',
      lastModified: file.lastModified,
      contentIncluded: false
    }));
    return {
      schema: 'colligo-document-intake/0.3',
      documentType: escapeText(data.get('documentType') || 'duvri'),
      recordId: (globalThis.crypto && typeof crypto.randomUUID === 'function')
        ? crypto.randomUUID()
        : 'document-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9),
      createdAt: new Date().toISOString(),
      prototypeStatus: 'local-intake-only',
      cloudSubmission: false,
      aiGenerationStarted: false,
      humanReviewRequired: true,
      workflow: [
        { agent: 'coordinator', label: 'Coordinatore', status: 'not_connected' },
        { agent: 'document-reader', label: 'Analista documentale', status: 'not_connected' },
        { agent: 'duvri-analyst', label: 'Analista interferenze', status: 'not_connected' },
        { agent: 'docx-writer', label: 'Redattore Word', status: 'not_connected' },
        { agent: 'quality-check', label: 'Verificatore', status: 'not_connected' }
      ],
      job: {
        title: escapeText(data.get('title')).trim(),
        documentType: escapeText(data.get('documentType') || 'duvri'),
        documentDate: escapeText(data.get('documentDate')),
        complexity: escapeText(data.get('complexity')),
        startDate: escapeText(data.get('startDate')),
        endDate: escapeText(data.get('endDate'))
      },
      client: { legalName: escapeText(data.get('clientName')).trim() },
      site: {
        address: escapeText(data.get('site')).trim(),
        context: escapeText(data.get('siteType')),
        accessNotes: escapeText(data.get('accessNotes')).trim()
      },
      work: { description: escapeText(data.get('workDescription')).trim() },
      contractors: readContractors(),
      modules: checkedModules(),
      sourceChecklist: checklistFile,
      documents,
      aiDataProcessingConsent: data.get('aiDataProcessingConsent') === 'yes',
      notes: escapeText(data.get('notes')).trim(),
      notices: [
        'Scheda di raccolta dati del prototipo: i documenti selezionati non sono stati caricati e il loro contenuto non è incluso.',
        'Nessun dato è stato inviato a un backend o a un provider AI. Non è stato generato alcun documento.',
        'Le lacune riportate sono promemoria di raccolta, non una valutazione esaustiva di completezza o sicurezza.'
      ]
    };
  }

  function renderMissing(items) {
    missingList.replaceChildren();
    if (!items.length) {
      const item = document.createElement('li');
      item.textContent = 'Nessuna lacuna rilevata dai controlli preliminari di questa schermata. Questo non equivale a una verifica tecnica completa.';
      missingList.appendChild(item);
      return;
    }
    items.forEach((text) => {
      const item = document.createElement('li');
      item.textContent = text;
      missingList.appendChild(item);
    });
  }

  function invalidatePreparedRecord() {
    if (!preparedRecord) return;
    preparedRecord = null;
    resultPanel.hidden = true;
  }

  form.addEventListener('input', invalidatePreparedRecord);
  form.addEventListener('change', invalidatePreparedRecord);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submitting || !form.reportValidity()) return;
    const start = form.elements.startDate.value;
    const end = form.elements.endDate.value;
    if (start && end && end < start) {
      alert('La data di fine lavori non può precedere la data di inizio.');
      form.elements.endDate.focus();
      return;
    }
    preparedRecord = createRecord();
    const missing = collectMissing(preparedRecord);

    if (!cloudEnabled) {
      renderPreparedRecord(preparedRecord, missing, 'local');
      cloudStatus.textContent = 'Backend cloud non attivo: la checklist non viene caricata e nessun agente è stato avviato.';
      return;
    }

    if (!preparedRecord.aiDataProcessingConsent) {
      cloudStatus.textContent = 'Prima di inviare i file al provider AI devi confermare il consenso al trattamento cloud.';
      const consent = form.querySelector('[name="aiDataProcessingConsent"]');
      consent?.focus();
      renderPreparedRecord(preparedRecord, missing, 'local');
      return;
    }

    const checklist = checklistInput.files && checklistInput.files[0];
    if (!checklist) {
      cloudStatus.textContent = 'Seleziona la checklist compilata prima di avviare il lavoro.';
      checklistInput.focus();
      return;
    }

    const upload = new FormData();
    upload.append('metadata', JSON.stringify({
      ...preparedRecord,
      title: preparedRecord.job.title,
      documentType: preparedRecord.documentType,
      siteType: preparedRecord.site.context,
      complexity: preparedRecord.job.complexity,
      aiDataProcessingConsent: preparedRecord.aiDataProcessingConsent
    }));
    upload.append('checklist', checklist, checklist.name);
    Array.from(filesInput.files || []).forEach((file) => upload.append('files', file, file.name));

    submitting = true;
    submitButton.disabled = true;
    submitButton.textContent = 'Caricamento e accodamento…';
    cloudStatus.textContent = 'Caricamento privato della checklist e degli allegati…';
    try {
      const created = await requestJobs('create', { method: 'POST', body: upload });
      currentJobId = created.job?.id || null;
      if (currentJobId) {
        preparedRecord.cloudSubmission = true;
        preparedRecord.aiGenerationStarted = false;
        preparedRecord.recordId = currentJobId;
        preparedRecord.serverJob = created.job;
      }
      const message = created.message || 'Lavoro salvato nel cloud.';
      resultTitle.textContent = 'Lavoro documentale salvato';
      resultSummary.textContent = (created.job?.documentTypeName || created.job?.documentType || preparedRecord.documentType) +
        ' · ID ' + (currentJobId || 'non disponibile') + ' · stato: ' + statusLabel(created.job?.status || 'queued');
      renderMissing(missing);
      resultPanel.hidden = false;
      resultPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
      cloudStatus.textContent = message;
      await loadCloudJobs();
    } catch (error) {
      cloudStatus.textContent = error.message || 'Non è stato possibile accodare il lavoro. Verifica la connessione e riprova.';
    } finally {
      submitting = false;
      submitButton.disabled = false;
      submitButton.textContent = 'Carica checklist e avvia agenti';
    }
  });

  downloadButton.addEventListener('click', () => {
    if (!preparedRecord) return;
    const blob = new Blob([JSON.stringify(preparedRecord, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const safeName = (preparedRecord.job.title || 'nuovo-duvri')
      .normalize('NFKD').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'nuovo-duvri';
    link.download = 'scheda-documento-' + safeName + '.json';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  resetButton.addEventListener('click', () => {
    if (!confirm('Vuoi azzerare i dati inseriti in questa scheda? Le informazioni non saranno recuperabili.')) return;
    form.reset();
    checklistFileStatus.textContent = 'Checklist non selezionata: scegli il file compilato per continuare.';
    checklistFileStatus.classList.remove('is-selected');
    const cards = Array.from(contractors.querySelectorAll('.dg-contractor-card'));
    cards.slice(1).forEach((card) => card.remove());
    filesList.replaceChildren();
    const empty = document.createElement('li');
    empty.textContent = 'Nessun documento selezionato.';
    filesList.appendChild(empty);
    resultPanel.hidden = true;
    preparedRecord = null;
    updateContractorCards();
    screen.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  updateContractorCards();
})();
 + totalCost.toFixed(4) + ' di credito stimato'
              : 'costo parziale: alcuni modelli non sono ancora contabilizzati');
          usageBox.append(usageTitle, usageSummary);
          details.appendChild(usageBox);
        }
      }

      if (Array.isArray(data.events) && data.events.length) {
        const title = document.createElement('strong');
        title.textContent = 'Cronologia agenti';
        details.appendChild(title);
        const eventList = document.createElement('ul');
        data.events.forEach((event) => {
          const li = document.createElement('li');
          const stamp = event.created_at ? new Date(event.created_at).toLocaleString('it-IT') + ' — ' : '';
          li.textContent = stamp + (event.agent ? event.agent + ': ' : '') + (event.message || event.event_type || '');
          eventList.appendChild(li);
        });
        details.appendChild(eventList);
      }

      if (data.job.status === 'needs_review' && typeof appIdentity !== 'undefined' && appIdentity.isAdmin()) {
        const reviewBox = document.createElement('div');
        reviewBox.className = 'dg-review-actions';
        const comment = document.createElement('textarea');
        comment.rows = 2;
        comment.maxLength = 2000;
        comment.placeholder = 'Note per la revisione (facoltative)';
        const actions = document.createElement('div');
        actions.className = 'dg-review-buttons';
        [['approved','Approva'],['changes_requested','Richiedi modifiche'],['rejected','Rifiuta']].forEach(([decision, label]) => {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = decision === 'approved' ? 'btn btn-primary' : 'btn';
          button.textContent = label;
          button.addEventListener('click', async () => {
            button.disabled = true;
            try {
              await requestJobs('review', { method: 'POST', body: { id: jobId, decision, comment: comment.value } });
              await loadCloudJobs();
            } catch (error) {
              cloudStatus.textContent = error.message || 'Revisione non riuscita.';
            } finally {
              button.disabled = false;
            }
          });
          actions.appendChild(button);
        });
        reviewBox.append(comment, actions);
        details.appendChild(reviewBox);
      }
    } catch (error) {
      details.textContent = error.message || 'Dettagli non disponibili.';
    }
  }

  async function loadCloudJobs() {
    if (!cloudEnabled) {
      cloudStatus.textContent = 'Backend cloud non attivo: le schede vengono preparate soltanto in locale. Il caricamento e la generazione non sono disponibili.';
      queueMessage('Coda cloud non attiva', 'Prima di abilitare il servizio occorre distribuire il gateway, applicare lo schema approvato e attivare il worker schedulato.');
      return;
    }
    refreshJobsButton.disabled = true;
    cloudStatus.textContent = 'Lettura delle elaborazioni cloud…';
    try {
      const result = await requestJobs('list');
      const jobs = Array.isArray(result.jobs) ? result.jobs : [];
      queueList.replaceChildren();
      if (!jobs.length) {
        queueMessage('Nessun lavoro documentale', 'Quando invierai una checklist, il lavoro comparirà qui e continuerà sul cloud anche se spegni il dispositivo.');
      } else {
        jobs.forEach((job) => {
          const card = document.createElement('article');
          card.className = 'dg-job-card';
          const top = document.createElement('div');
          top.className = 'dg-job-card-top';
          const title = document.createElement('h4');
          title.textContent = job.title || 'Documento senza titolo';
          const badge = document.createElement('span');
          badge.className = 'dg-job-status';
          badge.dataset.status = String(job.status || 'unknown');
          badge.textContent = statusLabel(job.status);
          top.append(title, badge);
          const meta = document.createElement('p');
          meta.className = 'dg-job-meta';
          meta.textContent = (job.document_type || 'documento') + ' · ' +
            (job.created_at ? new Date(job.created_at).toLocaleString('it-IT') : 'data non disponibile') +
            (job.phase ? ' · fase ' + job.phase : '');
          const message = document.createElement('p');
          message.className = 'dg-job-message';
          message.textContent = job.status_message || '';
          const actions = document.createElement('div');
          actions.className = 'dg-job-actions';
          const detailButton = document.createElement('button');
          detailButton.type = 'button';
          detailButton.className = 'btn';
          detailButton.textContent = 'Dettagli';
          detailButton.addEventListener('click', () => showJobDetails(job.id, card));
          actions.appendChild(detailButton);

          if (['queued','retry_wait','awaiting_input','awaiting_configuration'].includes(job.status)) {
            const cancelButton = document.createElement('button');
            cancelButton.type = 'button';
            cancelButton.className = 'btn';
            cancelButton.textContent = 'Annulla';
            cancelButton.addEventListener('click', async () => {
              cancelButton.disabled = true;
              try {
                await requestJobs('cancel', { method: 'POST', body: { id: job.id } });
                await loadCloudJobs();
              } catch (error) {
                cloudStatus.textContent = error.message || 'Annullamento non riuscito.';
              } finally {
                cancelButton.disabled = false;
              }
            });
            actions.appendChild(cancelButton);
          }
          if (['error','retry_wait','awaiting_configuration','awaiting_input'].includes(job.status)) {
            const retryButton = document.createElement('button');
            retryButton.type = 'button';
            retryButton.className = 'btn';
            retryButton.textContent = 'Rimetti in coda';
            retryButton.addEventListener('click', async () => {
              retryButton.disabled = true;
              try {
                await requestJobs('retry', { method: 'POST', body: { id: job.id } });
                await loadCloudJobs();
              } catch (error) {
                cloudStatus.textContent = error.message || 'Ripresa non riuscita.';
              } finally {
                retryButton.disabled = false;
              }
            });
            actions.appendChild(retryButton);
          }

          card.append(top, meta, message, actions);
          queueList.appendChild(card);
        });
      }
      if (typeof appIdentity !== 'undefined' && appIdentity.isAdmin()) await loadCloudUsage();
      cloudStatus.textContent = 'Collegamento cloud raggiungibile. Stati e cronologia sono letti dal server.';
    } catch (error) {
      cloudStatus.textContent = error.message || 'Impossibile leggere le elaborazioni cloud.';
      queueMessage('Elenco non disponibile', 'Verifica la connessione e la configurazione del backend; i lavori già salvati sul cloud non dipendono dal browser.');
    } finally {
      refreshJobsButton.disabled = false;
    }
  }

  function renderPreparedRecord(record, missing, mode = 'local') {
    resultTitle.textContent = mode === 'cloud' ? 'Lavoro documentale accodato' : 'Scheda dati pronta per il test';
    const selectedType = form.elements.documentType.selectedOptions[0]?.textContent || 'Documento';
    resultSummary.textContent = selectedType + ' · ' + (record.sourceChecklist ? record.sourceChecklist.name : 'Checklist non selezionata') + ' · ' +
      record.contractors.length + (record.contractors.length === 1 ? ' scheda impresa' : ' schede impresa') + ' · ' +
      record.documents.length + (record.documents.length === 1 ? ' allegato di supporto' : ' allegati di supporto') +
      ' · ' + missing.length + (missing.length === 1 ? ' verifica da completare' : ' verifiche da completare');
    renderMissing(missing);
    resultPanel.hidden = false;
    resultPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function contractorCardCount() {
    return contractors.querySelectorAll('.dg-contractor-card').length;
  }

  function updateContractorCards() {
    const cards = Array.from(contractors.querySelectorAll('.dg-contractor-card'));
    cards.forEach((card, index) => {
      const number = card.querySelector('.dg-contractor-number');
      const remove = card.querySelector('[data-dg-remove-contractor]');
      if (number) number.textContent = 'Impresa ' + (index + 1);
      if (remove) remove.hidden = cards.length === 1;
    });
  }

  addContractorButton.addEventListener('click', () => {
    const template = document.getElementById('dg-contractor-template');
    if (!template) return;
    contractors.appendChild(template.content.cloneNode(true));
    refreshJobsButton?.addEventListener('click', loadCloudJobs);
  document.addEventListener('click', (event) => {
    const trigger = event.target.closest('[data-nav="document-generation"]');
    if (trigger) loadCloudJobs();
  });
  if (cloudEnabled) {
    const localNotice = screen.querySelector('.dg-prototype-alert p');
    if (localNotice) localNotice.textContent = 'Il backend documentale è attivo. La checklist e gli allegati verranno caricati in area privata; il processo cloud prosegue senza tenere aperto il browser.';
    if (submitButton) submitButton.textContent = 'Carica checklist e avvia agenti';
    queueMessage('Carica la checklist per avviare il primo lavoro', 'Una volta ricevuta la conferma di accodamento, puoi chiudere il browser o spegnere il dispositivo.');
    loadCloudJobs();
  } else {
    loadCloudJobs();
  }

  updateContractorCards();
  });

  contractors.addEventListener('click', (event) => {
    const removeButton = event.target.closest('[data-dg-remove-contractor]');
    if (!removeButton || contractorCardCount() <= 1) return;
    removeButton.closest('.dg-contractor-card')?.remove();
    updateContractorCards();
  });

  checklistInput.addEventListener('change', () => {
    const file = checklistInput.files && checklistInput.files[0];
    checklistFileStatus.textContent = file
      ? 'Checklist selezionata: ' + file.name + ' · ' + (file.size < 1024 * 1024 ? Math.max(1, Math.round(file.size / 1024)) + ' KB' : (file.size / (1024 * 1024)).toFixed(1) + ' MB') + '. In questa versione resta sul dispositivo.'
      : 'Checklist non selezionata: scegli il file compilato per continuare.';
    checklistFileStatus.classList.toggle('is-selected', !!file);
  });

  filesInput.addEventListener('change', () => {
    filesList.replaceChildren();
    const files = Array.from(filesInput.files || []);
    if (!files.length) {
      const empty = document.createElement('li');
      empty.textContent = 'Nessun documento selezionato.';
      filesList.appendChild(empty);
      return;
    }
    files.forEach((file) => {
      const item = document.createElement('li');
      const size = file.size < 1024 * 1024
        ? Math.max(1, Math.round(file.size / 1024)) + ' KB'
        : (file.size / (1024 * 1024)).toFixed(1) + ' MB';
      item.textContent = file.name + ' · ' + size;
      filesList.appendChild(item);
    });
  });

  function readContractors() {
    return Array.from(contractors.querySelectorAll('.dg-contractor-card')).map((card, index) => {
      const get = (field) => card.querySelector('[data-field="' + field + '"]')?.value.trim() || '';
      return {
        index: index + 1,
        company: get('company'),
        scope: get('scope'),
        preposto: { name: get('preposto'), roleOrArea: get('prepostoRole') },
        equipment: get('equipment'),
        ppe: get('ppe')
      };
    });
  }

  function checkedModules() {
    return Array.from(form.querySelectorAll('[name="modules"]:checked')).map((input) => input.value);
  }

  function collectMissing(data) {
    const missing = [];
    if (!data.job.title) missing.push('Titolo esatto del DUVRI da confermare: non inventare il titolo del frontespizio.');
    if (!data.job.documentDate) missing.push('Data da riportare sul DUVRI da confermare esplicitamente.');
    if (!data.client.legalName) missing.push('Ragione sociale del committente da estrarre e/o confermare.');
    if (!data.site.address) missing.push('Sede e indirizzo dell’intervento da estrarre e/o confermare.');
    if (!data.site.context || data.site.context === 'unknown' || data.site.context === 'other') missing.push('Tipo di area (interno, cantiere/esterno o misto) da confermare dopo l’analisi della checklist.');
    if (!data.work.description) missing.push('Descrizione dell’appalto da ricostruire dalla checklist e confermare.');
    if (!data.aiDataProcessingConsent) missing.push('Consenso al trasferimento di checklist e allegati al provider AI da raccogliere prima di attivare l’elaborazione cloud.');
    data.contractors.forEach((company, index) => {
      if (!company.company) missing.push('Impresa ' + (index + 1) + ': ragione sociale da estrarre dalla checklist e confermare.');
      const label = company.company || ('Impresa ' + (index + 1));
      if (!company.preposto.name) missing.push(label + ': nominativo del preposto da acquisire o confermare.');
      if (!company.preposto.roleOrArea) missing.push(label + ': mansione/area di competenza del preposto da specificare.');
      if (!company.equipment) missing.push(label + ': elenco mezzi/macchinari/attrezzature e proprietà da completare.');
      if (!company.ppe) missing.push(label + ': DPI previsti da documentare o confermare.');
      if (!company.scope) missing.push(label + ': descrizione delle attività da dettagliare.');
    });
    const fileNames = [
      ...(data.sourceChecklist ? [data.sourceChecklist.name] : []),
      ...data.documents.map((file) => file.name)
    ].map((name) => name.toLowerCase());
    if (!fileNames.some((name) => name.includes('dvr'))) missing.push('DVR specifico: verificare se disponibile o pertinente e acquisirlo se necessario.');
    if (!fileNames.some((name) => name.includes('cronoprogramma') || name.includes('programma lavori') || name.includes('planning'))) {
      missing.push('Cronoprogramma lavori: verificare disponibilità e acquisirlo se necessario.');
    }
    if (!fileNames.some((name) => name.includes('planimetr') || name.includes('planimetry') || name.includes('layout'))) {
      missing.push('Planimetria/layout dell’area: verificare se necessario e acquisirlo.');
    }
    if (data.modules.includes('confined-space') && !fileNames.some((name) => name.includes('procedura') || name.includes('permesso'))) {
      missing.push('Modulo spazi confinati: verificare procedure e permessi pertinenti prima della valutazione tecnica.');
    }
    return missing;
  }

  function createRecord() {
    const data = new FormData(form);
    const checklist = checklistInput.files && checklistInput.files[0];
    const checklistFile = checklist ? {
      name: checklist.name,
      size: checklist.size,
      mimeType: checklist.type || 'application/octet-stream',
      lastModified: checklist.lastModified,
      contentIncluded: false
    } : null;
    const documents = Array.from(filesInput.files || []).map((file) => ({
      name: file.name,
      size: file.size,
      mimeType: file.type || 'application/octet-stream',
      lastModified: file.lastModified,
      contentIncluded: false
    }));
    return {
      schema: 'colligo-document-intake/0.3',
      documentType: escapeText(data.get('documentType') || 'duvri'),
      recordId: (globalThis.crypto && typeof crypto.randomUUID === 'function')
        ? crypto.randomUUID()
        : 'document-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9),
      createdAt: new Date().toISOString(),
      prototypeStatus: 'local-intake-only',
      cloudSubmission: false,
      aiGenerationStarted: false,
      humanReviewRequired: true,
      workflow: [
        { agent: 'coordinator', label: 'Coordinatore', status: 'not_connected' },
        { agent: 'document-reader', label: 'Analista documentale', status: 'not_connected' },
        { agent: 'duvri-analyst', label: 'Analista interferenze', status: 'not_connected' },
        { agent: 'docx-writer', label: 'Redattore Word', status: 'not_connected' },
        { agent: 'quality-check', label: 'Verificatore', status: 'not_connected' }
      ],
      job: {
        title: escapeText(data.get('title')).trim(),
        documentType: escapeText(data.get('documentType') || 'duvri'),
        documentDate: escapeText(data.get('documentDate')),
        complexity: escapeText(data.get('complexity')),
        startDate: escapeText(data.get('startDate')),
        endDate: escapeText(data.get('endDate'))
      },
      client: { legalName: escapeText(data.get('clientName')).trim() },
      site: {
        address: escapeText(data.get('site')).trim(),
        context: escapeText(data.get('siteType')),
        accessNotes: escapeText(data.get('accessNotes')).trim()
      },
      work: { description: escapeText(data.get('workDescription')).trim() },
      contractors: readContractors(),
      modules: checkedModules(),
      sourceChecklist: checklistFile,
      documents,
      aiDataProcessingConsent: data.get('aiDataProcessingConsent') === 'yes',
      notes: escapeText(data.get('notes')).trim(),
      notices: [
        'Scheda di raccolta dati del prototipo: i documenti selezionati non sono stati caricati e il loro contenuto non è incluso.',
        'Nessun dato è stato inviato a un backend o a un provider AI. Non è stato generato alcun documento.',
        'Le lacune riportate sono promemoria di raccolta, non una valutazione esaustiva di completezza o sicurezza.'
      ]
    };
  }

  function renderMissing(items) {
    missingList.replaceChildren();
    if (!items.length) {
      const item = document.createElement('li');
      item.textContent = 'Nessuna lacuna rilevata dai controlli preliminari di questa schermata. Questo non equivale a una verifica tecnica completa.';
      missingList.appendChild(item);
      return;
    }
    items.forEach((text) => {
      const item = document.createElement('li');
      item.textContent = text;
      missingList.appendChild(item);
    });
  }

  function invalidatePreparedRecord() {
    if (!preparedRecord) return;
    preparedRecord = null;
    resultPanel.hidden = true;
  }

  form.addEventListener('input', invalidatePreparedRecord);
  form.addEventListener('change', invalidatePreparedRecord);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submitting || !form.reportValidity()) return;
    const start = form.elements.startDate.value;
    const end = form.elements.endDate.value;
    if (start && end && end < start) {
      alert('La data di fine lavori non può precedere la data di inizio.');
      form.elements.endDate.focus();
      return;
    }
    preparedRecord = createRecord();
    const missing = collectMissing(preparedRecord);

    if (!cloudEnabled) {
      renderPreparedRecord(preparedRecord, missing, 'local');
      cloudStatus.textContent = 'Backend cloud non attivo: la checklist non viene caricata e nessun agente è stato avviato.';
      return;
    }

    if (!preparedRecord.aiDataProcessingConsent) {
      cloudStatus.textContent = 'Prima di inviare i file al provider AI devi confermare il consenso al trattamento cloud.';
      const consent = form.querySelector('[name="aiDataProcessingConsent"]');
      consent?.focus();
      renderPreparedRecord(preparedRecord, missing, 'local');
      return;
    }

    const checklist = checklistInput.files && checklistInput.files[0];
    if (!checklist) {
      cloudStatus.textContent = 'Seleziona la checklist compilata prima di avviare il lavoro.';
      checklistInput.focus();
      return;
    }

    const upload = new FormData();
    upload.append('metadata', JSON.stringify({
      ...preparedRecord,
      title: preparedRecord.job.title,
      documentType: preparedRecord.documentType,
      siteType: preparedRecord.site.context,
      complexity: preparedRecord.job.complexity,
      aiDataProcessingConsent: preparedRecord.aiDataProcessingConsent
    }));
    upload.append('checklist', checklist, checklist.name);
    Array.from(filesInput.files || []).forEach((file) => upload.append('files', file, file.name));

    submitting = true;
    submitButton.disabled = true;
    submitButton.textContent = 'Caricamento e accodamento…';
    cloudStatus.textContent = 'Caricamento privato della checklist e degli allegati…';
    try {
      const created = await requestJobs('create', { method: 'POST', body: upload });
      currentJobId = created.job?.id || null;
      if (currentJobId) {
        preparedRecord.cloudSubmission = true;
        preparedRecord.aiGenerationStarted = false;
        preparedRecord.recordId = currentJobId;
        preparedRecord.serverJob = created.job;
      }
      const message = created.message || 'Lavoro salvato nel cloud.';
      resultTitle.textContent = 'Lavoro documentale salvato';
      resultSummary.textContent = (created.job?.documentTypeName || created.job?.documentType || preparedRecord.documentType) +
        ' · ID ' + (currentJobId || 'non disponibile') + ' · stato: ' + statusLabel(created.job?.status || 'queued');
      renderMissing(missing);
      resultPanel.hidden = false;
      resultPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
      cloudStatus.textContent = message;
      await loadCloudJobs();
    } catch (error) {
      cloudStatus.textContent = error.message || 'Non è stato possibile accodare il lavoro. Verifica la connessione e riprova.';
    } finally {
      submitting = false;
      submitButton.disabled = false;
      submitButton.textContent = 'Carica checklist e avvia agenti';
    }
  });

  downloadButton.addEventListener('click', () => {
    if (!preparedRecord) return;
    const blob = new Blob([JSON.stringify(preparedRecord, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const safeName = (preparedRecord.job.title || 'nuovo-duvri')
      .normalize('NFKD').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'nuovo-duvri';
    link.download = 'scheda-documento-' + safeName + '.json';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  resetButton.addEventListener('click', () => {
    if (!confirm('Vuoi azzerare i dati inseriti in questa scheda? Le informazioni non saranno recuperabili.')) return;
    form.reset();
    checklistFileStatus.textContent = 'Checklist non selezionata: scegli il file compilato per continuare.';
    checklistFileStatus.classList.remove('is-selected');
    const cards = Array.from(contractors.querySelectorAll('.dg-contractor-card'));
    cards.slice(1).forEach((card) => card.remove());
    filesList.replaceChildren();
    const empty = document.createElement('li');
    empty.textContent = 'Nessun documento selezionato.';
    filesList.appendChild(empty);
    resultPanel.hidden = true;
    preparedRecord = null;
    updateContractorCards();
    screen.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  updateContractorCards();
})();
