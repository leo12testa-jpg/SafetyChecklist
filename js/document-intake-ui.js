/* Caricamento automatico dei file del committente in "Generazione documenti". Elaborazione solo
   locale (js/document-intake.js): nessun invio in rete o ad AI. I testi estratti sono mostrati
   esclusivamente con textContent. */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const input = $('dg-auto-files');
  if (!input || typeof documentIntake === 'undefined') return;

  const typeSelect = $('dg-auto-type');
  const status = $('dg-auto-status');
  const results = $('dg-auto-results');
  const filesList = $('dg-auto-files-list');
  const fieldsList = $('dg-auto-fields');
  const issuesList = $('dg-auto-issues');
  const downloadButton = $('dg-auto-download');
  const clearButton = $('dg-auto-clear');
  const templateInput = $('dg-template-file');
  const templateStatus = $('dg-template-status');
  const generateState = $('dg-generate-state');
  const reasonsList = $('dg-generate-reasons');

  const READ_STATUS = { letto: 'letto', immagine: 'immagine, contenuto non letto', non_supportato: 'formato non leggibile', non_letto: 'non letto', errore: 'errore di lettura' };
  const CONFIDENCE = { alta: 'classificazione sicura', media: 'classificazione probabile', bassa: 'classificazione incerta' };
  let entries = [];
  let analysis = null;
  let templateReport = null;
  let serial = 0;

  const deps = () => ({ JSZip: window.JSZip, pdfjsLib: window.pdfjsLib, crypto: window.crypto });
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };
  const sourceLabel = (s) => s.file + (s.location ? ' — ' + s.location : '');

  function renderGate() {
    const gate = documentIntake.generationGate(typeSelect.value, templateReport, analysis);
    generateState.textContent = gate.allowed ? 'pronta per la revisione' : 'bloccata';
    reasonsList.replaceChildren(...gate.reasons.map((reason) => el('li', null, reason)));
  }

  function render() {
    analysis = entries.length ? documentIntake.consolidate(typeSelect.value, entries.map((e) => e.result)) : null;
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
      filesList.replaceChildren(...analysis.files.map((file) => {
        const item = el('li', 'dg-auto-file');
        item.append(el('strong', null, file.name));
        item.append(el('small', null, file.categoryLabel + ' · ' + CONFIDENCE[file.confidence] + ' · ' + READ_STATUS[file.readStatus]));
        return item;
      }));
    }
    renderGate();
  }

  input.addEventListener('change', async () => {
    const picked = Array.from(input.files || []);
    if (!picked.length) return;
    input.disabled = true;
    try {
      for (const [index, file] of picked.entries()) {
        status.textContent = 'Lettura ' + (index + 1) + ' di ' + picked.length + ': ' + file.name;
        serial += 1;
        const tooLarge = file.size > documentIntake.MAX_FILE_BYTES;
        const bytes = await (tooLarge ? file.slice(0, 8) : file).arrayBuffer();
        const result = await documentIntake.analyzeFile({ id: 'file-' + serial, name: file.name, bytes, size: file.size }, deps());
        entries.push({ file, result });
      }
      status.textContent = entries.length + ' file analizzati sul dispositivo. Nessun file è stato inviato.';
    } catch (error) {
      status.textContent = 'Analisi interrotta: ' + (error && error.message ? error.message : 'errore inatteso') + '. I file già letti restano nell’elenco.';
    } finally {
      input.value = '';
      input.disabled = false;
      render();
    }
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
    entries = [];
    status.textContent = 'Nessun file caricato.';
    render();
  });

  downloadButton.addEventListener('click', async () => {
    if (!analysis || typeof JSZip === 'undefined') return;
    downloadButton.disabled = true;
    try {
      const zip = new JSZip();
      const files = analysis.files.map((file, index) => ({
        ...file,
        archivePath: 'allegati/' + file.category + '/' + String(index + 1).padStart(3, '0') + '-' + documentIntake.safeArchiveName(file.name)
      }));
      entries.forEach((entry, index) => zip.file(files[index].archivePath, entry.file));
      zip.file('estrazione.json', JSON.stringify({
        schema: 'colligo-acquisizione-documentale/1',
        documentType: analysis.documentType,
        createdAt: new Date().toISOString(),
        status: 'BOZZA — DA REVISIONARE',
        humanReviewRequired: true,
        processing: 'Elaborazione locale nel browser; nessun invio in rete o a servizi AI.',
        files,
        fields: analysis.fields,
        issues: analysis.issues,
        template: templateReport,
        generation: documentIntake.generationGate(typeSelect.value, templateReport, analysis)
      }, null, 2));
      zip.file('ISTRUZIONI.txt',
        'Pacchetto di acquisizione documentale Colligo — BOZZA DA REVISIONARE.\n' +
        'estrazione.json contiene la classificazione dei file, i dati estratti con file e posizione di origine e le segnalazioni.\n' +
        'I dati sono "estratti, non confermati": un tecnico Colligo deve verificarli sulle fonti prima di qualsiasi uso ufficiale.\n' +
        'Nessun dato è stato inventato o completato automaticamente; i file originali sono in allegati/ suddivisi per categoria.\n'
      );
      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const link = el('a');
      link.href = url;
      link.download = 'acquisizione-' + analysis.documentType + '-' + new Date().toISOString().slice(0, 10) + '.zip';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      status.textContent = 'Pacchetto ZIP scaricato sul dispositivo. Non è stato inviato online.';
    } catch (error) {
      status.textContent = 'Impossibile preparare il pacchetto ZIP: ' + (error && error.message ? error.message : 'errore inatteso') + '.';
    } finally {
      downloadButton.disabled = false;
    }
  });

  render();
})();
