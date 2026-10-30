/* Caricamento dei file del committente in "Generazione documenti": due aree, la checklist del
   committente e la documentazione del cliente. Elaborazione solo locale (js/document-intake.js):
   nessun invio in rete o ad AI. I testi estratti sono mostrati esclusivamente con textContent. */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const input = $('dg-auto-files');
  if (!input || typeof documentIntake === 'undefined') return;

  const screen = input.closest('[data-screen="document-generation"]');
  const typeSelect = $('dg-auto-type');
  const status = $('dg-auto-status');
  const dropZone = $('dg-auto-drop');
  const results = $('dg-auto-results');
  const filesList = $('dg-auto-files-list');
  const fieldsList = $('dg-auto-fields');
  const issuesList = $('dg-auto-issues');
  const downloadButton = $('dg-auto-download');
  const clearButton = $('dg-auto-clear');
  const checklistInput = $('dg-checklist-file');
  const checklistStatus = $('dg-checklist-file-status');
  const checklistRemove = $('dg-checklist-remove');
  const templateInput = $('dg-template-file');
  const templateStatus = $('dg-template-status');
  const generateState = $('dg-generate-state');
  const reasonsList = $('dg-generate-reasons');

  const READ_STATUS = { letto: 'letto', immagine: 'immagine, contenuto non letto', non_supportato: 'formato non leggibile', non_letto: 'non letto', errore: 'errore di lettura' };
  const CONFIDENCE = { alta: 'classificazione sicura', media: 'classificazione probabile', bassa: 'classificazione incerta', manuale: 'categoria corretta manualmente' };
  const CHECKLIST_CATEGORY = 'checklist-committente';
  const CHECKLIST_EMPTY = 'Nessuna checklist caricata: puoi compilare tutto da zero.';
  let entries = [];       // documentazione del cliente: { file, result }
  let checklist = null;   // checklist del committente: { file, result }, mai mescolata alla documentazione
  let analysis = null;
  let templateReport = null;
  let serial = 0;
  let queue = Promise.resolve();
  // Svuota, Azzera e una nuova checklist incrementano la generazione: le letture avviate prima
  // scartano il proprio risultato invece di reinserire file già tolti dall'utente.
  let docsGeneration = 0;
  let checklistGeneration = 0;
  let docsBatches = 0;
  let checklistReads = 0;
  let packaging = false;

  const deps = () => ({ JSZip: globalThis.JSZip, pdfjsLib: globalThis.pdfjsLib, crypto: globalThis.crypto });
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };
  const sourceLabel = (s) => s.file + (s.location ? ' — ' + s.location : '');
  const formatSize = (bytes) => bytes < 1024 * 1024
    ? Math.max(1, Math.round(bytes / 1024)) + ' KB'
    : (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  const extensionLabel = (name) => ((/\.([a-z0-9]+)$/i.exec(name) || [])[1] || 'senza estensione').toUpperCase();
  const readLabel = (file) => /\.zip$/i.test(file.name) && file.readStatus === 'non_supportato'
    ? 'archivio ZIP non estratto: non letto – da revisionare'
    : READ_STATUS[file.readStatus] || file.readStatus;
  const allResults = () => (checklist ? [checklist.result] : []).concat(entries.map((e) => e.result));
  const reading = () => docsBatches > 0 || checklistReads > 0;

  async function analyze(file) {
    serial += 1;
    const id = 'file-' + serial;
    try {
      const tooLarge = file.size > documentIntake.MAX_FILE_BYTES;
      const bytes = await (tooLarge ? file.slice(0, 8) : file).arrayBuffer();
      return await documentIntake.analyzeFile({ id, name: file.name, bytes, size: file.size }, deps());
    } catch (error) {
      // Nessun file viene scartato in silenzio: resta in elenco con la segnalazione.
      const message = file.name + ': lettura non riuscita (' + (error && error.message ? error.message : 'errore') + '); verificare manualmente.';
      return {
        file: { id, name: file.name, size: file.size, sha256: null, format: 'unsupported', readStatus: 'errore', category: 'altri-allegati', categoryLabel: documentIntake.CATEGORIES['altri-allegati'], confidence: 'bassa', classificationEvidence: [], textUnits: 0 },
        facts: [],
        issues: [{ type: 'anomaly', message, sources: [{ fileId: id, file: file.name }] }]
      };
    }
  }

  function setCategory(entry, category) {
    const file = entry.result.file;
    file.category = category;
    file.categoryLabel = documentIntake.CATEGORIES[category];
    file.categoryCorrected = category !== file.autoCategory;
    file.confidence = file.categoryCorrected ? 'manuale' : file.autoConfidence;
  }

  // Solo le righe mai modificate dall'utente seguono i documenti classificati.
  function syncStatuses() {
    const present = new Set(entries.map((e) => e.result.file.category));
    screen.querySelectorAll('[data-dg-status-category]').forEach((select) => {
      if (select.dataset.dgUserChoice === 'true') return;
      const has = present.has(select.dataset.dgStatusCategory);
      if (has && select.value === 'to_verify') {
        select.value = 'available';
        select.dataset.dgAutoAvailable = 'true';
      } else if (!has && select.dataset.dgAutoAvailable === 'true') {
        select.value = 'to_verify';
        delete select.dataset.dgAutoAvailable;
      }
    });
  }

  function resetStatusChoices() {
    screen.querySelectorAll('[data-dg-status-category]').forEach((select) => {
      delete select.dataset.dgUserChoice;
      delete select.dataset.dgAutoAvailable;
    });
  }

  // Durante letture o preparazione dello ZIP nessun pacchetto può partire: sarebbe parziale.
  function notify() {
    const locked = reading() || packaging;
    downloadButton.disabled = locked;
    screen.dispatchEvent(new CustomEvent('dg-intake-change', { detail: { busy: locked } }));
  }

  function renderGate() {
    const gate = documentIntake.generationGate(typeSelect.value, templateReport, analysis);
    generateState.textContent = gate.allowed ? 'pronta per la revisione' : 'bloccata';
    reasonsList.replaceChildren(...gate.reasons.map((reason) => el('li', null, reason)));
  }

  function fileIssues(file) {
    if (!analysis) return [];
    return analysis.issues.filter((issue) => issue.type !== 'missing' && issue.sources && issue.sources.some((s) => s.fileId === file.id));
  }

  function renderChecklist() {
    checklistRemove.hidden = !checklist;
    checklistStatus.classList.toggle('is-selected', !!checklist);
    if (!checklist) { checklistStatus.textContent = CHECKLIST_EMPTY; return; }
    const file = checklist.result.file;
    const count = fileIssues(file).length;
    checklistStatus.textContent = file.name + ' · ' + formatSize(file.size) + ' · formato ' + extensionLabel(file.name) + ' · ' + readLabel(file) +
      (count ? ' · ' + count + (count === 1 ? ' segnalazione' : ' segnalazioni') + ' (vedi sotto)' : '') + '. Identificata come checklist del committente, separata dalla documentazione.';
  }

  function renderFiles() {
    filesList.replaceChildren(...entries.map((entry) => {
      const file = entry.result.file;
      const item = el('li', 'dg-auto-file');
      item.dataset.fileId = file.id;
      item.append(el('strong', null, file.name));
      item.append(el('small', 'dg-doc-meta', file.categoryLabel + ' · ' + CONFIDENCE[file.confidence] + ' · ' + readLabel(file) + ' · ' + formatSize(file.size)));
      const issues = fileIssues(file);
      if (issues.length) {
        const list = el('ul', 'dg-doc-issues');
        list.append(...issues.map((issue) => el('li', null, issue.message)));
        item.append(list);
      }
      const actions = el('div', 'dg-doc-actions');
      const label = el('label', 'dg-doc-category', 'Categoria ');
      const select = el('select');
      select.dataset.fileId = file.id;
      select.setAttribute('aria-label', 'Categoria di ' + file.name);
      select.append(...Object.entries(documentIntake.CATEGORIES).map(([value, text]) => {
        const option = el('option', null, text);
        option.value = value;
        option.selected = value === file.category;
        return option;
      }));
      label.append(select);
      const remove = el('button', 'btn dg-doc-remove', 'Rimuovi');
      remove.type = 'button';
      remove.dataset.removeFile = file.id;
      remove.setAttribute('aria-label', 'Rimuovi ' + file.name + ' dall’elenco');
      actions.append(label, remove);
      item.append(actions);
      return item;
    }));
  }

  function render() {
    const active = document.activeElement;
    const activeRow = active && active.closest ? active.closest('li[data-file-id]') : null;
    const all = allResults();
    analysis = all.length ? documentIntake.consolidate(typeSelect.value, all) : null;
    results.hidden = !analysis;
    if (analysis) {
      issuesList.replaceChildren(...(analysis.issues.length ? analysis.issues.map((issue) => {
        const item = el('li', 'dg-auto-issue is-' + issue.type, issue.message);
        if (issue.sources && issue.sources.some((s) => s.location)) item.append(el('small', null, 'Fonti: ' + issue.sources.map(sourceLabel).join('; ')));
        return item;
      }) : [el('li', 'dg-auto-issue is-ok', 'Nessuna anomalia, conflitto o dato indispensabile mancante.')]));
      const fields = Object.values(analysis.fields);
      fieldsList.replaceChildren(...(fields.length ? fields.map((field) => {
        const item = el('li', 'dg-auto-field' + (field.status === 'conflicting' ? ' is-conflict' : ''));
        item.append(el('strong', null, field.label));
        for (const value of field.values) {
          const row = el('div', 'dg-auto-value', value.value);
          row.append(el('small', null, 'Fonte: ' + value.sources.map(sourceLabel).join('; ')));
          item.append(row);
        }
        return item;
      }) : [el('li', null, 'Nessun dato etichettato trovato nei file.')]));
    }
    renderFiles();
    if (activeRow) focusRow(activeRow.dataset.fileId, active.dataset.removeFile ? '[data-remove-file]' : 'select');
    renderChecklist();
    syncStatuses();
    renderGate();
    notify();
  }

  // Ogni file letto entra subito in elenco e nell'analisi: ciò che si vede è ciò che verrà impacchettato.
  async function addDocuments(picked, generation) {
    try {
      for (const [index, file] of picked.entries()) {
        if (generation !== docsGeneration) return;
        status.textContent = 'Lettura ' + (index + 1) + ' di ' + picked.length + ': ' + file.name;
        const result = await analyze(file);
        if (generation !== docsGeneration) return;
        Object.assign(result.file, { role: 'documentazione', autoCategory: result.file.category, autoConfidence: result.file.confidence });
        entries.push({ file, result });
        render();
      }
      status.textContent = entries.length + ' file analizzati sul dispositivo. Nessun file è stato inviato.';
    } catch (error) {
      status.textContent = 'Analisi interrotta: ' + (error && error.message ? error.message : 'errore inatteso') + '. I file già letti restano nell’elenco.';
    } finally {
      docsBatches -= 1;
      notify();
    }
  }

  // Le selezioni successive (anche durante una lettura) vengono accodate, mai perse.
  function enqueue(files) {
    if (!files.length) return queue;
    const generation = docsGeneration;
    docsBatches += 1;
    notify();
    queue = queue.catch(() => {}).then(() => addDocuments(files, generation));
    return queue;
  }

  function clearDocuments() {
    docsGeneration += 1;
    entries = [];
    status.textContent = 'Nessun file caricato.';
  }

  function focusRow(fileId, selector) {
    const row = filesList.querySelector('[data-file-id="' + fileId + '"]');
    const target = row && row.querySelector(selector);
    if (target) target.focus();
  }

  input.addEventListener('change', () => {
    const picked = Array.from(input.files || []);
    input.value = '';
    return enqueue(picked);
  });

  for (const type of ['dragenter', 'dragover']) {
    dropZone.addEventListener(type, (event) => { event.preventDefault(); dropZone.classList.add('is-dragover'); });
  }
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('is-dragover'));
  dropZone.addEventListener('drop', (event) => {
    event.preventDefault();
    dropZone.classList.remove('is-dragover');
    return enqueue(Array.from((event.dataTransfer && event.dataTransfer.files) || []));
  });

  // Un file rilasciato fuori dall'area verrebbe aperto dal browser, facendo perdere il lavoro.
  const carriesFiles = (event) => Boolean(event.dataTransfer && Array.from(event.dataTransfer.types || []).includes('Files'));
  const outsideDropZone = (event) => !(event.target && event.target.closest && event.target.closest('#dg-auto-drop, input[type="file"]'));
  document.addEventListener('dragover', (event) => {
    if (!carriesFiles(event) || !outsideDropZone(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'none';
  });
  document.addEventListener('drop', (event) => {
    if (!carriesFiles(event) || !outsideDropZone(event)) return;
    event.preventDefault();
    if (!screen.hidden) status.textContent = 'File non caricati: rilasciali nell’area «Documentazione del cliente».';
  });

  filesList.addEventListener('change', (event) => {
    const id = event.target.dataset && event.target.dataset.fileId;
    const entry = id && entries.find((e) => e.result.file.id === id);
    if (!entry) return;
    setCategory(entry, event.target.value);
    render();
    focusRow(id, 'select');
  });

  filesList.addEventListener('click', (event) => {
    const button = event.target.closest('[data-remove-file]');
    if (!button) return;
    const index = entries.findIndex((e) => e.result.file.id === button.dataset.removeFile);
    if (index < 0) return;
    const [removed] = entries.splice(index, 1);
    status.textContent = removed.file.name + ' rimosso dall’elenco: il file originale non è stato cancellato. ' + entries.length + ' file in elenco.';
    render();
    const next = entries[index] || entries[index - 1];
    if (next) focusRow(next.result.file.id, '[data-remove-file]');
    else input.focus();
  });

  screen.addEventListener('change', (event) => {
    if (!event.target.dataset || !event.target.dataset.dgStatusCategory) return;
    event.target.dataset.dgUserChoice = 'true';
    delete event.target.dataset.dgAutoAvailable;
  });

  checklistInput.addEventListener('change', async () => {
    const file = checklistInput.files && checklistInput.files[0];
    checklistInput.value = '';
    if (!file) return;
    checklistGeneration += 1;
    const generation = checklistGeneration;
    const previous = checklist;
    checklistReads += 1;
    notify();
    checklistStatus.textContent = 'Lettura della checklist: ' + file.name;
    try {
      const result = await analyze(file);
      if (generation !== checklistGeneration) return;
      const read = result.file;
      Object.assign(read, { role: CHECKLIST_CATEGORY, autoCategory: read.category, category: CHECKLIST_CATEGORY, categoryLabel: 'Checklist del committente', confidence: 'assegnata' });
      checklist = { file, result };
      render();
      if (previous) checklistStatus.textContent += ' Sostituisce la checklist precedente (' + previous.file.name + ').';
    } finally {
      checklistReads -= 1;
      notify();
    }
  });

  checklistRemove.addEventListener('click', () => {
    const removed = checklist;
    checklistGeneration += 1;
    checklist = null;
    render();
    if (removed) checklistStatus.textContent = removed.file.name + ' rimossa dall’elenco: il file originale non è stato cancellato. ' + CHECKLIST_EMPTY;
    checklistInput.focus();
  });

  typeSelect.addEventListener('change', () => {
    templateReport = null;
    templateInput.value = '';
    templateStatus.textContent = 'Modello non caricato.';
    render();
  });

  templateInput.addEventListener('change', async () => {
    const file = templateInput.files && templateInput.files[0];
    if (!file) return;
    templateStatus.textContent = 'Verifica del modello in corso…';
    templateReport = await documentIntake.inspectTemplate(await file.arrayBuffer(), typeSelect.value, deps());
    templateStatus.textContent = templateReport.controlled
      ? 'Modello verificato: corrisponde alla copia controllata (impronta e struttura). Il file non è stato modificato.'
      : 'Modello non conforme: ' + templateReport.differences.join(' ');
    renderGate();
  });

  clearButton.addEventListener('click', () => {
    clearDocuments();
    render();
    input.focus();
  });

  downloadButton.addEventListener('click', async () => {
    if (!analysis || typeof JSZip === 'undefined' || reading() || packaging) return;
    // Fotografia dello stato visibile al momento del clic: le modifiche successive non entrano.
    const snapshot = entries.slice();
    const snapshotChecklist = checklist;
    const snapshotAnalysis = analysis;
    packaging = true;
    notify();
    try {
      const zip = new JSZip();
      const files = snapshot.map((entry, index) => ({
        ...entry.result.file,
        archivePath: 'allegati/' + entry.result.file.category + '/' + String(index + 1).padStart(3, '0') + '-' + documentIntake.safeArchiveName(entry.file.name)
      }));
      for (const [index, entry] of snapshot.entries()) zip.file(files[index].archivePath, await entry.file.arrayBuffer());
      const checklistFile = snapshotChecklist
        ? { ...snapshotChecklist.result.file, archivePath: 'checklist-committente/' + documentIntake.safeArchiveName(snapshotChecklist.file.name) }
        : null;
      if (snapshotChecklist) zip.file(checklistFile.archivePath, await snapshotChecklist.file.arrayBuffer());
      zip.file('estrazione.json', JSON.stringify({
        schema: 'colligo-acquisizione-documentale/1',
        documentType: snapshotAnalysis.documentType,
        createdAt: new Date().toISOString(),
        status: 'BOZZA — DA REVISIONARE',
        humanReviewRequired: true,
        processing: 'Elaborazione locale nel browser; nessun invio in rete o a servizi AI.',
        checklist: checklistFile,
        files,
        fields: snapshotAnalysis.fields,
        issues: snapshotAnalysis.issues,
        template: templateReport,
        generation: documentIntake.generationGate(snapshotAnalysis.documentType, templateReport, snapshotAnalysis)
      }, null, 2));
      zip.file('ISTRUZIONI.txt',
        'Pacchetto di acquisizione documentale Colligo — BOZZA DA REVISIONARE.\n' +
        'estrazione.json contiene la classificazione dei file, i dati estratti con file e posizione di origine e le segnalazioni.\n' +
        'I dati sono "estratti, non confermati": un tecnico Colligo deve verificarli sulle fonti prima di qualsiasi uso ufficiale.\n' +
        'Nessun dato è stato inventato o completato automaticamente; i file originali sono in allegati/ suddivisi per categoria.\n' +
        'La checklist del committente, se caricata, è separata in checklist-committente/. Gli archivi ZIP sono inclusi senza essere estratti.\n'
      );
      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const link = el('a');
      link.href = url;
      link.download = 'acquisizione-' + snapshotAnalysis.documentType + '-' + new Date().toISOString().slice(0, 10) + '.zip';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      status.textContent = 'Pacchetto ZIP scaricato sul dispositivo con ' + snapshot.length + ' documenti' + (snapshotChecklist ? ' e la checklist del committente' : '') + '. Non è stato inviato online.';
    } catch (error) {
      status.textContent = 'Impossibile preparare il pacchetto ZIP: ' + (error && error.message ? error.message : 'errore inatteso') + '.';
    } finally {
      packaging = false;
      notify();
    }
  });

  // Letto da js/document-generation.js per il questionario e il suo pacchetto.
  globalThis.documentIntakeSelection = {
    checklist: () => (checklist ? checklist.file : null),
    documents: () => entries.map((entry) => ({ file: entry.file, category: entry.result.file.category })),
    busy: () => reading() || packaging,
    clear() {
      clearDocuments();
      checklistGeneration += 1;
      checklist = null;
      resetStatusChoices();
      render();
    }
  };

  render();
})();
