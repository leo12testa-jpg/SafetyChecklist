'use strict';
// V15: integration behavior of the existing one-button DUVRI flow.
// Fixtures are synthetic only; no Colligo document or customer source is used.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createHash, webcrypto } = require('node:crypto');

const script = fs.readFileSync(path.join(__dirname, '..', 'js', 'document-local-intake.js'), 'utf8');
const ORIGIN = 'http://127.0.0.1:4198';
const ID = 'FASCICOLO_20261110_101010_abcdef123456';
const MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

async function simulate({ attachments = 1, reportedSources, batches = [2, 1], validWord = true, missingCounts = false } = {}) {
  const nodes = new Map();
  const windowEvents = new Map();
  let linkClicks = 0;
  let downloadRequests = 0;
  const popup = { close() {} };
  const bytes = validWord ? Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4]) :
    Uint8Array.from([0x42, 0x41, 0x44, 0x21, 1, 2, 3, 4]);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const selectedCount = attachments + 1;
  const report = {
    state: 'draft_needs_human_review',
    word_generated: true,
    issuance_allowed: false,
    document_status: 'NON_EMETTIBILE',
    download_path: '/api/jobs/' + ID + '/draft/download',
    sha256,
    source_count: reportedSources ?? selectedCount,
    source_candidates_rendered: 7,
    ai_agents_executed: ['synthetic-agent'],
    ai_batches_planned: batches[0],
    ai_batches_completed: batches[1],
    visual_sources_eligible: 0
  };
  if (missingCounts) delete report.source_count;

  function element(tag) {
    const handlers = new Map();
    return {
      tagName: tag.toUpperCase(),
      style: {},
      disabled: false,
      hidden: false,
      textContent: '',
      setAttribute() {},
      append(...children) { children.forEach(node => { if (node.id) nodes.set(node.id, node); }); },
      addEventListener(type, handler) { handlers.set(type, handler); },
      click() {
        if (tag === 'a') { linkClicks++; return; }
        const handler = handlers.get('click');
        this.lastClick = handler ? Promise.resolve(handler()) : Promise.resolve();
        return this.lastClick;
      },
      remove() {}
    };
  }

  const area = element('div');
  const screen = {
    querySelector() { return null; },
    addEventListener() {}
  };
  const document = {
    querySelector(selector) { return selector === '[data-screen="document-generation"]' ? screen : null; },
    getElementById(id) { return id === 'dg-generate-action' ? area : nodes.get(id) || null; },
    createElement: element,
    body: { appendChild() {} }
  };
  const response = (data) => ({ ok: true, json: async () => data });
  async function fetch(url) {
    if (url === ORIGIN + '/health') return response({
      state: 'ready_for_local_intake', issuance_allowed: false
    });
    if (url === ORIGIN + '/api/intake') return response({
      state: 'needs_human_review', issuance_allowed: false,
      word_generated: false, job_id: ID
    });
    if (url === ORIGIN + '/api/jobs/' + ID + '/draft') return response(report);
    if (url === ORIGIN + '/api/jobs/' + ID + '/draft/download') {
      downloadRequests++;
      return {
        ok: true,
        headers: { get(name) { return name === 'Content-Type' ? MIME : null; } },
        blob: async () => ({ arrayBuffer: async () => bytes.buffer.slice(
          bytes.byteOffset, bytes.byteOffset + bytes.byteLength) })
      };
    }
    throw new Error('Unexpected local endpoint: ' + url);
  }
  class FormDataStub {
    append() {}
  }

  const context = vm.createContext({
    document,
    window: {
      open() { return popup; },
      addEventListener(name, fn) { windowEvents.set(name, fn); }
    },
    fetch,
    FormData: FormDataStub,
    crypto: webcrypto,
    URL: {
      createObjectURL() { return 'blob:synthetic'; },
      revokeObjectURL() {}
    },
    setTimeout() {},
    console,
    documentIntakeSelection: {
      busy() { return false; },
      checklist() { return { name: 'checklist-synthetic.docx', size: 120 }; },
      documents() {
        return Array.from({ length: attachments }, (_, i) => ({
          file: { name: 'attachment-' + i + '.pdf', size: 300 }
        }));
      }
    }
  });
  vm.runInContext(script, context, { filename: 'js/document-local-intake.js' });
  const action = nodes.get('dg-analyze-sources');
  assert.ok(action, 'The existing DUVRI button should mount');
  assert.equal(action.disabled, false);
  await action.click(); // pairing is part of the first single action
  assert.ok(windowEvents.has('message'));
  await windowEvents.get('message')({
    origin: ORIGIN, source: popup,
    data: { type: 'COLLIGO_LOCAL_PAIR_V1', token: 'x'.repeat(48) }
  });
  await action.lastClick;
  const status = nodes.get('dg-local-status').textContent;
  return { status, linkClicks, downloadRequests };
}

test('V15 explicitly warns about incomplete AI batches without claiming an approved DUVRI', async () => {
  const r = await simulate({ attachments: 1, batches: [3, 1] });
  assert.equal(r.linkClicks, 1);
  assert.match(r.status, /Download bozza Word avviato/);
  assert.match(r.status, /elaborazione AI parziale/);
  assert.match(r.status, /nessuna validazione HSE automatica/);
  assert.match(r.status, /NON EMETTIBILE/);
  assert.match(r.status, /non prova la lettura completa/);
});

test('V15 flags a source count mismatch instead of claiming complete file coverage', async () => {
  const r = await simulate({ attachments: 2, reportedSources: 2, batches: [2, 2] });
  assert.equal(r.linkClicks, 1);
  assert.match(r.status, /3 file caricati, 2 fonti dichiarate/);
  assert.match(r.status, /verificare eventuali file mancanti/);
  assert.doesNotMatch(r.status, /elaborazione AI parziale/);
});

test('V15 blocks bytes that are not a DOCX even when the local service provides a matching hash', async () => {
  const r = await simulate({ validWord: false });
  assert.equal(r.downloadRequests, 1);
  assert.equal(r.linkClicks, 0);
  assert.match(r.status, /firma DOCX richiesta/);
  assert.match(r.status, /Nessun DUVRI è stato emesso/);
});

test('V15 refuses a download when the engine omits source-count evidence', async () => {
  const r = await simulate({ missingCounts: true });
  assert.equal(r.downloadRequests, 0);
  assert.equal(r.linkClicks, 0);
  assert.match(r.status, /conteggi delle fonti verificabili/);
  assert.match(r.status, /Nessun DUVRI è stato emesso/);
});
