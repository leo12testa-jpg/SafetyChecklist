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
  let preparedRecord = null;

  function escapeText(value) {
    return String(value == null ? '' : value);
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

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const start = form.elements.startDate.value;
    const end = form.elements.endDate.value;
    if (start && end && end < start) {
      alert('La data di fine lavori non può precedere la data di inizio.');
      form.elements.endDate.focus();
      return;
    }
    preparedRecord = createRecord();
    const missing = collectMissing(preparedRecord);
    resultTitle.textContent = 'Scheda dati pronta per il test';
    const selectedType = form.elements.documentType.selectedOptions[0]?.textContent || 'Documento';
    resultSummary.textContent = selectedType + ' · ' + (preparedRecord.sourceChecklist ? preparedRecord.sourceChecklist.name : 'Checklist non selezionata') + ' · '
      preparedRecord.contractors.length + (preparedRecord.contractors.length === 1 ? ' scheda impresa' : ' schede impresa') + ' · ' +
      preparedRecord.documents.length + (preparedRecord.documents.length === 1 ? ' allegato di supporto' : ' allegati di supporto') +
      ' · ' + missing.length + (missing.length === 1 ? ' verifica da completare' : ' verifiche da completare');
    renderMissing(missing);
    resultPanel.hidden = false;
    resultPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  downloadButton.addEventListener('click', () => {
    if (!preparedRecord) return;
    const blob = new Blob([JSON.stringify(preparedRecord, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const safeName = (preparedRecord.job.title || 'nuovo-duvri')
      .normalize('NFKD').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'nuovo-duvri';
    link.download = 'scheda-duvri-' + safeName + '.json';
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
