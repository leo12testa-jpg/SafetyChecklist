// Test comportamentali della schermata "Generazione documenti".
// js/document-generation.js, il motore js/document-intake.js e le due aree di caricamento
// (js/document-intake-ui.js) vengono eseguiti in un contesto vm con un DOM minimo costruito
// dal markup reale di index.html (sezione data-screen="document-generation"), un fetch
// spia e un appIdentity finto. Nessuna chiamata di rete reale viene effettuata.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const JSZip = require('../js/vendor/jszip.min.js');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const controllerSource = fs.readFileSync(path.join(root, 'js', 'document-generation.js'), 'utf8');
const intakeEngineSource = fs.readFileSync(path.join(root, 'js', 'document-intake.js'), 'utf8');
const intakeUiSource = fs.readFileSync(path.join(root, 'js', 'document-intake-ui.js'), 'utf8');
const configSource = fs.readFileSync(path.join(root, 'js', 'supabase-config.js'), 'utf8');
const serviceWorker = fs.readFileSync(path.join(root, 'service-worker.js'), 'utf8');
const intakeSchema = JSON.parse(fs.readFileSync(path.join(root, 'schemas', 'duvri-intake.schema.json'), 'utf8'));

const ENDPOINT = 'https://example.invalid/functions/v1/document-jobs';

// ---------------------------------------------------------------- DOM minimo
const VOID_TAGS = new Set(['input', 'br', 'img', 'meta', 'link', 'hr', 'source', 'wbr']);
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'", nbsp: ' ' };
const decode = (text) => text.replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (_, name) => ENTITIES[name]);

class TextNode {
  constructor(text) { this.nodeType = 3; this.data = text; this.parentNode = null; }
  get textContent() { return this.data; }
  cloneNode() { return new TextNode(this.data); }
  remove() { if (this.parentNode) this.parentNode._detach(this); }
}

