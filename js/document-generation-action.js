/* Colligo DUVRI — avvio autenticato di una BOZZA Word dai due upload esistenti.
 * Nessuna emissione, approvazione HSE o invio cloud implicito.
 * L'endpoint server deve essere attivo: il pulsante non simula una generazione.
 */
'use strict';
const duvriGenerateAction = (() => {
  const MAX_FILES = 12;
  const MAX_TOTAL_BYTES = 45 * 1024 * 1024;
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
    if (files.reduce((n, f) => n + (Number(f.size) || 0), 0) > MAX_TOTAL_BYTES) {
      reasons.push('Dimensione massima complessiva: 45 MB.');
    }
    if (!consent) reasons.push('Devi autorizzare espressamente l’invio al backend e al provider AI configurato.');
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
      aiDataProcessingConsent: true,
      decisionGates: ['TITOLO_IV_ART26', 'HSE_REVIEW', 'D1', 'D2']
    };
  }

  function cloudAvailable() {
    return typeof DOCUMENT_GENERATION_CLOUD_ENABLED !== 'undefined' &&
      DOCUMENT_GENERATION_CLOUD_ENABLED === true &&
      typeof DOCUMENT_JOBS_ENDPOINT !== 'undefined' &&
      typeof appIdentity !== 'undefined';
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
    btn.textContent = 'Genera DUVRI (bozza Word)';
    btn.disabled = true;
    const consentLabel = document.createElement('label');
    consentLabel.className = 'dg-small-note';
    const consent = document.createElement('input');
    consent.type = 'checkbox';
    consent.id = 'dg-generation-consent';
    consentLabel.append(consent, document.createTextNode(' Autorizzo l’invio della checklist e degli allegati al backend privato e al provider AI configurato per preparare una bozza.'));
    const state = document.createElement('p');
    state.id = 'dg-generate-action-state';
    state.className = 'dg-small-note';
    state.setAttribute('role', 'status');
    state.setAttribute('aria-live', 'polite');
    const warning = document.createElement('p');
    warning.className = 'dg-small-note';
    warning.textContent = 'Solo BOZZA NON EMETTIBILE. Restano obbligatorie le verifiche tecniche, la decisione Titolo IV/art. 26 e le approvazioni HSE/D1/D2. Il modello Colligo deve essere configurato sul server.';
    area.append(consentLabel, btn, state, warning);
    gate.insertAdjacentElement('afterend', area);
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
        endpoint.searchParams.set('action', 'create');
        const title = screen.querySelector('#dg-form [name="title"]')?.value || '';
        const form = new FormData();
        form.append('metadata', JSON.stringify(metadata(snap.checklist, snap.attachments, title)));
        form.append('checklist', snap.checklist, snap.checklist.name);
        for (const entry of snap.attachments) form.append('files', entry.file, entry.file.name);
        const response = await fetch(endpoint.toString(), {
          method: 'POST',
          headers: { authorization: 'Bearer ' + token },
          body: form
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.job?.id) {
          throw new Error(typeof data.error === 'string' ? data.error : 'Il backend non ha confermato la creazione della bozza.');
        }
        // QUEUED non significa generazione completata né approvazione.
        state.textContent = 'Lavoro accodato (ID ' + data.job.id +
          '). Consulta “Elaborazioni documentali” per stato, revisione e download della bozza Word.';
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
  }

  return { validate, metadata, init, LAYOUT_ID };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = duvriGenerateAction;
if (typeof document !== 'undefined') duvriGenerateAction.init();
