// Test comportamentali della schermata "Generazione documenti".
// js/document-generation.js viene eseguito in un contesto vm con un DOM minimo costruito
// dal markup reale di index.html (sezione data-screen="document-generation"), un fetch
// spia e un appIdentity finto. Nessuna chiamata di rete reale viene effettuata.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const controllerSource = fs.readFileSync(path.join(root, 'js', 'document-generation.js'), 'utf8');
const configSource = fs.readFileSync(path.join(root, 'js', 'supabase-config.js'), 'utf8');
const serviceWorker = fs.readFileSync(path.join(root, 'service-worker.js'), 'utf8');

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
    this.dataset = {};
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
    if (this.tagName === 'OPTION' && !('value' in this.attributes)) return this.textContent;
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
  for (let node = target; node; node = node.parentNode) chain.push(node);
  const doc = chain.map((node) => node.ownerDocument).find(Boolean);
  if (doc) chain.push(doc);
  chain.forEach((node) => (node.listeners[type] || []).forEach((cb) => cb(event)));
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

function fakeFile(name, size = 2048, type = 'application/pdf', content = 'CONTENUTO-RISERVATO-NON-ESPORTARE') {
  return { name, size, type, lastModified: 1760000000000, content };
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
  const context = {
    console, setTimeout: () => 0, clearTimeout() {},
    URL: Object.assign(function (u) { return new URL(u); }, {
      createObjectURL: () => 'blob:test', revokeObjectURL() {}
    }),
    Blob: class { constructor(parts, opts) { this.parts = parts; this.type = opts && opts.type; blobs.push(this); } },
    FormData: FakeFormData,
    crypto: { randomUUID: () => '00000000-0000-4000-8000-000000000001' },
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
    selectChecklist(file) {
      const input = $('dg-checklist-file');
      input.files = file ? [file] : [];
      dispatch(input, 'change');
    },
    selectAttachments(files) {
      const input = $('dg-files');
      input.files = files;
      dispatch(input, 'change');
    },
    submit() { return dispatch(form, 'submit'); },
    status: () => $('dg-cloud-status').textContent,
    queueText: () => $('dg-queue-list').textContent,
    exportedRecord() {
      $('dg-download-json').click();
      const blob = blobs[blobs.length - 1];
      assert.ok(blob, 'nessuna esportazione JSON prodotta');
      return { text: blob.parts.join(''), record: JSON.parse(blob.parts.join('')) };
    }
  };
}