class Element {
  constructor(tag, attrs = {}) {
    this.nodeType = 1;
    this.tagName = tag.toUpperCase();
    this.attributes = { ...attrs };
    this.childNodes = [];
    this.parentNode = null;
    this.listeners = {};
    const dataAttr = (key) => 'data-' + String(key).replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
    this.dataset = new Proxy({}, {
      set: (target, key, value) => { target[key] = String(value); this.attributes[dataAttr(key)] = String(value); return true; },
      deleteProperty: (target, key) => { delete target[key]; delete this.attributes[dataAttr(key)]; return true; }
    });
    for (const [name, value] of Object.entries(attrs)) {
      if (name.startsWith('data-')) {
        this.dataset[name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = value;
      }
    }
    this.hidden = 'hidden' in attrs;
    this.disabled = 'disabled' in attrs;
    this.required = 'required' in attrs;
    this.checked = 'checked' in attrs;
    this.selected = 'selected' in attrs;
    this.type = attrs.type || '';
    this.name = attrs.name || '';
    this._value = attrs.value != null ? attrs.value : '';
    this.files = this.type === 'file' ? [] : undefined;
    this.focused = false;
    this.clicked = 0;
    this.content = this.tagName === 'TEMPLATE' ? new Element('#fragment') : undefined;
    const self = this;
    this.classList = {
      contains: (name) => self.className.split(/\s+/).includes(name),
      add: (name) => { if (!self.classList.contains(name)) self.className = (self.className + ' ' + name).trim(); },
      remove: (name) => { self.className = self.className.split(/\s+/).filter((c) => c && c !== name).join(' '); },
      toggle: (name, force) => {
        const on = force === undefined ? !self.classList.contains(name) : !!force;
        if (on) self.classList.add(name); else self.classList.remove(name);
        return on;
      }
    };
  }

  get id() { return this.attributes.id || ''; }
  get className() { return this.attributes.class || ''; }
  set className(value) { this.attributes.class = String(value); }
  get children() { return this.childNodes.filter((node) => node.nodeType === 1); }
  getAttribute(name) { return name in this.attributes ? this.attributes[name] : null; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  hasAttribute(name) { return name in this.attributes; }

  get value() {
    if (this.tagName === 'SELECT') {
      const options = this.querySelectorAll('option');
      const chosen = options.find((o) => o.selected) || options[0];
      return chosen ? chosen.value : '';
    }
    if (this.tagName === 'TEXTAREA' && this._value === '' && !this._dirty) return this.textContent;
    if (this.tagName === 'OPTION' && !('value' in this.attributes) && !this._dirty) return this.textContent;
    return this._value;
  }
  set value(v) {
    if (this.tagName === 'SELECT') {
      const options = this.querySelectorAll('option');
      assert.ok(options.some((o) => o.value === String(v)), 'opzione inesistente: ' + v);
      options.forEach((o) => { o.selected = o.value === String(v); });
      return;
    }
    this._value = String(v); this._dirty = true;
  }
  get selectedOptions() { return this.querySelectorAll('option').filter((o) => o.selected); }

  get textContent() { return this.childNodes.map((n) => n.textContent).join(''); }
  set textContent(text) { this.replaceChildren(); this.appendChild(new TextNode(String(text))); }
  set innerHTML(_) { throw new Error('innerHTML non consentito: usare textContent/DOM API (rischio XSS).'); }
  get innerHTML() { throw new Error('innerHTML non supportato dal DOM di test.'); }

  _detach(node) { this.childNodes = this.childNodes.filter((n) => n !== node); node.parentNode = null; }
  appendChild(node) {
    if (node.tagName === '#FRAGMENT') { [...node.childNodes].forEach((child) => this.appendChild(child)); return node; }
    if (node.parentNode) node.parentNode._detach(node);
    node.parentNode = this;
    this.childNodes.push(node);
    return node;
  }
  append(...nodes) { nodes.forEach((n) => this.appendChild(typeof n === 'string' ? new TextNode(n) : n)); }
  replaceChildren(...nodes) {
    [...this.childNodes].forEach((n) => this._detach(n));
    this.append(...nodes);
  }
  remove() { if (this.parentNode) this.parentNode._detach(this); }
  cloneNode(deep) {
    const copy = new Element(this.tagName.toLowerCase(), this.attributes);
    copy.hidden = this.hidden; copy.disabled = this.disabled; copy.checked = this.checked;
    if (deep) this.childNodes.forEach((n) => copy.appendChild(n.cloneNode(true)));
    if (this.content) copy.content = this.content.cloneNode(true);
    return copy;
  }

  descendants() {
    const out = [];
    const walk = (node) => node.children.forEach((child) => { out.push(child); walk(child); });
    walk(this);
    return out;
  }
  matches(selector) { return selector.split(',').some((s) => matchesComplex(this, s.trim())); }
  querySelectorAll(selector) { return this.descendants().filter((el) => el.matches(selector)); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  closest(selector) {
    for (let node = this; node && node.nodeType === 1; node = node.parentNode) {
      if (node.tagName !== '#FRAGMENT' && node.matches(selector)) return node;
    }
    return null;
  }

  addEventListener(type, callback) { (this.listeners[type] ||= []).push(callback); }
  dispatchEvent(event) { return dispatch(this, event.type, { detail: event.detail }); }
  focus() { this.focused = true; }
  scrollIntoView() {}
  click() { this.clicked += 1; dispatch(this, 'click'); }

  // Solo per FORM
  get elements() {
    const form = this;
    return new Proxy({}, { get: (_, name) => form.querySelector('[name="' + String(name) + '"]') });
  }
  reportValidity() {
    return this.querySelectorAll('input, select, textarea').every((field) => {
      if (!field.required || field.disabled) return true;
      if (field.type === 'file') return field.files.length > 0;
      if (field.type === 'checkbox') return field.checked;
      return String(field.value).trim() !== '';
    });
  }
  reset() {
    this.querySelectorAll('input, textarea').forEach((field) => {
      field._value = field.attributes.value || ''; field._dirty = false;
      field.checked = 'checked' in field.attributes;
      if (field.type === 'file') field.files = [];
    });
    this.querySelectorAll('option').forEach((o) => { o.selected = 'selected' in o.attributes; });
  }
}

function parseCompound(text) {
  const parts = { tag: null, ids: [], classes: [], attrs: [], checked: false };
  const re = /([a-zA-Z][\w-]*)|#([\w-]+)|\.([\w-]+)|\[([\w-]+)(?:="([^"]*)")?\]|(:checked)/y;
  let match; let consumed = 0;
  while ((match = re.exec(text)) && match[0]) {
    consumed += match[0].length;
    if (match[1]) parts.tag = match[1].toUpperCase();
    else if (match[2]) parts.ids.push(match[2]);
    else if (match[3]) parts.classes.push(match[3]);
    else if (match[4]) parts.attrs.push([match[4], match[5]]);
    else if (match[6]) parts.checked = true;
  }
  if (consumed !== text.length) throw new Error('Selettore non supportato dal DOM di test: ' + text);
  return parts;
}
function matchesCompound(el, parts) {
  if (parts.tag && el.tagName !== parts.tag) return false;
  if (parts.ids.some((id) => el.id !== id)) return false;
  if (parts.classes.some((c) => !el.classList.contains(c))) return false;
  if (parts.attrs.some(([name, value]) => !el.hasAttribute(name) || (value !== undefined && el.getAttribute(name) !== value))) return false;
  if (parts.checked && !el.checked) return false;
  return true;
}
function matchesComplex(el, selector) {
  const chain = selector.split(/\s+/).map(parseCompound);
  if (!matchesCompound(el, chain[chain.length - 1])) return false;
  let node = el.parentNode;
  for (let i = chain.length - 2; i >= 0; i -= 1) {
    while (node && node.nodeType === 1 && !matchesCompound(node, chain[i])) node = node.parentNode;
    if (!node || node.nodeType !== 1) return false;
    node = node.parentNode;
  }
  return true;
}

// Parser HTML minimo: legge dal tag di apertura indicato fino alla sua chiusura.
function parseElementAt(source, startIndex) {
  const token = /<!--[\s\S]*?-->|<\/([a-zA-Z0-9-]+)\s*>|<([a-zA-Z0-9-]+)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|[^<]+/g;
  token.lastIndex = startIndex;
  const stack = [];
  let rootEl = null;
  let match;
  while ((match = token.exec(source))) {
    const [raw, closeTag, openTag, attrText, selfClose] = match;
    if (raw.startsWith('<!--')) continue;
    if (openTag) {
      const attrs = {};
      for (const a of (attrText || '').matchAll(/([^\s=>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
        attrs[a[1].toLowerCase()] = decode(a[2] ?? a[3] ?? a[4] ?? '');
      }
      const el = new Element(openTag.toLowerCase(), attrs);
      const parent = stack[stack.length - 1];
      if (parent) (parent.content || parent).appendChild(el); else rootEl = el;
      if (!VOID_TAGS.has(openTag.toLowerCase()) && !selfClose) stack.push(el);
      else if (!parent) return rootEl;
    } else if (closeTag) {
      const top = stack.pop();
      assert.equal(top && top.tagName, closeTag.toUpperCase(), 'HTML non bilanciato vicino a </' + closeTag + '>');
      if (!stack.length) return rootEl;
    } else if (stack.length) {
      const parent = stack[stack.length - 1];
      (parent.content || parent).appendChild(new TextNode(decode(raw)));
    }
  }
  throw new Error('Elemento HTML non chiuso');
}

function dispatch(target, type, extra = {}) {
  const event = {
    type, target, defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; },
    ...extra
  };
  const chain = [];
  const pending = [];
  for (let node = target; node; node = node.parentNode) chain.push(node);
  const doc = chain.map((node) => node.ownerDocument).find(Boolean);
  if (doc) chain.push(doc);
  chain.forEach((node) => (node.listeners[type] || []).forEach((cb) => {
    const result = cb(event);
    if (result && typeof result.then === 'function') pending.push(result);
  }));
  event.done = Promise.all(pending);
  return event;
}

// ---------------------------------------------------------------- Ambiente
class FakeFormData {
  constructor(form) {
    this.entries = [];
    if (!form) return;
    form.querySelectorAll('input, select, textarea').forEach((field) => {
      if (!field.name || field.disabled || field.type === 'file') return;
      if ((field.type === 'checkbox' || field.type === 'radio') && !field.checked) return;
      this.entries.push([field.name, field.value]);
    });
  }
  append(name, value, filename) { this.entries.push([name, value, filename]); }
  get(name) { const e = this.entries.find(([n]) => n === name); return e ? e[1] : null; }
  getAll(name) { return this.entries.filter(([n]) => n === name).map(([, v]) => v); }
}

function fakeFile(name, size = 2048, type = 'application/pdf', content) {
  const payload = content === undefined ? 'SYNTHETIC-ATTACHMENT'.padEnd(size, 'x') : content;
  return new File([payload], name, { type, lastModified: 1760000000000 });
}

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300, status,
    headers: { get: (n) => (n.toLowerCase() === 'content-type' ? 'application/json; charset=utf-8' : null) },
    json: async () => JSON.parse(JSON.stringify(body)),
    text: async () => JSON.stringify(body)
  };
}
function textResponse(text, status) {
  return {
    ok: status >= 200 && status < 300, status,
    headers: { get: (n) => (n.toLowerCase() === 'content-type' ? 'text/html' : null) },
    json: async () => { throw new Error('non JSON'); },
    text: async () => text
  };
}

const flush = async () => { for (let i = 0; i < 10; i += 1) await new Promise((r) => setImmediate(r)); };

function setup({ cloud, admin = false, respond, useRealConfig = false } = {}) {
  const start = html.indexOf('<section id="screen-document-generation"');
  assert.ok(start >= 0, 'sezione Generazione documenti assente in index.html');
  const screen = parseElementAt(html, start);
  const navStart = html.search(/<button[^>]*data-nav="document-generation"/);
  assert.ok(navStart >= 0, 'voce di menu Generazione documenti assente');
  const nav = parseElementAt(html, navStart);

  const body = new Element('body');
  body.append(nav, screen);
  const document = {
    listeners: {},
    body,
    addEventListener(type, cb) { (this.listeners[type] ||= []).push(cb); },
    getElementById: (id) => body.querySelector('#' + id),
    querySelector: (s) => body.querySelector(s),
    querySelectorAll: (s) => body.querySelectorAll(s),
    createElement: (tag) => new Element(tag)
  };
  const setOwner = (el) => { el.ownerDocument = document; el.children.forEach(setOwner); };
  setOwner(body);
  const origCreate = document.createElement;
  document.createElement = (tag) => { const el = origCreate(tag); el.ownerDocument = document; return el; };

  const calls = [];
  const alerts = [];
  const blobs = [];
  const downloads = [];
  const context = {
    console, setTimeout: () => 0, clearTimeout() {},
    URL: Object.assign(function (u) { return new URL(u); }, {
      createObjectURL: (blob) => { downloads.push(blob); return 'blob:test-' + downloads.length; }, revokeObjectURL() {}
    }),
    URLSearchParams,
    Blob,
    File,
    JSZip,
    FormData: FakeFormData,
    crypto: { randomUUID: () => '00000000-0000-4000-8000-000000000001', subtle: require('node:crypto').webcrypto.subtle },
    TextDecoder,
    CustomEvent: class { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } },
    alert: (m) => alerts.push(m),
    confirm: () => true,
    document,
    fetch: async (url, init = {}) => {
      const parsed = new URL(url);
      const call = { url: parsed, action: parsed.searchParams.get('action'), init };
      calls.push(call);
      if (!respond) throw new Error('fetch inatteso: ' + url);
      return respond(call);
    },
    appIdentity: {
      ready: async () => {},
      token: async () => 'TEST-ID-TOKEN',
      isAdmin: () => admin
    }
  };
  vm.createContext(context);
  if (useRealConfig) {
    vm.runInContext(configSource, context, { filename: 'js/supabase-config.js' });
  } else if (cloud !== undefined) {
    context.DOCUMENT_GENERATION_CLOUD_ENABLED = cloud;
    context.DOCUMENT_JOBS_ENDPOINT = ENDPOINT;
  }
  vm.runInContext(controllerSource, context, { filename: 'js/document-generation.js' });
  vm.runInContext(intakeEngineSource, context, { filename: 'js/document-intake.js' });
  vm.runInContext(intakeUiSource, context, { filename: 'js/document-intake-ui.js' });

  const $ = (id) => document.getElementById(id);
  const form = $('dg-form');
  return {
    document, screen, nav, form, calls, alerts, blobs, context, $,
    fill(values = {}) {
      for (const [name, value] of Object.entries(values)) {
        const field = form.querySelector('[name="' + name + '"]');
        assert.ok(field, 'campo assente: ' + name);
        if (field.type === 'checkbox') field.checked = !!value; else field.value = value;
      }
    },
    async selectChecklist(file) {
      const input = $('dg-checklist-file');
      input.files = file ? [file] : [];
      await dispatch(input, 'change').done;
    },
    // Area 2: un'unica selezione multipla. Con category simula la correzione manuale nell'elenco.
    async selectAttachments(files, category) {
      const input = $('dg-auto-files');
      input.files = files;
      await dispatch(input, 'change').done;
      if (!category) return;
      for (let i = 0; i < files.length; i += 1) {
        const rows = $('dg-auto-files-list').children;
        const select = rows[rows.length - files.length + i].querySelector('select');
        select.value = category;
        dispatch(select, 'change');
      }
    },
    rows: () => $('dg-auto-files-list').children,
    downloadsCount: () => downloads.length,
    lastDownload: () => downloads[downloads.length - 1],
    submit() { return dispatch(form, 'submit'); },
    status: () => $('dg-cloud-status').textContent,
    queueText: () => $('dg-queue-list').textContent,
    async exportedRecord() {
      $('dg-download-json').click();
      const blob = downloads[downloads.length - 1];
      assert.ok(blob, 'nessuna esportazione JSON prodotta');
      const text = await blob.text();
      return { text, record: JSON.parse(text) };
    },
    async intakePackage() {
      await dispatch($('dg-auto-download'), 'click').done;
      const blob = downloads[downloads.length - 1];
      assert.ok(blob, 'nessun pacchetto di acquisizione scaricato: ' + $('dg-auto-status').textContent);
      return JSZip.loadAsync(await blob.arrayBuffer());
    },
    async exportedPackage() {
      await dispatch($('dg-download-package'), 'click').done;
      const blob = downloads[downloads.length - 1];
      assert.ok(blob, 'nessun pacchetto ZIP scaricato: ' + this.status());
      return JSZip.loadAsync(await blob.arrayBuffer());
    }
  };
}

// ---------------------------------------------------------------- Struttura
test('la schermata è raggiungibile dal menu e contiene gli elementi usati dal controller', () => {
  const env = setup({ cloud: false });
  assert.equal(env.screen.dataset.screen, 'document-generation');
  assert.equal(env.nav.dataset.nav, 'document-generation');
  const ids = [...new Set([...controllerSource.matchAll(/getElementById\('([^']+)'\)/g), ...intakeUiSource.matchAll(/\$\('([^']+)'\)/g)].map((m) => m[1]))];
  assert.ok(ids.length >= 15);
  for (const id of ids) assert.ok(env.$(id), 'elemento #' + id + ' richiesto dal controller ma assente in index.html');
  const checklist = env.$('dg-checklist-file');
  assert.equal(checklist.required, false, 'il cliente deve poter compilare il questionario da zero');
  assert.equal(checklist.type, 'file');
  assert.equal(env.screen.querySelectorAll('[data-dg-attachment-category]').length, 0, 'nessun riquadro per scegliere in anticipo la categoria');
  const uploads = env.screen.querySelectorAll('input').filter((el) => el.type === 'file');
  assert.deepEqual(uploads.map((el) => el.id), ['dg-checklist-file', 'dg-auto-files', 'dg-template-file'], 'due aree + verifica del modello');
  assert.equal(uploads[0].hasAttribute('multiple'), false, 'una sola checklist del committente');
  assert.equal(uploads[0].getAttribute('accept'), '.pdf,.doc,.docx,.xls,.xlsx,.json,.csv,.txt');
  assert.equal(uploads[1].hasAttribute('multiple'), true);
  assert.equal(uploads[1].hasAttribute('accept'), false, 'nessun formato escluso: i file non leggibili vengono segnalati, non scartati');
  const templateDetails = env.$('dg-template-details');
  assert.equal(templateDetails.tagName, 'DETAILS');
  assert.equal(templateDetails.hasAttribute('open'), false, 'la verifica del modello è chiusa di default');
  assert.ok(uploads[2].closest('#dg-template-details'));
  assert.equal(templateDetails.querySelector('summary').textContent, 'Verifica modello (Colligo)');
  assert.equal(env.$('dg-generate-state').closest('#dg-template-details'), null, 'lo stato della generazione resta visibile');
  const statuses = env.screen.querySelectorAll('[data-dg-status-category]');
  assert.equal(statuses.length, 10);
  statuses.forEach((select) => assert.deepEqual(select.querySelectorAll('option').map((option) => option.value), ['to_verify', 'available', 'to_acquire', 'not_applicable']));
  assert.match(env.screen.textContent, /art\. 26, comma 8-bis, del D\.Lgs\. 81\/2008/);
  assert.match(env.screen.textContent, /Legge 215\/2021/);
  assert.equal(env.form.querySelector('[name="aiDataProcessingConsent"]'), null, 'nessun trasferimento AI viene proposto nel flusso locale');
  const enabledTypes = env.form.querySelector('[name="documentType"]').querySelectorAll('option').filter((o) => !o.disabled).map((o) => o.value);
  assert.deepEqual(enabledTypes, ['duvri'], 'solo il DUVRI è generabile in questa versione');
});

test('la configurazione pubblicata mantiene il cloud disattivato e nessuna richiesta parte al caricamento', async () => {
  const env = setup({ useRealConfig: true });
  assert.equal(vm.runInContext('DOCUMENT_GENERATION_CLOUD_ENABLED', env.context), false);
  await flush();
  assert.equal(env.calls.length, 0);
  assert.match(env.status(), /Backend cloud non attivo/);
  assert.match(env.screen.querySelector('.dg-prototype-alert p').textContent, /non viene caricato online/);
  assert.match(env.queueText(), /Coda cloud non attiva/);
});

test('con il cloud disattivato la scheda viene preparata solo in locale, senza rete né contenuto dei file', async () => {
  for (const cloud of [false, undefined]) {
    const env = setup({ cloud });
    env.fill({ title: 'DUVRI Magazzino Nord', clientName: 'Cliente Srl', site: 'Via Roma 1', siteType: 'internal_area' });
    await env.selectChecklist(fakeFile('checklist-duvri.xlsx', 4096, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'));
    await env.selectAttachments([fakeFile('documento.pdf')], 'dvr-specifico');
    await env.selectAttachments([fakeFile('programma.pdf')], 'cronoprogrammi');
    assert.match(env.$('dg-checklist-file-status').textContent, /checklist-duvri\.xlsx · 4 KB/);
    assert.equal(env.rows().length, 2, 'la checklist resta fuori dall\'elenco della documentazione');

    const event = env.submit();
    await flush();
    assert.equal(event.defaultPrevented, true);
    assert.equal(env.calls.length, 0, 'nessuna richiesta di rete con cloud disattivato');
    assert.equal(env.$('dg-result').hidden, false);
    assert.equal(env.$('dg-result-title').textContent, 'Scheda dati pronta per il test');
    assert.match(env.status(), /nessun agente è stato avviato/);

    const { text, record } = await env.exportedRecord();
    assert.equal(record.cloudSubmission, false);
    assert.equal(record.aiGenerationStarted, false);
    assert.equal(record.humanReviewRequired, true);
    assert.equal(record.prototypeStatus, 'local-intake-only');
    assert.equal(record.sourceChecklist.name, 'checklist-duvri.xlsx');
    assert.equal(record.sourceChecklist.contentIncluded, false);
    assert.deepEqual(record.documents.map((d) => [d.name, d.category, d.contentIncluded]), [['documento.pdf', 'dvr-specifico', false], ['programma.pdf', 'cronoprogrammi', false]]);
    assert.deepEqual(record.workflow.map((s) => s.agent), ['coordinator', 'document-reader', 'duvri-analyst', 'docx-writer', 'quality-check']);
    assert.ok(record.workflow.every((s) => s.status === 'not_connected'));
    assert.ok(!text.includes('CONTENUTO-RISERVATO'), 'il contenuto dei file non deve finire nell\'esportazione');
    assert.ok(!text.includes('TEST-ID-TOKEN'));
  }
});

test('il questionario completo può essere preparato localmente senza checklist preesistente', async () => {
  const env = setup({ cloud: false });
  env.fill({
    title: 'Lavoro sintetico', documentDate: '2026-10-29', clientName: 'Cliente Sintetico Srl',
    site: 'Via di prova 1', siteType: 'internal_area', workDescription: 'Attività dimostrativa',
    workSchedule: 'Fase 1, 29/10/2026, 08:00-12:00', overlappingActivities: 'Nessuna compresenza prevista',
    otherWorkersPresence: 'no', publicPresence: 'no', emergencyRoutesAffected: 'no',
    assemblyPoint: 'Punto sintetico', emergencyContacts: 'Contatto di prova', roofWork: 'no'
  });
  assert.equal(env.$('dg-checklist-file').files.length, 0);
  env.submit();
  await flush();
  assert.equal(env.$('dg-result').hidden, false);
  assert.equal(env.calls.length, 0, 'preparazione locale senza richieste di rete');
  const { record } = await env.exportedRecord();
  assert.equal(record.sourceChecklist, null);
  assert.equal(record.client.legalName, 'Cliente Sintetico Srl');
  assert.equal(record.work.workSchedule, 'Fase 1, 29/10/2026, 08:00-12:00');
  assert.equal(record.aiGenerationStarted, false);
  assert.equal(record.humanReviewRequired, true);
  assert.ok(record.missingInformation.some((item) => /preposto/.test(item)));
  assert.deepEqual(Object.keys(record).sort(), Object.keys(intakeSchema.properties).sort(), 'lo schema descrive esattamente le chiavi JSON esportate');
});

test('le date incoerenti bloccano la preparazione con un messaggio', async () => {
  const env = setup({ cloud: false });
  await env.selectChecklist(fakeFile('checklist.pdf'));
  env.fill({ startDate: '2026-11-10', endDate: '2026-11-01' });
  env.submit();
  await flush();
  assert.deepEqual(env.alerts, ['La data di fine lavori non può precedere la data di inizio.']);
  assert.equal(env.form.querySelector('[name="endDate"]').focused, true);
  assert.equal(env.$('dg-result').hidden, true);
});

test('le lacune segnalano dati mancanti, preposto e allegati da verificare', async () => {
  const env = setup({ cloud: false });
  await env.selectChecklist(fakeFile('checklist.pdf'));
  env.fill({ 'modules': true });
  env.submit();
  await flush();
  const missing = env.$('dg-missing-list').children.map((li) => li.textContent);
  for (const expected of [/Titolo esatto del DUVRI/, /Impresa 1: ragione sociale/, /preposto/, /DVR specifico/, /Cronoprogramma/, /Planimetria/]) {
    assert.ok(missing.some((t) => expected.test(t)), 'lacuna attesa: ' + expected);
  }
  assert.match(env.$('dg-result-summary').textContent, /1 scheda impresa · 0 allegati di supporto/);
});

test('la categoria corretta a mano prevale sul nome del file; lo stato scelto resta esplicito', async () => {
  const env = setup({ cloud: false });
  env.fill({ documentStatusDvr: 'available' });
  await env.selectAttachments([fakeFile('DVR-del-cliente.pdf')]);
  assert.match(env.rows()[0].querySelector('.dg-doc-meta').textContent, /^DVR specifico dell’intervento · /, 'classificazione automatica dal nome');
  const select = env.rows()[0].querySelector('select');
  select.value = 'altri-allegati';
  dispatch(select, 'change');
  assert.match(env.rows()[0].querySelector('.dg-doc-meta').textContent, /^Altri allegati · categoria corretta manualmente · /);
  env.submit();
  await flush();
  const missing = env.$('dg-missing-list').children.map((li) => li.textContent);
  assert.ok(missing.some((line) => /DVR specifico.*nessun file.*relativa categoria/.test(line)));
  const { record } = await env.exportedRecord();
  assert.equal(record.documentAvailability['dvr-specifico'], 'available');
  assert.equal(record.documents[0].category, 'altri-allegati');
});

test('campi di committente, sito, impresa, preposto, lavori e quota arrivano al JSON', async () => {
  const env = setup({ cloud: false });
  env.fill({
    title: 'Lavoro sintetico', documentDate: '2026-10-29', clientName: 'Committente sintetico',
    clientVat: 'IT00000000000', clientAddress: 'Via Azienda 1', clientContactName: 'Referente Demo',
    clientContactPhone: '0000000000', clientContactEmail: 'demo@example.invalid',
    siteContactName: 'Referente Sito', siteContactPhone: '0000000001',
    site: 'Via Sito 2', siteType: 'mixed', accessNotes: 'Ingresso est',
    areaDescription: 'Locale tecnico sintetico', vehicleRoutes: 'Percorso segregato',
    materialStorageAreas: 'Deposito temporaneo delimitato', workDaysHours: '29/10/2026, 08:00-12:00',
    otherWorkersPresence: 'yes', publicPresence: 'no', siteSystems: 'Impianto elettrico',
    siteRestrictions: 'Accesso accompagnato', workDescription: 'Manutenzione dimostrativa',
    workSchedule: 'Fase 1, 08:00-12:00', overlappingActivities: 'Interferenza con logistica',
    workAreaSegregation: 'Barriere mobili', systemInterruptions: 'Nessuna interruzione prevista',
    deliveriesAndTraffic: 'Carico alle 08:00', coordinationNotes: 'Briefing prima dell’avvio',
    roofWork: 'yes', roofAccessMethod: 'PLE', roofLandingPoint: 'Accesso nord',
    roofProtections: 'Da verificare dal tecnico', roofLowerArea: 'Interdetta',
    roofRescuePlan: 'Piano sito da acquisire', assemblyPoint: 'Punto A',
    emergencyContacts: 'Numero interno 000', emergencyRoutesAffected: 'no',
    requiredPermits: 'Permesso accesso copertura'
  });
  const contractor = env.$('dg-contractors').querySelector('.dg-contractor-card');
  const fields = {
    role: 'subcontractor', parentCompany: 'Appaltatore Demo', company: 'Subappaltatore Demo',
    vatOrTaxId: 'IT00000000001', contactName: 'Referente Impresa', contactPhone: '0000000002',
    contactEmail: 'impresa@example.invalid', workerCount: '3', scope: 'Posa impianto dimostrativo',
    preposto: 'Nome dichiarato dal cliente', prepostoRole: 'Caposquadra',
    prepostoStatus: 'confirmed', equipment: 'Attrezzo sintetico', ppe: 'Casco e guanti'
  };
  for (const [name, value] of Object.entries(fields)) contractor.querySelector('[data-field="' + name + '"]').value = value;
  env.fill({ documentStatusContract: 'available', documentStatusDvr: 'to_acquire', documentStatusPlan: 'not_applicable' });
  env.submit();
  await flush();
  const { record } = await env.exportedRecord();
  assert.equal(record.client.vatOrTaxId, 'IT00000000000');
  assert.equal(record.client.siteContactName, 'Referente Sito');
  assert.equal(record.site.vehicleRoutes, 'Percorso segregato');
  assert.equal(record.site.publicPresence, 'no');
  assert.equal(record.work.deliveriesAndTraffic, 'Carico alle 08:00');
  assert.equal(record.work.systemInterruptions, 'Nessuna interruzione prevista');
  assert.equal(record.contractors[0].role, 'subcontractor');
  assert.equal(record.contractors[0].parentCompany, 'Appaltatore Demo');
  assert.equal(record.contractors[0].workerCount, 3);
  assert.deepEqual(record.contractors[0].preposto, { name: 'Nome dichiarato dal cliente', roleOrArea: 'Caposquadra', status: 'confirmed' });
  assert.equal(record.roofAccess.rescuePlan, 'Piano sito da acquisire');
  assert.equal(record.coordination.requiredPermits, 'Permesso accesso copertura');
  assert.equal(record.documentAvailability['dvr-specifico'], 'to_acquire');
  assert.equal(record.documentAvailability['planimetrie-layout'], 'not_applicable');
});

test('il pacchetto ZIP contiene istruzioni, JSON e i byte reali degli allegati per categoria', async () => {
  const env = setup({ cloud: false });
  env.fill({ title: 'Prova sintetica', clientName: 'Committente sintetico' });
  await env.selectChecklist(fakeFile('checklist.xlsx', 16, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'BYTES-CHECKLIST'));
  await env.selectAttachments([fakeFile('../foto prova?.jpg', 20, 'image/jpeg', 'BYTES-FOTO')], 'foto-sito');
  await env.selectAttachments([fakeFile('procedura.pdf', 30, 'application/pdf', 'BYTES-PROCEDURA')], 'procedure-operative');
  await env.selectAttachments([fakeFile('CON', 12, 'application/octet-stream', 'BYTES-RESERVED')], 'altri-allegati');
  env.submit();
  await flush();
  const zip = await env.exportedPackage();
  const paths = Object.keys(zip.files).filter((name) => !zip.files[name].dir).sort();
  assert.deepEqual(paths, ['ISTRUZIONI.txt', 'allegati/altri-allegati/003-_CON', 'allegati/checklist-preesistente/checklist.xlsx', 'allegati/foto-sito/001-foto prova_.jpg', 'allegati/procedure-operative/002-procedura.pdf', 'scheda-duvri.json']);
  const instructions = await zip.file('ISTRUZIONI.txt').async('string');
  assert.match(instructions, /non è un DUVRI/);
  assert.match(instructions, /validazione tecnica/);
  assert.ok(instructions.includes('\n'), 'le istruzioni devono contenere righe separate, non slash+n letterali');
  const json = JSON.parse(await zip.file('scheda-duvri.json').async('string'));
  assert.equal(json.documents.length, 3);
  assert.equal(json.sourceChecklist.contentIncluded, false);
  assert.equal(json.sourceChecklist.includedInLocalPackage, true);
  assert.ok(Array.isArray(json.missingInformation));
  assert.ok(json.documents.every((item) => item.contentIncluded === false && item.includedInLocalPackage === true));
  assert.equal(await zip.file('allegati/foto-sito/001-foto prova_.jpg').async('string'), 'BYTES-FOTO');
  assert.equal(await zip.file('allegati/procedure-operative/002-procedura.pdf').async('string'), 'BYTES-PROCEDURA');
  assert.equal(await zip.file('allegati/altri-allegati/003-_CON').async('string'), 'BYTES-RESERVED');
  assert.equal(await zip.file('allegati/checklist-preesistente/checklist.xlsx').async('string'), 'BYTES-CHECKLIST');
  assert.ok(!JSON.stringify(json).includes('BYTES-FOTO'));
});

test('aggiunta e rimozione delle imprese mantengono almeno una scheda numerata', async () => {
  const env = setup({ cloud: false });
  const add = env.$('dg-add-contractor');
  add.click(); add.click();
  await flush();
  const cards = () => env.$('dg-contractors').querySelectorAll('.dg-contractor-card');
  assert.equal(cards().length, 3);
  assert.deepEqual(cards().map((c) => c.querySelector('.dg-contractor-number').textContent), ['Impresa 1', 'Impresa 2', 'Impresa 3']);
  cards()[2].querySelector('[data-field="company"]').value = 'Subappalto Spa';
  dispatch(cards()[1].querySelector('[data-dg-remove-contractor]'), 'click');
  assert.equal(cards().length, 2);
  assert.equal(cards()[1].querySelector('.dg-contractor-number').textContent, 'Impresa 2');
  dispatch(cards()[1].querySelector('[data-dg-remove-contractor]'), 'click');
  assert.equal(cards().length, 1);
  assert.equal(cards()[0].querySelector('[data-dg-remove-contractor]').hidden, true, 'l\'ultima impresa non è rimovibile');
  assert.equal(env.calls.length, 0, 'con cloud disattivato nessuna richiesta anche dopo l\'interazione');
});

// ---------------------------------------------------------------- Cloud attivo (fetch simulato)
async function cloudEnv(options = {}) {
  const created = [];
  const env = setup({
    cloud: true,
    admin: options.admin,
    respond: options.respond || ((call) => {
      if (call.action === 'create') { created.push(call); return jsonResponse({ job: { id: 'job-123', status: 'queued', documentTypeName: 'DUVRI' }, message: 'Lavoro accodato.' }, 201); }
      if (call.action === 'list') return jsonResponse({ jobs: [] });
      return jsonResponse({});
    })
  });
  env.created = created;
  await flush(); // lascia completare l eventuale lettura iniziale della coda
  return env;
}

test('con il cloud attivo senza consenso esplicito non parte alcun caricamento', async () => {
  const env = await cloudEnv();
  await env.selectChecklist(fakeFile('checklist.pdf'));
  env.submit();
  await flush();
  assert.equal(env.created.length, 0);
  assert.match(env.status(), /devi confermare il consenso/);
  assert.equal(env.form.querySelector('[name="aiDataProcessingConsent"]'), null);
  assert.equal(env.calls.filter((call) => call.action === 'create').length, 0);
});

test('la UI corrente non permette trasferimenti cloud o AI anche se un test forza il flag', async () => {
  const env = await cloudEnv();
  env.fill({ title: 'Dati sintetici', siteType: 'mixed' });
  await env.selectAttachments([fakeFile('documento.pdf')], 'dvr-specifico');
  env.submit();
  await flush();
  assert.equal(env.created.length, 0);
  assert.equal(env.calls.filter((call) => call.action === 'create').length, 0);
  assert.equal(env.$('dg-result').hidden, false, 'la raccolta resta locale');
  assert.equal(env.calls.some((call) => call.init.body instanceof env.context.FormData), false);
});

const ALL_STATUSES = {
  queued: 'In coda', processing: 'In elaborazione', retry_wait: 'Nuovo tentativo programmato',
  awaiting_input: 'Informazioni da integrare', awaiting_configuration: 'Configurazione da completare',
  needs_review: 'Da revisionare', approved: 'Approvato dal revisore', rejected: 'Rifiutato',
  error: 'Errore', cancelled: 'Annullato', '<img src=x onerror=alert(1)>': 'Stato non riconosciuto'
};

async function listedJobs(options = {}) {
  const jobs = Object.keys(ALL_STATUSES).map((status, i) => ({
    id: 'job-' + i, status, title: '<b>Titolo ' + i + '</b>', document_type: 'duvri', phase: 'analyze',
    created_at: '2026-10-28T10:00:00Z', status_message: ''
  }));
  const requests = [];
  const env = await cloudEnv({
    admin: options.admin,
    respond: (call) => {
      requests.push(call);
      if (call.action === 'list') return jsonResponse({ jobs });
      if (call.action === 'usage') return jsonResponse({ estimatedSpendUsd: 1, budgetUsd: 40, jobsMeasured: 0, callsMeasured: 0 });
      if (call.action === 'status') {
        return jsonResponse({
          job: { id: call.url.searchParams.get('id'), status: 'needs_review', phase: 'validate' },
          files: [],
          events: [
            { agent: 'docx-writer', message: 'Bozza pronta', details: { usageKind: 'ai_usage', inputTokens: 12000, outputTokens: 200, estimatedCostUsd: 0.01 } },
            { agent: 'quality-check', message: 'QA', details: { usageKind: 'ai_usage', inputTokens: 500, outputTokens: 100, estimatedCostUsd: null } }
          ]
        });
      }
      return jsonResponse({ ok: true });
    }
  });
  env.requests = requests;
  await flush(); // la coda viene letta al caricamento della pagina
  return env;
}

test('la coda traduce ogni stato del job e offre solo le azioni ammesse', async () => {
  const env = await listedJobs();
  const cards = env.$('dg-queue-list').querySelectorAll('.dg-job-card');
  assert.equal(cards.length, Object.keys(ALL_STATUSES).length);
  for (const card of cards) {
    const badge = card.querySelector('.dg-job-status');
    const status = badge.dataset.status;
    assert.equal(badge.textContent, ALL_STATUSES[status], 'etichetta per ' + status);
    const buttons = card.querySelectorAll('button').map((b) => b.textContent);
    assert.equal(buttons.includes('Annulla'), ['queued', 'retry_wait', 'awaiting_input', 'awaiting_configuration'].includes(status), 'Annulla per ' + status);
    assert.equal(buttons.includes('Rimetti in coda'), ['error', 'retry_wait', 'awaiting_configuration', 'awaiting_input'].includes(status), 'Riprova per ' + status);
    assert.match(card.querySelector('h4').textContent, /^<b>Titolo \d+<\/b>$/, 'titolo trattato come testo, non HTML');
  }
  assert.match(env.status(), /Collegamento cloud raggiungibile/);
});

test('annulla e rimetti in coda inviano POST autenticati con il solo id del job', async () => {
  const env = await listedJobs();
  const card = env.$('dg-queue-list').querySelectorAll('.dg-job-card').find((c) => c.querySelector('.dg-job-status').dataset.status === 'retry_wait');
  const byLabel = (label) => card.querySelectorAll('button').find((b) => b.textContent === label);
  dispatch(byLabel('Annulla'), 'click');
  await flush();
  dispatch(byLabel('Rimetti in coda'), 'click');
  await flush();
  const writes = env.requests.filter((r) => ['cancel', 'retry'].includes(r.action));
  assert.deepEqual(writes.map((r) => [r.action, r.init.method, JSON.parse(r.init.body).id, r.init.headers.authorization]),
    [['cancel', 'POST', 'job-2', 'Bearer TEST-ID-TOKEN'], ['retry', 'POST', 'job-2', 'Bearer TEST-ID-TOKEN']]);
});

test('i dettagli mostrano consumo AI e le azioni di revisione solo agli admin', async () => {
  for (const admin of [false, true]) {
    const env = await listedJobs({ admin });
    const card = env.$('dg-queue-list').querySelectorAll('.dg-job-card')[0];
    dispatch(card.querySelectorAll('button').find((b) => b.textContent === 'Dettagli'), 'click');
    await flush();
    const details = card.querySelector('.dg-job-details');
    assert.ok(details);
    assert.match(details.textContent, /12\.500 token input · 300 token output · costo parziale/);
    const review = details.querySelector('.dg-review-actions');
    assert.equal(!!review, admin, 'azioni di revisione ' + (admin ? 'visibili' : 'nascoste'));
    assert.equal(env.requests.some((r) => r.action === 'usage'), admin, 'riepilogo consumi letto solo da admin');
    if (admin) {
      dispatch(review.querySelectorAll('button').find((b) => b.textContent === 'Rifiuta'), 'click');
      await flush();
      const call = env.requests.find((r) => r.action === 'review');
      assert.deepEqual(JSON.parse(call.init.body), { id: 'job-0', decision: 'rejected', comment: '' });
    }
  }
});

// Regressione corretta in js/document-generation.js: listener e inizializzazione cloud erano
// annidati nel click di "Aggiungi impresa" (coda mai letta al caricamento, listener duplicati).
test('con il cloud attivo la coda viene letta al caricamento della pagina', async () => {
  const env = await cloudEnv();
  await flush();
  assert.equal(env.calls.filter((c) => c.action === 'list').length, 1);
});

test('aggiungere imprese non duplica le letture della coda', async () => {
  const env = await cloudEnv();
  await flush();
  const add = env.$('dg-add-contractor');
  add.click(); add.click(); add.click();
  await flush();
  assert.equal(env.calls.filter((c) => c.action === 'list').length, 1, 'aggiungere imprese non legge la coda');
  const before = env.calls.filter((c) => c.action === 'list').length;
  env.$('dg-refresh-jobs').click();
  await flush();
  assert.equal(env.calls.filter((c) => c.action === 'list').length - before, 1);
});

test('aprire la schermata dal menu aggiorna lo stato della coda', async () => {
  const off = setup({ cloud: false });
  await flush();
  assert.match(off.queueText(), /Coda cloud non attiva/);
  dispatch(off.nav, 'click');
  await flush();
  assert.equal(off.calls.length, 0, 'con cloud disattivato il menu non genera richieste');
  assert.match(off.status(), /Il caricamento e la generazione non sono disponibili/);

  const on = await cloudEnv();
  const before = on.calls.filter((c) => c.action === 'list').length;
  dispatch(on.nav, 'click');
  await flush();
  assert.equal(on.calls.filter((c) => c.action === 'list').length - before, 1);
});

// ---------------------------------------------------------------- Asserzioni sul sorgente rimaste
// Il precache del service worker e l'ordine dei <script> non sono osservabili senza un browser
// reale (vedi tests/pwa-*.cjs): restano verifiche testuali.
// ---------------------------------------------------------------- Due aree di caricamento
const textFile = (name, text) => fakeFile(name, 0, 'text/plain', text);

test('checklist del committente e documentazione restano distinte nell\'elaborazione e nei pacchetti', async () => {
  const env = setup({ cloud: false });
  await env.selectChecklist(textFile('checklist.txt', 'Committente: Alfa S.r.l.'));
  await env.selectAttachments([textFile('contratto.txt', 'Contratto di appalto\nCommittente: Beta S.p.A.')]);
  assert.equal(env.rows().length, 1, 'la checklist non compare tra i documenti');
  assert.match(env.$('dg-checklist-file-status').textContent, /checklist\.txt · 1 KB · formato TXT · letto · 1 segnalazione \(vedi sotto\)\. Identificata come checklist del committente/);
  assert.equal(env.$('dg-checklist-remove').hidden, false);
  const conflict = env.$('dg-auto-fields').querySelector('.is-conflict');
  assert.ok(conflict, 'il conflitto tra checklist e documentazione viene rilevato');
  assert.match(conflict.textContent, /Alfa S\.r\.l\.Fonte: checklist\.txt — riga 1/);
  assert.match(conflict.textContent, /Beta S\.p\.A\.Fonte: contratto\.txt — riga 2/);

  const zip = await env.intakePackage();
  const paths = Object.keys(zip.files).filter((name) => !zip.files[name].dir).sort();
  assert.deepEqual(paths, ['ISTRUZIONI.txt', 'allegati/contratto-capitolato/001-contratto.txt', 'checklist-committente/checklist.txt', 'estrazione.json']);
  const report = JSON.parse(await zip.file('estrazione.json').async('string'));
  assert.equal(report.checklist.name, 'checklist.txt');
  assert.equal(report.checklist.category, 'checklist-committente');
  assert.deepEqual(report.files.map((f) => f.name), ['contratto.txt']);
  assert.equal(report.fields.committente.status, 'conflicting');
  assert.equal(report.generation.allowed, false);
  assert.ok(report.generation.reasons.some((r) => r.startsWith('DUVRI-SCALA')), 'il blocco DUVRI-SCALA resta attivo');

  env.fill({ title: 'Prova', clientName: 'Alfa S.r.l.' });
  env.submit();
  await flush();
  const { record } = await env.exportedRecord();
  assert.equal(record.sourceChecklist.name, 'checklist.txt');
  assert.deepEqual(record.documents.map((d) => [d.name, d.category]), [['contratto.txt', 'contratto-capitolato']]);

  dispatch(env.$('dg-checklist-remove'), 'click');
  assert.match(env.$('dg-checklist-file-status').textContent, /checklist\.txt rimossa dall’elenco: il file originale non è stato cancellato/);
  assert.equal(env.$('dg-result').hidden, true, 'una modifica delle selezioni invalida la scheda già preparata');
});

test('60 documenti in una sola selezione: nessuno scartato, rimozione del singolo file', async () => {
  const env = setup({ cloud: false });
  const files = Array.from({ length: 60 }, (_, i) => textFile('verbale-' + String(i + 1).padStart(2, '0') + '.txt', 'Verbale di riunione ' + (i + 1)));
  await env.selectAttachments(files);
  assert.equal(env.rows().length, 60);
  assert.match(env.$('dg-auto-status').textContent, /^60 file analizzati sul dispositivo/);
  const target = env.rows()[9];
  assert.equal(target.querySelector('strong').textContent, 'verbale-10.txt');
  dispatch(target.querySelector('button'), 'click');
  assert.equal(env.rows().length, 59);
  assert.ok(!env.rows().some((row) => row.querySelector('strong').textContent === 'verbale-10.txt'));
  assert.match(env.$('dg-auto-status').textContent, /verbale-10\.txt rimosso dall’elenco: il file originale non è stato cancellato\. 59 file in elenco\./);
  assert.equal(await files[9].text(), 'Verbale di riunione 10', 'il file rimosso resta intatto');
  env.fill({ title: 'Prova' });
  env.submit();
  await flush();
  const { record } = await env.exportedRecord();
  assert.equal(record.documents.length, 59);
});

test('ogni file mostra categoria, stato di lettura e anomalie; gli ZIP sono inclusi senza essere estratti', async () => {
  const env = setup({ cloud: false });
  await env.selectAttachments([
    fakeFile('archivio-cantiere.zip', 0, 'application/zip', 'PK\u0003\u0004SYNTHETIC-ZIP'),
    fakeFile('planimetria.pdf', 0, 'application/pdf', 'NON-PDF'),
    textFile('procedura operativa.txt', 'Procedura operativa di lavoro')
  ]);
  const [zipRow, pdfRow, procRow] = env.rows();
  assert.match(zipRow.querySelector('.dg-doc-meta').textContent, /archivio ZIP non estratto: non letto – da revisionare/);
  assert.match(zipRow.querySelector('.dg-doc-issues').textContent, /archivio-cantiere\.zip: formato non leggibile automaticamente \(\.zip\)/);
  assert.match(pdfRow.querySelector('.dg-doc-meta').textContent, /^Planimetrie, layout e disegni · .* · non letto · /);
  assert.match(pdfRow.querySelector('.dg-doc-issues').textContent, /l’estensione non corrisponde al contenuto/);
  assert.match(procRow.querySelector('.dg-doc-meta').textContent, /^Procedure operative · .* · letto · /);
  assert.equal(procRow.querySelector('.dg-doc-issues'), null);
  const zip = await env.intakePackage();
  assert.equal(await zip.file('allegati/altri-allegati/001-archivio-cantiere.zip').async('string'), 'PK\u0003\u0004SYNTHETIC-ZIP');
  assert.match(await zip.file('ISTRUZIONI.txt').async('string'), /archivi ZIP sono inclusi senza essere estratti/);
});

test('correzione manuale della categoria e stato «Disponibile» automatico senza sovrascrivere le scelte', async () => {
  const env = setup({ cloud: false });
  const status = (name) => env.form.querySelector('[name="' + name + '"]').value;
  env.fill({ documentStatusSds: 'not_applicable' });
  await env.selectAttachments([textFile('cronoprogramma.txt', 'Cronoprogramma dei lavori'), textFile('SDS prodotto.txt', 'Scheda di sicurezza')]);
  assert.equal(status('documentStatusSchedule'), 'available');
  assert.equal(status('documentStatusSds'), 'not_applicable', 'la scelta dell\'utente non viene sovrascritta');
  const select = env.rows()[0].querySelector('select');
  select.value = 'planimetrie-layout';
  dispatch(select, 'change');
  assert.equal(status('documentStatusSchedule'), 'to_verify', 'lo stato impostato in automatico torna da verificare');
  assert.equal(status('documentStatusPlan'), 'available');
  const zip = await env.intakePackage();
  const report = JSON.parse(await zip.file('estrazione.json').async('string'));
  assert.deepEqual([report.files[0].autoCategory, report.files[0].category, report.files[0].categoryCorrected, report.files[0].confidence], ['cronoprogrammi', 'planimetrie-layout', true, 'manuale']);
  assert.ok(zip.file('allegati/planimetrie-layout/001-cronoprogramma.txt'));
  const userSelect = env.form.querySelector('[name="documentStatusPlan"]');
  userSelect.value = 'to_acquire';
  dispatch(userSelect, 'change');
  dispatch(env.rows()[0].querySelector('button'), 'click');
  assert.equal(status('documentStatusPlan'), 'to_acquire', 'dopo una scelta manuale la riga non cambia più da sola');
});

test('trascinamento dei file e azzeramento della scheda svuotano entrambe le aree', async () => {
  const env = setup({ cloud: false });
  const zone = env.$('dg-auto-drop');
  assert.equal(dispatch(zone, 'dragover').defaultPrevented, true);
  assert.equal(zone.classList.contains('is-dragover'), true);
  const drop = dispatch(zone, 'drop', { dataTransfer: { files: [textFile('verbale.txt', 'Verbale'), textFile('attestato.txt', 'Attestato di formazione')] } });
  await drop.done;
  assert.equal(drop.defaultPrevented, true);
  assert.equal(zone.classList.contains('is-dragover'), false);
  assert.deepEqual(env.rows().map((row) => row.querySelector('strong').textContent), ['verbale.txt', 'attestato.txt']);
  await env.selectChecklist(textFile('checklist.txt', 'Committente: Alfa'));
  dispatch(env.$('dg-reset'), 'click');
  assert.equal(env.rows().length, 0);
  assert.equal(env.$('dg-checklist-file-status').textContent, 'Nessuna checklist caricata: puoi compilare tutto da zero.');
  assert.equal(env.$('dg-auto-results').hidden, true);
});

// ---------------------------------------------------------------- Letture concorrenti e azzeramenti
// File la cui lettura resta in sospeso finché il test non la rilascia.
function slowFile(name, text) {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const file = textFile(name, text);
  const read = file.arrayBuffer.bind(file);
  file.arrayBuffer = async () => { await gate; return read(); };
  return { file, release };
}
const names = (env) => env.rows().map((row) => row.querySelector('strong').textContent);

test('svuota durante la lettura: nessun file già avviato o in coda viene reinserito', async () => {
  const env = setup({ cloud: false });
  const slow = slowFile('a.txt', 'Contratto di appalto');
  const first = env.selectAttachments([slow.file, textFile('b.txt', 'Procedura operativa')]);
  const queued = env.selectAttachments([textFile('c.txt', 'Verbale')]);
  await flush();
  assert.equal(env.$('dg-auto-download').disabled, true, 'download bloccato durante la lettura');
  dispatch(env.$('dg-auto-clear'), 'click');
  slow.release();
  await first; await queued; await flush();
  assert.deepEqual(names(env), []);
  assert.equal(env.$('dg-auto-status').textContent, 'Nessun file caricato.');
  assert.equal(env.$('dg-auto-download').disabled, false);
  await env.selectAttachments([textFile('d.txt', 'Attestato')]);
  assert.deepEqual(names(env), ['d.txt'], 'dopo lo svuotamento le nuove selezioni funzionano');
});

test('azzeramento durante la lettura: entrambe le aree restano vuote e la scheda non li contiene', async () => {
  const env = setup({ cloud: false });
  const doc = slowFile('documento.txt', 'Contratto di appalto');
  const list = slowFile('checklist.txt', 'Committente: Alfa');
  const docRead = env.selectAttachments([doc.file]);
  const listRead = env.selectChecklist(list.file);
  await flush();
  dispatch(env.$('dg-reset'), 'click');
  doc.release(); list.release();
  await docRead; await listRead; await flush();
  assert.deepEqual(names(env), []);
  assert.equal(env.$('dg-checklist-file-status').textContent, 'Nessuna checklist caricata: puoi compilare tutto da zero.');
  assert.equal(env.$('dg-auto-results').hidden, true);
  env.fill({ title: 'Prova' });
  env.submit();
  await flush();
  const { record } = await env.exportedRecord();
  assert.equal(record.sourceChecklist, null);
  assert.deepEqual(record.documents, []);
});

test('nuova checklist durante la lettura: vale l\'ultima scelta, la lettura precedente è scartata', async () => {
  const env = setup({ cloud: false });
  const old = slowFile('vecchia.txt', 'Committente: A');
  const oldRead = env.selectChecklist(old.file);
  await flush();
  await env.selectChecklist(textFile('nuova.txt', 'Committente: B'));
  old.release();
  await oldRead; await flush();
  assert.match(env.$('dg-checklist-file-status').textContent, /^nuova\.txt · /);
  env.fill({ title: 'Prova' });
  env.submit();
  await flush();
  const { record } = await env.exportedRecord();
  assert.equal(record.sourceChecklist.name, 'nuova.txt');
  const zip = await env.intakePackage();
  assert.deepEqual(Object.keys(zip.files).filter((n) => !zip.files[n].dir && n.startsWith('checklist-committente/')), ['checklist-committente/nuova.txt']);
});

test('una scelta manuale «Da verificare» non viene mai sovrascritta; l\'azzeramento la libera', async () => {
  const env = setup({ cloud: false });
  const select = (name) => env.form.querySelector('[name="' + name + '"]');
  await env.selectAttachments([textFile('cronoprogramma.txt', 'Cronoprogramma dei lavori')]);
  assert.equal(select('documentStatusSchedule').value, 'available');
  select('documentStatusSchedule').value = 'to_verify';
  dispatch(select('documentStatusSchedule'), 'change');
  await env.selectAttachments([textFile('procedura operativa.txt', 'Procedura operativa')]);
  assert.equal(select('documentStatusSchedule').value, 'to_verify', 'scelta manuale rispettata');
  assert.equal(select('documentStatusProcedures').value, 'available', 'le righe mai toccate seguono la classificazione');
  dispatch(env.rows()[0].querySelector('[data-remove-file]'), 'click');
  assert.equal(select('documentStatusSchedule').value, 'to_verify');
  dispatch(env.$('dg-reset'), 'click');
  await env.selectAttachments([textFile('cronoprogramma.txt', 'Cronoprogramma dei lavori')]);
  assert.equal(select('documentStatusSchedule').value, 'available', 'dopo l\'azzeramento la riga torna automatica');
});

test('durante la lettura nessun download o preparazione può partire', async () => {
  const env = setup({ cloud: false });
  await env.selectAttachments([textFile('contratto.txt', 'Contratto di appalto')]);
  env.fill({ title: 'Prova' });
  env.submit();
  await flush();
  assert.equal(env.$('dg-result').hidden, false);
  const before = env.downloadsCount();
  const slow = slowFile('lento.txt', 'Verbale');
  const pending = env.selectAttachments([slow.file]);
  await flush();
  assert.equal(env.$('dg-result').hidden, true, 'la scheda preparata viene invalidata');
  for (const id of ['dg-auto-download', 'dg-download-json', 'dg-download-package']) assert.equal(env.$(id).disabled, true, id);
  assert.equal(env.form.querySelector('button[type="submit"]').disabled, true);
  await dispatch(env.$('dg-auto-download'), 'click').done;
  await dispatch(env.$('dg-download-package'), 'click').done;
  env.submit();
  await flush();
  assert.equal(env.downloadsCount(), before, 'nessun pacchetto parziale');
  assert.equal(env.$('dg-result').hidden, true);
  assert.match(env.status(), /Attendi la fine della lettura/);
  slow.release();
  await pending; await flush();
  for (const id of ['dg-auto-download', 'dg-download-json', 'dg-download-package']) assert.equal(env.$(id).disabled, false, id);
  assert.equal(env.form.querySelector('button[type="submit"]').disabled, false);
});

test('i pacchetti corrispondono esattamente all\'elenco visibile dopo aggiunte, rimozioni e correzioni', async () => {
  const env = setup({ cloud: false });
  await env.selectChecklist(textFile('checklist.txt', 'Committente: Alfa'));
  await env.selectAttachments(['uno', 'due', 'tre', 'quattro', 'cinque'].map((n) => textFile(n + '.txt', 'Documento ' + n)));
  dispatch(env.rows()[1].querySelector('[data-remove-file]'), 'click');
  const select = env.rows()[1].querySelector('select');
  select.value = 'sds';
  dispatch(select, 'change');
  const visible = env.rows().map((row) => [row.querySelector('strong').textContent, row.querySelector('select').value]);
  assert.deepEqual(visible.map((v) => v[0]), ['uno.txt', 'tre.txt', 'quattro.txt', 'cinque.txt']);
  const zip = await env.intakePackage();
  const attached = Object.keys(zip.files).filter((n) => !zip.files[n].dir && n.startsWith('allegati/')).sort();
  assert.deepEqual(attached, visible.map(([name, category], i) => 'allegati/' + category + '/' + String(i + 1).padStart(3, '0') + '-' + name).sort());
  const report = JSON.parse(await zip.file('estrazione.json').async('string'));
  assert.deepEqual(report.files.map((f) => [f.name, f.category]), visible);
  assert.equal(report.checklist.name, 'checklist.txt');
  assert.ok(!Object.keys(zip.files).some((n) => n.includes('due.txt')), 'il file rimosso non entra nel pacchetto');
  env.fill({ title: 'Prova' });
  env.submit();
  await flush();
  const { record } = await env.exportedRecord();
  assert.deepEqual(record.documents.map((d) => [d.name, d.category]), visible);
  const pkg = await env.exportedPackage();
  const pkgAttached = Object.keys(pkg.files).filter((n) => !pkg.files[n].dir && n.startsWith('allegati/') && !n.startsWith('allegati/checklist-preesistente/')).sort();
  assert.deepEqual(pkgAttached, visible.map(([name, category], i) => 'allegati/' + category + '/' + String(i + 1).padStart(3, '0') + '-' + name).sort());
});

test('controlli accessibili: etichette con il nome del file e focus coerente', async () => {
  const env = setup({ cloud: false });
  await env.selectAttachments([textFile('primo.txt', 'Verbale'), textFile('secondo.txt', 'Verbale'), textFile('terzo.txt', 'Verbale')]);
  const [row] = env.rows();
  assert.equal(row.querySelector('select').getAttribute('aria-label'), 'Categoria di primo.txt');
  assert.equal(row.querySelector('[data-remove-file]').getAttribute('aria-label'), 'Rimuovi primo.txt dall’elenco');
  assert.equal(row.querySelector('[data-remove-file]').textContent, 'Rimuovi');
  const select = env.rows()[1].querySelector('select');
  select.value = 'permessi';
  dispatch(select, 'change');
  assert.equal(env.rows()[1].querySelector('select').focused, true, 'focus sul menu ricreato dello stesso file');
  dispatch(env.rows()[1].querySelector('[data-remove-file]'), 'click');
  assert.equal(env.rows()[1].querySelector('[data-remove-file]').focused, true, 'focus sul file successivo');
  assert.equal(env.rows()[1].querySelector('strong').textContent, 'terzo.txt');
  dispatch(env.rows()[1].querySelector('[data-remove-file]'), 'click');
  assert.equal(env.rows()[0].querySelector('[data-remove-file]').focused, true, 'ultimo della lista: focus sul precedente');
  dispatch(env.rows()[0].querySelector('[data-remove-file]'), 'click');
  assert.equal(env.$('dg-auto-files').focused, true, 'elenco vuoto: focus sul selettore dei file');
  await env.selectChecklist(textFile('checklist.txt', 'x'));
  dispatch(env.$('dg-checklist-remove'), 'click');
  assert.equal(env.$('dg-checklist-file').focused, true);
});

test('un file rilasciato fuori dall\'area non viene aperto dal browser né caricato', async () => {
  const env = setup({ cloud: false });
  env.screen.hidden = false;
  const files = [textFile('fuori.txt', 'Verbale')];
  const over = dispatch(env.form, 'dragover', { dataTransfer: { types: ['Files'], files, dropEffect: 'copy' } });
  assert.equal(over.defaultPrevented, true);
  assert.equal(over.dataTransfer.dropEffect, 'none');
  const drop = dispatch(env.form, 'drop', { dataTransfer: { types: ['Files'], files } });
  await drop.done;
  assert.equal(drop.defaultPrevented, true, 'il browser non apre il file');
  assert.deepEqual(names(env), [], 'nessun caricamento involontario');
  assert.equal(env.$('dg-auto-status').textContent, 'File non caricati: rilasciali nell’area «Documentazione del cliente».');
  const text = dispatch(env.form, 'dragover', { dataTransfer: { types: ['text/plain'] } });
  assert.equal(text.defaultPrevented, false, 'il trascinamento di testo nei campi resta possibile');
  const inside = dispatch(env.$('dg-auto-drop'), 'drop', { dataTransfer: { types: ['Files'], files } });
  await inside.done;
  assert.deepEqual(names(env), ['fuori.txt'], 'nell\'area il rilascio funziona');
});

test('lo ZIP del questionario usa la fotografia al clic anche se l\'elenco cambia durante la preparazione', async () => {
  const env = setup({ cloud: false });
  await env.selectAttachments([textFile('uno.txt', 'Documento uno'), textFile('due.txt', 'Documento due')]);
  env.fill({ title: 'Prova' });
  env.submit();
  await flush();
  const file = env.context.documentIntakeSelection.documents()[0].file;
  const read = file.arrayBuffer.bind(file);
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  file.arrayBuffer = async () => { await gate; return read(); };
  const building = dispatch(env.$('dg-download-package'), 'click');
  await flush();
  dispatch(env.rows()[1].querySelector('[data-remove-file]'), 'click');
  release();
  await building.done;
  assert.doesNotMatch(env.status(), /Impossibile/, env.status());
  assert.match(env.status(), /Pacchetto ZIP preparato/);
  const blob = await env.lastDownload();
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const files = Object.keys(zip.files).filter((n) => !zip.files[n].dir && n.startsWith('allegati/')).sort();
  assert.deepEqual(files, ['allegati/altri-allegati/001-uno.txt', 'allegati/altri-allegati/002-due.txt'], 'pacchetto coerente con la scheda preparata');
  const scheda = JSON.parse(await zip.file('scheda-duvri.json').async('string'));
  assert.deepEqual(scheda.documents.map((d) => d.name), ['uno.txt', 'due.txt']);
  assert.equal(env.$('dg-result').hidden, true, 'la modifica successiva invalida comunque la scheda');
});

test('un errore inatteso durante la lettura non blocca le selezioni successive né i download', async () => {
  const env = setup({ cloud: false });
  const broken = { size: 10, slice() { return this; }, arrayBuffer: async () => { throw new Error('disco'); } };
  Object.defineProperty(broken, 'name', { get() { throw new Error('nome illeggibile'); } });
  await env.selectAttachments([broken]);
  assert.match(env.$('dg-auto-status').textContent, /^Analisi interrotta: nome illeggibile\. I file già letti restano nell’elenco\.$/);
  assert.equal(env.$('dg-auto-download').disabled, false, 'nessun blocco permanente');
  await env.selectAttachments([textFile('dopo.txt', 'Verbale')]);
  assert.deepEqual(names(env), ['dopo.txt'], 'la selezione successiva viene elaborata');
  assert.equal(env.context.documentIntakeSelection.busy(), false);
});

test('il rilascio diretto sui campi file nativi resta consentito', () => {
  const env = setup({ cloud: false });
  for (const id of ['dg-checklist-file', 'dg-template-file', 'dg-auto-files']) {
    const over = dispatch(env.$(id), 'dragover', { dataTransfer: { types: ['Files'], dropEffect: 'copy' } });
    assert.equal(over.dataTransfer.dropEffect, 'copy', id);
    const drop = dispatch(env.$(id), 'drop', { dataTransfer: { types: ['Files'], files: [] } });
    assert.equal(drop.defaultPrevented, id === 'dg-auto-files', id + ': solo l\'area 2 gestisce il rilascio da sé');
  }
});

test('durante letture lunghe il controllo in uso nell\'elenco mantiene il focus', async () => {
  const env = setup({ cloud: false });
  await env.selectAttachments([textFile('primo.txt', 'Verbale')]);
  env.document.activeElement = env.rows()[0].querySelector('select');
  await env.selectAttachments([textFile('secondo.txt', 'Verbale')]);
  const select = env.rows()[0].querySelector('select');
  assert.equal(select.focused, true, 'il menu del primo file resta attivo dopo il nuovo render');
  env.document.activeElement = env.rows()[0].querySelector('[data-remove-file]');
  await env.selectAttachments([textFile('terzo.txt', 'Verbale')]);
  assert.equal(env.rows()[0].querySelector('[data-remove-file]').focused, true);
});

test('la dashboard espone una scorciatoia diretta a Generazione documenti', () => {
  const start = html.indexOf('<section id="screen-home"');
  const end = html.indexOf('<section id="screen-new-inspection"', start);
  assert.ok(start >= 0 && end > start, 'sezione dashboard presente');
  const dashboard = html.slice(start, end);
  assert.match(dashboard, /class="dashboard-action-card primary-action document-generation-action" data-nav="document-generation" aria-label="Apri Generazione documenti"/);
  assert.match(dashboard, /<strong>Generazione documenti<\/strong>/);
  assert.match(dashboard, /Avvia il modulo DUVRI e raccogli checklist, documenti e dati dell'incarico/);
});

test('il controller è incluso nella shell precaricata della PWA dopo la configurazione', () => {
  const configAt = html.indexOf('src="js/supabase-config.js"');
  const controllerAt = html.indexOf('src="js/document-generation.js"');
  assert.ok(configAt > 0 && controllerAt > configAt, 'supabase-config.js deve precedere document-generation.js');
  assert.match(serviceWorker, /'\.\/js\/document-generation\.js'/);
});
