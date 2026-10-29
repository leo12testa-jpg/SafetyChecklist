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
  const attachmentInputs = Array.from(screen.querySelectorAll('[data-dg-attachment-category]'));
  const filesList = document.getElementById('dg-files-list');
  const resultPanel = document.getElementById('dg-result');
  const resultTitle = document.getElementById('dg-result-title');
  const resultSummary = document.getElementById('dg-result-summary');
  const missingList = document.getElementById('dg-missing-list');
  const downloadButton = document.getElementById('dg-download-json');
  const downloadPackageButton = document.getElementById('dg-download-package');
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
              ? 'circa USD ' + totalCost.toFixed(4) + ' di credito stimato'
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
    resultSummary.textContent = selectedType + ' · ' + (record.sourceChecklist ? record.sourceChecklist.name : 'Questionario compilato in questa pagina') + ' · ' +
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
    updateContractorCards();
  });

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
  }
  loadCloudJobs();

  contractors.addEventListener('click', (event) => {
    const removeButton = event.target.closest('[data-dg-remove-contractor]');
    if (!removeButton || contractorCardCount() <= 1) return;
    removeButton.closest('.dg-contractor-card')?.remove();
    updateContractorCards();
  });

  checklistInput.addEventListener('change', () => {
    const file = checklistInput.files && checklistInput.files[0];
    checklistFileStatus.textContent = file
      ? 'File aggiunto come fonte: ' + file.name + ' · ' + (file.size < 1024 * 1024 ? Math.max(1, Math.round(file.size / 1024)) + ' KB' : (file.size / (1024 * 1024)).toFixed(1) + ' MB') + '. Sarà incluso nel pacchetto ZIP.'
      : 'Nessun file preesistente selezionato: puoi compilare tutto da zero.';
    checklistFileStatus.classList.toggle('is-selected', !!file);
    invalidatePreparedRecord();
  });

  const ATTACHMENT_CATEGORY_LABELS = {
    'contratto-capitolato': 'Contratto / capitolato',
    'dvr-specifico': 'DVR specifico',
    'cronoprogrammi': 'Cronoprogramma',
    'planimetrie-layout': 'Planimetrie e layout',
    'mezzi-attrezzature': 'Macchinari e attrezzature',
    'procedure-operative': 'Procedure operative',
    'emergenze': 'Emergenze',
    'sds': 'SDS e prodotti chimici',
    'permessi': 'Permessi',
    'foto-sito': 'Foto del sito',
    'altri-allegati': 'Altri allegati'
  };

  function readSelectedAttachments() {
    return attachmentInputs.flatMap((input) =>
      Array.from(input.files || []).map((file) => ({
        file,
        category: input.dataset.dgAttachmentCategory || 'altri-allegati'
      }))
    );
  }

  function renderSelectedAttachments() {
    filesList.replaceChildren();
    const selected = readSelectedAttachments();
    if (!selected.length) {
      const empty = document.createElement('li');
      empty.textContent = 'Nessun allegato selezionato.';
      filesList.appendChild(empty);
      invalidatePreparedRecord();
      return;
    }
    selected.forEach(({ file, category }) => {
      const item = document.createElement('li');
      const size = file.size < 1024 * 1024
        ? Math.max(1, Math.round(file.size / 1024)) + ' KB'
        : (file.size / (1024 * 1024)).toFixed(1) + ' MB';
      item.textContent = (ATTACHMENT_CATEGORY_LABELS[category] || category) + ': ' + file.name + ' · ' + size;
      filesList.appendChild(item);
    });
    invalidatePreparedRecord();
  }

  attachmentInputs.forEach((input) => input.addEventListener('change', renderSelectedAttachments));

  function readContractors() {
    return Array.from(contractors.querySelectorAll('.dg-contractor-card')).map((card, index) => {
      const get = (field) => card.querySelector('[data-field="' + field + '"]')?.value.trim() || '';
      const workerCount = get('workerCount');
      return {
        index: index + 1,
        company: get('company'),
        role: get('role') || 'contractor',
        parentCompany: get('parentCompany'),
        vatOrTaxId: get('vatOrTaxId'),
        contactName: get('contactName'),
        contactPhone: get('contactPhone'),
        contactEmail: get('contactEmail'),
        workerCount: workerCount === '' ? null : Number(workerCount),
        scope: get('scope'),
        preposto: {
          name: get('preposto'),
          roleOrArea: get('prepostoRole'),
          status: get('prepostoStatus') || 'to_be_confirmed'
        },
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
    if (!data.client.legalName) missing.push('Ragione sociale del committente da acquisire o confermare.');
    if (!data.client.vatOrTaxId) missing.push('Partita IVA / codice fiscale del committente da acquisire o verificare.');
    if (!data.client.registeredAddress) missing.push('Sede legale del committente da acquisire o verificare.');
    if (!data.client.contactName || (!data.client.contactPhone && !data.client.contactEmail)) missing.push('Referente del committente e almeno un recapito da acquisire.');
    if (!data.client.siteContactName || !data.client.siteContactPhone) missing.push('Referente del sito e recapito da acquisire o confermare.');
    if (!data.site.address) missing.push('Sede e indirizzo dell’intervento da acquisire o confermare.');
    if (!data.site.context || data.site.context === 'unknown' || data.site.context === 'other') missing.push('Tipo di area (interno, cantiere/esterno o misto) da confermare.');
    if (!data.site.areaDescription) missing.push('Area di intervento e perimetro operativo da descrivere.');
    if (!data.site.accessNotes || !data.site.vehicleRoutes) missing.push('Accessi e percorsi pedonali/veicolari da descrivere o indicare come non applicabili.');
    if (!data.site.materialStorageAreas) missing.push('Aree di deposito e carico/scarico da indicare o confermare come non previste.');
    if (!data.site.workDaysHours) missing.push('Giorni, orari e durata delle attività da acquisire.');
    if (!data.site.systems || !data.site.restrictions) missing.push('Impianti presenti e vincoli del sito da descrivere o dichiarare non applicabili.');
    if (!data.work.description) missing.push('Descrizione dell’appalto da completare con attività, fasi e risultati previsti.');
    if (!data.work.workSchedule) missing.push('Cronoprogramma/fasi, date, orari e durata: completare qui o allegare un documento.');
    if (!data.work.overlappingActivities) missing.push('Descrivere le attività simultanee del committente o di altre imprese, oppure confermare che non sono previste.');
    if (!data.work.areaSegregation) missing.push('Delimitazioni e separazione delle aree da descrivere o indicare come non necessarie.');
    if (!data.work.systemInterruptions) missing.push('Interruzioni/isolamenti degli impianti da descrivere o confermare come non previsti.');
    if (!data.work.deliveriesAndTraffic) missing.push('Carico/scarico e gestione dei transiti da descrivere o confermare come non applicabili.');
    if (!data.work.coordinationNotes) missing.push('Modalità di coordinamento tra committente, appaltatori e subappaltatori da indicare.');
    if (data.site.otherWorkersPresence === 'unknown') missing.push('Confermare la presenza di lavoratori del committente o di altre imprese.');
    if (data.site.publicPresence === 'unknown') missing.push('Confermare la presenza di clienti, utenti o pubblico.');
    if (data.coordination.emergencyRoutesAffected === 'unknown') missing.push('Verificare se i lavori interferiscono con vie di esodo, allarmi o impianti antincendio.');

    data.contractors.forEach((company, index) => {
      const label = company.company || ('Impresa ' + (index + 1));
      if (!company.company) missing.push('Impresa ' + (index + 1) + ': ragione sociale da inserire.');
      if (company.role === 'subcontractor' && !company.parentCompany) missing.push(label + ': indicare l’impresa appaltatrice di riferimento.');
      if (!company.contactName || (!company.contactPhone && !company.contactEmail)) missing.push(label + ': referente e recapito da acquisire.');
      if (company.workerCount === null) missing.push(label + ': numero di addetti da indicare o confermare.');
      if (!company.scope) missing.push(label + ': descrivere le attività e le fasi eseguite.');
      if (!company.preposto.name || company.preposto.status !== 'confirmed') missing.push(label + ': acquisire/confermare espressamente nominativo e ruolo del preposto.');
      if (!company.equipment) missing.push(label + ': indicare mezzi/macchinari/attrezzature, azienda utilizzatrice e proprietario.');
      if (!company.ppe) missing.push(label + ': indicare i DPI previsti sulla base dei documenti dell’impresa.');
    });

    const docChecks = [
      ['contratto-capitolato', 'Contratto / capitolato', 'contratto-capitolato'],
      ['dvr-specifico', 'DVR specifico dell’intervento', 'dvr-specifico'],
      ['cronoprogrammi', 'Cronoprogramma', 'cronoprogrammi'],
      ['planimetrie-layout', 'Planimetria / layout', 'planimetrie-layout'],
      ['mezzi-attrezzature', 'Documenti di macchinari e attrezzature', 'mezzi-attrezzature'],
      ['procedure-operative', 'Procedure operative', 'procedure-operative'],
      ['emergenze', 'Piano o istruzioni di emergenza', 'emergenze'],
      ['sds', 'SDS / documenti dei prodotti chimici', 'sds'],
      ['permessi', 'Permessi e autorizzazioni', 'permessi'],
      ['foto-sito', 'Foto del sito', 'foto-sito']
    ];
    const availability = data.documentAvailability || {};
    docChecks.forEach(([key, label, category]) => {
      const status = availability[key] || 'to_verify';
      const supplied = data.documents.some((file) => file.category === category);
      if (status === 'to_acquire') missing.push(label + ': segnato come “da acquisire”.');
      else if (status === 'to_verify') missing.push(label + ': stato da verificare.');
      else if (status === 'available' && !supplied) missing.push(label + ': indicato come disponibile ma nessun file è stato selezionato nella relativa categoria.');
    });

    if (data.roofAccess.roofWork === 'yes') {
      if (!data.roofAccess.accessMethod) missing.push('Lavori in quota: descrivere la modalità di accesso alla copertura.');
      if (!data.roofAccess.landingPoint) missing.push('Lavori in quota: indicare il punto/modalità di sbarco sulla copertura.');
      if (!data.roofAccess.protections) missing.push('Lavori in quota: indicare le protezioni collettive/ancoraggi effettivamente presenti o da verificare.');
      if (!data.roofAccess.rescuePlan) missing.push('Lavori in quota: verificare e descrivere l’organizzazione di emergenza/recupero.');
    } else if (data.roofAccess.roofWork === 'unknown') {
      missing.push('Confermare se sono previsti lavori in quota o accessi alla copertura.');
    }
    if (!data.coordination.assemblyPoint) missing.push('Punto di raccolta e istruzioni di emergenza del sito: indicare o acquisire.');
    if (!data.coordination.emergencyContacts) missing.push('Contatti e modalità di attivazione dell’emergenza: acquisire o confermare.');
    if (data.modules.includes('confined-space') &&
        (!['procedure-operative', 'permessi'].some((category) => data.documents.some((file) => file.category === category)) ||
         !['procedure-operative', 'permessi'].some((key) => ['available', 'not_applicable'].includes(data.documentAvailability[key])))) {
      missing.push('Modulo spazi confinati: verificare disponibilità e contenuto di procedure e permessi pertinenti prima della valutazione tecnica.');
    }
    return missing;
  }

  function createRecord() {
    const data = new FormData(form);
    const value = (name) => String(data.get(name) || '').trim();
    const checklist = checklistInput.files && checklistInput.files[0];
    const checklistFile = checklist ? {
      name: checklist.name,
      size: checklist.size,
      mimeType: checklist.type || 'application/octet-stream',
      lastModified: checklist.lastModified,
      contentIncluded: false,
      includedInLocalPackage: true
    } : null;
    const documents = readSelectedAttachments().map(({ file, category }) => ({
      name: file.name,
      category,
      size: file.size,
      mimeType: file.type || 'application/octet-stream',
      lastModified: file.lastModified,
      contentIncluded: false,
      includedInLocalPackage: true
    }));
    const documentAvailability = Object.fromEntries(
      Array.from(form.querySelectorAll('[data-dg-status-category]')).map((field) => [
        field.dataset.dgStatusCategory,
        value(field.name) || 'to_verify'
      ])
    );
    return {
      schema: 'colligo-duvri-client-intake/0.1',
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
        title: value('title'),
        documentType: escapeText(data.get('documentType') || 'duvri'),
        documentDate: value('documentDate'),
        complexity: value('complexity'),
        startDate: value('startDate'),
        endDate: value('endDate')
      },
      client: {
        legalName: value('clientName'),
        vatOrTaxId: value('clientVat'),
        registeredAddress: value('clientAddress'),
        contactName: value('clientContactName'),
        contactPhone: value('clientContactPhone'),
        contactEmail: value('clientContactEmail'),
        siteContactName: value('siteContactName'),
        siteContactPhone: value('siteContactPhone')
      },
      site: {
        address: value('site'),
        context: value('siteType'),
        accessNotes: value('accessNotes'),
        areaDescription: value('areaDescription'),
        vehicleRoutes: value('vehicleRoutes'),
        materialStorageAreas: value('materialStorageAreas'),
        workDaysHours: value('workDaysHours'),
        otherWorkersPresence: value('otherWorkersPresence') || 'unknown',
        publicPresence: value('publicPresence') || 'unknown',
        systems: value('siteSystems'),
        restrictions: value('siteRestrictions')
      },
      work: {
        description: value('workDescription'),
        workSchedule: value('workSchedule'),
        overlappingActivities: value('overlappingActivities'),
        areaSegregation: value('workAreaSegregation'),
        systemInterruptions: value('systemInterruptions'),
        deliveriesAndTraffic: value('deliveriesAndTraffic'),
        coordinationNotes: value('coordinationNotes')
      },
      contractors: readContractors(),
      modules: checkedModules(),
      roofAccess: {
        roofWork: value('roofWork') || 'unknown',
        accessMethod: value('roofAccessMethod'),
        landingPoint: value('roofLandingPoint'),
        protections: value('roofProtections'),
        lowerArea: value('roofLowerArea'),
        rescuePlan: value('roofRescuePlan')
      },
      coordination: {
        assemblyPoint: value('assemblyPoint'),
        emergencyContacts: value('emergencyContacts'),
        emergencyPlanStatus: value('emergencyPlanStatus') || 'unknown',
        emergencyRoutesAffected: value('emergencyRoutesAffected') || 'unknown',
        requiredPermits: value('requiredPermits')
      },
      sourceChecklist: checklistFile,
      documents,
      documentAvailability,
      aiDataProcessingConsent: false,
      notes: value('notes'),
      notices: [
        'Il JSON contiene i dati e i metadati dei file, non il contenuto binario degli allegati.',
        'Il pacchetto ZIP include in cartelle distinte la scheda JSON e i file selezionati sul dispositivo.',
        'Nessun dato o file viene inviato a un backend o a un provider AI in questa versione. Non viene generato alcun documento.',
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
    preparedRecord.missingInformation = missing;

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

    const suppliedChecklist = checklistInput.files && checklistInput.files[0];
    const checklist = suppliedChecklist || new File(
      [JSON.stringify(preparedRecord, null, 2)],
      'scheda-duvri-compilata.json',
      { type: 'application/json' }
    );

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
    readSelectedAttachments().forEach(({ file }) => upload.append('files', file, file.name));

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
      submitButton.textContent = 'Prepara checklist compilata →';
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

  function safeArchiveName(name) {
    let leaf = String(name || '').split(/[\\/]/).pop();
    leaf = leaf.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
    leaf = leaf.replace(/[<>:"/\\|?*\x00-\x1f]+/g, '_').replace(/[^a-zA-Z0-9._() -]+/g, '_');
    leaf = leaf.replace(/^\.+/, '').replace(/[. ]+$/g, '').trim().slice(0, 120);
    if (!leaf || /^\.+$/.test(leaf)) leaf = 'allegato';
    const stem = leaf.split('.')[0].toUpperCase();
    if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/.test(stem)) leaf = '_' + leaf;
    return leaf;
  }

  downloadPackageButton.addEventListener('click', async () => {
    if (!preparedRecord) return;
    if (typeof JSZip === 'undefined') {
      cloudStatus.textContent = 'Non è disponibile la libreria ZIP. Esporta il JSON e riprova dopo aver ricaricato l’app.';
      return;
    }
    downloadPackageButton.disabled = true;
    const oldLabel = downloadPackageButton.textContent;
    downloadPackageButton.textContent = 'Preparazione ZIP…';
    cloudStatus.textContent = 'Preparazione locale del pacchetto: scheda, documenti e foto selezionati.';
    try {
      const zip = new JSZip();
      zip.file('scheda-duvri.json', JSON.stringify(preparedRecord, null, 2));
      zip.file('ISTRUZIONI.txt',
        'Pacchetto di raccolta dati DUVRI per Colligo.\n' +
        'Contiene le risposte del questionario in scheda-duvri.json e gli allegati nelle cartelle sotto allegati/.\n' +
        'Questo pacchetto non è un DUVRI e non equivale a una validazione tecnica.\n' +
        'Verificare dati, file, preposti, cronoprogramma e planimetrie prima dell’invio.\n' +
        'I file sono stati raggruppati localmente dal browser; non sono stati inviati automaticamente al cloud o a un provider AI.'
      );
      const suppliedChecklist = checklistInput.files && checklistInput.files[0];
      if (suppliedChecklist) {
        zip.file(
          'allegati/checklist-preesistente/' + safeArchiveName(suppliedChecklist.name),
          await suppliedChecklist.arrayBuffer()
        );
      }
      const selectedAttachments = readSelectedAttachments();
      for (const [index, { file, category }] of selectedAttachments.entries()) {
        const safeCategory = String(category || 'altri-allegati').replace(/[^a-zA-Z0-9_-]+/g, '-');
        const serial = String(index + 1).padStart(3, '0');
        zip.file(
          'allegati/' + safeCategory + '/' + serial + '-' + safeArchiveName(file.name),
          await file.arrayBuffer()
        );
      }
      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const safeTitle = (preparedRecord.job.title || 'nuovo-duvri')
        .normalize('NFKD').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'nuovo-duvri';
      link.download = 'pacchetto-duvri-' + safeTitle + '.zip';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      cloudStatus.textContent = 'Pacchetto ZIP preparato e scaricato sul dispositivo. Non è stato inviato online.';
    } catch (error) {
      cloudStatus.textContent = 'Impossibile preparare il pacchetto ZIP: ' + (error.message || 'errore inatteso.');
    } finally {
      downloadPackageButton.disabled = false;
      downloadPackageButton.textContent = oldLabel;
    }
  });

  resetButton.addEventListener('click', () => {
    if (!confirm('Vuoi azzerare i dati inseriti in questa scheda? Le informazioni non saranno recuperabili.')) return;
    form.reset();
    checklistFileStatus.textContent = 'Nessun file preesistente selezionato: puoi compilare tutto da zero.';
    checklistFileStatus.classList.remove('is-selected');
    const cards = Array.from(contractors.querySelectorAll('.dg-contractor-card'));
    cards.slice(1).forEach((card) => card.remove());
    renderSelectedAttachments();
    resultPanel.hidden = true;
    preparedRecord = null;
    updateContractorCards();
    screen.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  updateContractorCards();
})();