// ---------------------------------------------------------------- Struttura
test('la schermata è raggiungibile dal menu e contiene gli elementi usati dal controller', () => {
  const env = setup({ cloud: false });
  assert.equal(env.screen.dataset.screen, 'document-generation');
  assert.equal(env.nav.dataset.nav, 'document-generation');
  const ids = [...new Set([...controllerSource.matchAll(/getElementById\('([^']+)'\)/g)].map((m) => m[1]))];
  assert.ok(ids.length >= 15);
  for (const id of ids) assert.ok(env.$(id), 'elemento #' + id + ' richiesto dal controller ma assente in index.html');
  const checklist = env.$('dg-checklist-file');
  assert.equal(checklist.required, true, 'la checklist compilata deve essere obbligatoria');
  assert.equal(checklist.type, 'file');
  assert.equal(env.$('dg-files').hasAttribute('multiple'), true);
  const agents = env.screen.querySelectorAll('[data-agent]').map((el) => el.dataset.agent);
  assert.deepEqual(agents, ['coordinator', 'document-reader', 'duvri-analyst', 'docx-writer', 'quality-check']);
  const consent = env.form.querySelector('[name="aiDataProcessingConsent"]');
  assert.equal(consent.type, 'checkbox');
  assert.equal(consent.checked, false, 'il consenso al provider AI non deve essere preselezionato');
  assert.match(consent.parentNode.textContent, /costi separati dall'abbonamento ChatGPT o Claude/i);
  const enabledTypes = env.form.querySelector('[name="documentType"]').querySelectorAll('option').filter((o) => !o.disabled).map((o) => o.value);
  assert.deepEqual(enabledTypes, ['duvri'], 'solo il DUVRI è generabile in questa versione');
});

test('la configurazione pubblicata mantiene il cloud disattivato e nessuna richiesta parte al caricamento', async () => {
  const env = setup({ useRealConfig: true });
  assert.equal(vm.runInContext('DOCUMENT_GENERATION_CLOUD_ENABLED', env.context), false);
  await flush();
  assert.equal(env.calls.length, 0);
  assert.match(env.status(), /Backend cloud non attivo/);
  assert.match(env.screen.querySelector('.dg-prototype-alert p').textContent, /non sono ancora attivi/);
  assert.match(env.queueText(), /Coda cloud non attiva/);
});

test('con il cloud disattivato la scheda viene preparata solo in locale, senza rete né contenuto dei file', async () => {
  for (const cloud of [false, undefined]) {
    const env = setup({ cloud });
    env.fill({ title: 'DUVRI Magazzino Nord', clientName: 'Cliente Srl', site: 'Via Roma 1', siteType: 'internal_area', aiDataProcessingConsent: true });
    env.selectChecklist(fakeFile('checklist-duvri.xlsx', 4096, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'));
    env.selectAttachments([fakeFile('DVR specifico.pdf'), fakeFile('cronoprogramma.pdf')]);
    assert.match(env.$('dg-checklist-file-status').textContent, /checklist-duvri\.xlsx · 4 KB/);
    assert.equal(env.$('dg-files-list').children.length, 2);

    const event = env.submit();
    await flush();
    assert.equal(event.defaultPrevented, true);
    assert.equal(env.calls.length, 0, 'nessuna richiesta di rete con cloud disattivato');
    assert.equal(env.$('dg-result').hidden, false);
    assert.equal(env.$('dg-result-title').textContent, 'Scheda dati pronta per il test');
    assert.match(env.status(), /nessun agente è stato avviato/);

    const { text, record } = env.exportedRecord();
    assert.equal(record.cloudSubmission, false);
    assert.equal(record.aiGenerationStarted, false);
    assert.equal(record.humanReviewRequired, true);
    assert.equal(record.prototypeStatus, 'local-intake-only');
    assert.equal(record.sourceChecklist.name, 'checklist-duvri.xlsx');
    assert.equal(record.sourceChecklist.contentIncluded, false);
    assert.deepEqual(record.documents.map((d) => [d.name, d.contentIncluded]), [['DVR specifico.pdf', false], ['cronoprogramma.pdf', false]]);
    assert.deepEqual(record.workflow.map((s) => s.agent), ['coordinator', 'document-reader', 'duvri-analyst', 'docx-writer', 'quality-check']);
    assert.ok(record.workflow.every((s) => s.status === 'not_connected'));
    assert.ok(!text.includes('CONTENUTO-RISERVATO'), 'il contenuto dei file non deve finire nell\'esportazione');
    assert.ok(!text.includes('TEST-ID-TOKEN'));
  }
});

test('senza checklist il modulo non viene inviato (né in locale né al cloud)', async () => {
  for (const cloud of [false, true]) {
    const env = setup({ cloud, respond: () => jsonResponse({ jobs: [] }) });
    env.fill({ aiDataProcessingConsent: true });
    env.submit();
    await flush();
    assert.equal(env.$('dg-result').hidden, true);
    assert.equal(env.calls.filter((c) => c.action === 'create').length, 0);
  }
});

test('le date incoerenti bloccano la preparazione con un messaggio', async () => {
  const env = setup({ cloud: false });
  env.selectChecklist(fakeFile('checklist.pdf'));
  env.fill({ startDate: '2026-11-10', endDate: '2026-11-01' });
  env.submit();
  await flush();
  assert.deepEqual(env.alerts, ['La data di fine lavori non può precedere la data di inizio.']);
  assert.equal(env.form.querySelector('[name="endDate"]').focused, true);
  assert.equal(env.$('dg-result').hidden, true);
});

test('le lacune segnalano consenso, dati mancanti e documenti di supporto non presenti', async () => {
  const env = setup({ cloud: false });
  env.selectChecklist(fakeFile('checklist.pdf'));
  env.fill({ 'modules': true });
  env.submit();
  await flush();
  const missing = env.$('dg-missing-list').children.map((li) => li.textContent);
  for (const expected of [/Titolo esatto del DUVRI/, /Consenso al trasferimento/, /Impresa 1: ragione sociale/, /DVR specifico/, /Cronoprogramma/, /Planimetria/]) {
    assert.ok(missing.some((t) => expected.test(t)), 'lacuna attesa: ' + expected);
  }
  assert.match(env.$('dg-result-summary').textContent, /1 scheda impresa · 0 allegati di supporto/);
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
  env.selectChecklist(fakeFile('checklist.pdf'));
  env.submit();
  await flush();
  assert.equal(env.created.length, 0);
  assert.match(env.status(), /devi confermare il consenso/);
  assert.equal(env.form.querySelector('[name="aiDataProcessingConsent"]').focused, true);
});

test('con il cloud attivo e consenso la checklist viene caricata con token e metadati', async () => {
  const env = await cloudEnv();
  env.fill({ title: 'DUVRI Test', aiDataProcessingConsent: true, siteType: 'mixed' });
  env.selectChecklist(fakeFile('checklist.docx'));
  env.selectAttachments([fakeFile('planimetria.pdf')]);
  env.submit();
  await flush();
  assert.equal(env.created.length, 1);
  const call = env.created[0];
  assert.equal(call.url.origin + call.url.pathname, ENDPOINT);
  assert.equal(call.init.method, 'POST');
  assert.equal(call.init.headers.authorization, 'Bearer TEST-ID-TOKEN');
  assert.equal(call.init.headers['content-type'], undefined, 'multipart: il browser imposta il boundary');
  const body = call.init.body;
  assert.ok(body instanceof env.context.FormData);
  const metadata = JSON.parse(body.get('metadata'));
  assert.equal(metadata.aiDataProcessingConsent, true);
  assert.equal(metadata.documentType, 'duvri');
  assert.equal(metadata.siteType, 'mixed');
  assert.equal(metadata.title, 'DUVRI Test');
  assert.equal(body.get('checklist').name, 'checklist.docx');
  assert.deepEqual(body.getAll('files').map((f) => f.name), ['planimetria.pdf']);
  assert.match(env.$('dg-result-summary').textContent, /ID job-123 · stato: In coda/);
  assert.equal(env.status().length > 0, true);
  assert.equal(env.form.querySelector('button[type="submit"]').disabled, false);
});

test('gli errori del gateway sono mostrati come messaggi leggibili', async () => {
  const cases = [
    [() => jsonResponse({ error: 'Ruolo non autorizzato alla generazione documentale.' }, 403), 'Ruolo non autorizzato alla generazione documentale.'],
    [() => textResponse('<html>Bad gateway</html>', 502), 'Richiesta documentale non riuscita.'],
    [() => textResponse('ok', 200), 'Risposta del backend non valida.'],
    [() => { throw new Error('Rete non disponibile'); }, 'Rete non disponibile']
  ];
  for (const [respond, expected] of cases) {
    const env = await cloudEnv({ respond });
    env.fill({ aiDataProcessingConsent: true });
    env.selectChecklist(fakeFile('checklist.pdf'));
    env.submit();
    await flush();
    assert.equal(env.status(), expected);
    assert.ok(!env.status().includes('<html>'));
    const submit = env.form.querySelector('button[type="submit"]');
    assert.equal(submit.disabled, false, 'il pulsante torna utilizzabile dopo un errore');
  }
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
test('il controller è incluso nella shell precaricata della PWA dopo la configurazione', () => {
  const configAt = html.indexOf('src="js/supabase-config.js"');
  const controllerAt = html.indexOf('src="js/document-generation.js"');
  assert.ok(configAt > 0 && controllerAt > configAt, 'supabase-config.js deve precedere document-generation.js');
  assert.match(serviceWorker, /'\.\/js\/document-generation\.js'/);
});
