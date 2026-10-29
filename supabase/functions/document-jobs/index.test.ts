/**
 * Handler-level tests for document-jobs/index.ts with every outbound call faked.
 * No network, no permissions: Deno.env, Deno.serve and fetch are replaced before
 * the gateway module is imported. Hosts below are reserved .invalid names.
 */
import { assert, assertEquals } from './test-assert.ts';

const PROJECT = 'safety-checklist-colligo';
const SUPABASE = 'https://qa-supabase.invalid';
const env = new Map<string, string>([
  ['SUPABASE_URL', SUPABASE],
  ['SUPABASE_SERVICE_ROLE_KEY', 'qa-service-only'],
  ['SAFETYCHECKLIST_FIREBASE_API_KEY', 'qa-server-key']
]);
type Row = Record<string, unknown>;
const jobs = new Map<string, Row>();
const fileRows: Row[] = [];
const uploads: { path: string; mime: string }[] = [];
const insertedJobs: Row[] = [];
const patches: { query: string; body: Row }[] = [];
const lookupKeys: string[] = [];
const profiles: Record<string, string> = { owner: 'tecnico', other: 'tecnico', admin: 'admin' };
let beforePatch: ((id: string) => void) | null = null;

const realEnv = Deno.env;
const realServe = Deno.serve;
const realFetch = globalThis.fetch;
let handler: (req: Request) => Promise<Response>;

const jsonResponse = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
function b64url(value: unknown) {
  return btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function token(uid: string) {
  const now = Math.floor(Date.now() / 1000);
  return b64url({ alg: 'RS256' }) + '.' + b64url({ aud: PROJECT, iss: `https://securetoken.google.com/${PROJECT}`, sub: uid, iat: now - 5, exp: now + 600 }) + '.sig';
}
function uidOf(idToken: string) {
  return JSON.parse(atob(idToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).sub as string;
}

async function fakeFetch(input: string | URL | Request, init: RequestInit = {}): Promise<Response> {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  const method = (init.method || 'GET').toUpperCase();
  if (url.hostname === 'identitytoolkit.googleapis.com' && url.pathname.endsWith('/accounts:lookup')) {
    lookupKeys.push(url.searchParams.get('key') || '');
    const uid = uidOf(JSON.parse(String(init.body)).idToken);
    return jsonResponse({ users: [{ localId: uid }] });
  }
  if (url.hostname === 'firestore.googleapis.com') {
    const uid = decodeURIComponent(url.pathname.split('/').pop() || '');
    const role = profiles[uid];
    if (!role) return jsonResponse({}, 404);
    return jsonResponse({ fields: { uid: { stringValue: uid }, attivo: { booleanValue: true }, ruolo: { stringValue: role } } });
  }
  if (url.origin === SUPABASE && url.pathname.startsWith('/storage/v1/object/')) {
    if (method === 'POST') {
      uploads.push({ path: url.pathname.replace('/storage/v1/object/documenti-generati/', ''), mime: String((init.headers as Record<string, string>)['content-type']) });
      return jsonResponse({ Key: 'ok' });
    }
    return jsonResponse({});
  }
  if (url.origin === SUPABASE && url.pathname.startsWith('/rest/v1/')) {
    const table = url.pathname.slice('/rest/v1/'.length);
    const idFilter = url.searchParams.get('id')?.replace(/^eq\./, '');
    const statusFilter = url.searchParams.get('status')?.replace(/^eq\./, '');
    if (table === 'document_type_configs') {
      return url.searchParams.get('slug') === 'eq.duvri'
        ? jsonResponse([{ slug: 'duvri', display_name: 'DUVRI', enabled: true, skill_path: 'skills/duvri-colligo/SKILL.md', skill_version: 'duvri-colligo/0.1.0', template_object_path: 'templates/duvri.docx', template_version: 'DUVRI_BASE_GENERALE_2026', output_format: 'docx' }])
        : jsonResponse([]);
    }
    if (table === 'document_jobs' && method === 'POST') {
      const row = { ...(JSON.parse(String(init.body))[0] as Row), id: crypto.randomUUID(), created_at: new Date().toISOString() };
      insertedJobs.push(structuredClone(row));
      jobs.set(row.id as string, row);
      return jsonResponse([row], 201);
    }
    if (table === 'document_jobs' && method === 'PATCH') {
      const body = JSON.parse(String(init.body)) as Row;
      patches.push({ query: url.search, body });
      if (beforePatch && idFilter) beforePatch(idFilter);
      const row = idFilter ? jobs.get(idFilter) : undefined;
      if (!row || (statusFilter && row.status !== statusFilter)) return jsonResponse([]);
      Object.assign(row, body);
      return new Headers(init.headers).get('prefer')?.includes('return=representation') ? jsonResponse([row]) : new Response(null, { status: 204 });
    }
    if (table === 'document_jobs') {
      const row = idFilter ? jobs.get(idFilter) : undefined;
      return jsonResponse(row ? [row] : []);
    }
    if (table === 'document_job_files' && method === 'POST') {
      fileRows.push(...JSON.parse(String(init.body)));
      return new Response(null, { status: 201 });
    }
    if (table === 'document_job_files' || table === 'document_job_events') {
      return method === 'POST' ? new Response(null, { status: 201 }) : jsonResponse([]);
    }
  }
  throw new Error('Unexpected outbound request in test: ' + url.origin);
}

// deno-lint-ignore no-explicit-any
const D = Deno as any;
D.env = { get: (k: string) => env.get(k), set: (k: string, v: string) => env.set(k, v), delete: (k: string) => env.delete(k), has: (k: string) => env.has(k), toObject: () => Object.fromEntries(env) };
D.serve = (fn: (req: Request) => Promise<Response>) => { handler = fn; return { finished: Promise.resolve(), shutdown: async () => {}, ref() {}, unref() {}, addr: { hostname: '127.0.0.1', port: 0, transport: 'tcp' } }; };
globalThis.fetch = fakeFetch as typeof fetch;
const originalConsoleError = console.error;
const errors: string[] = [];
const captureErrors = (...args: unknown[]) => { errors.push(args.map(String).join(' ')); };
try {
  await import('./index.ts');
} finally {
  D.env = realEnv;
  D.serve = realServe;
}

async function call(action: string, uid: string | null, init: { method?: string; body?: BodyInit | Row; query?: Row } = {}) {
  const url = new URL('https://gateway.invalid/document-jobs');
  url.searchParams.set('action', action);
  for (const [k, v] of Object.entries(init.query || {})) url.searchParams.set(k, String(v));
  const headers: Record<string, string> = uid ? { authorization: 'Bearer ' + token(uid) } : {};
  let body: BodyInit | undefined;
  if (init.body instanceof FormData) body = init.body;
  else if (init.body !== undefined) { body = typeof init.body === 'string' ? init.body : JSON.stringify(init.body); headers['content-type'] = 'application/json'; }
  // Re-install the stubs for the duration of the call; restore afterwards.
  D.env = { get: (k: string) => env.get(k) };
  globalThis.fetch = fakeFetch as typeof fetch;
  console.error = captureErrors;
  try {
    const response = await handler(new Request(url, { method: init.method || (body ? 'POST' : 'GET'), headers, body }));
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  } finally {
    D.env = realEnv;
    globalThis.fetch = realFetch;
    console.error = originalConsoleError;
  }
}
function seedJob(status: string, extra: Row = {}) {
  const id = crypto.randomUUID();
  jobs.set(id, { id, created_by: 'owner', status, phase: 'extract', agent_outputs: {}, input_payload: {}, ...extra });
  return id;
}
const pdf = (name = 'checklist.pdf') => new File([new TextEncoder().encode('%PDF-1.7\n%test')], name, { type: 'application/pdf' });
function form(metadata: Row | string | null, files: { checklist?: File; extra?: File[] } = {}) {
  const data = new FormData();
  if (metadata !== null) data.set('metadata', typeof metadata === 'string' ? metadata : JSON.stringify(metadata));
  if (files.checklist) data.set('checklist', files.checklist, files.checklist.name);
  for (const file of files.extra || []) data.append('files', file, file.name);
  return data;
}

Deno.test('missing SAFETYCHECKLIST_FIREBASE_API_KEY fails closed with 503; OPTIONS and anonymous paths unchanged', async () => {
  env.delete('SAFETYCHECKLIST_FIREBASE_API_KEY');
  try {
    const before = lookupKeys.length;
    const r = await call('list', 'owner');
    assertEquals(r.status, 503);
    assertEquals(r.body.error, 'Configurazione server incompleta: chiave Firebase non impostata.');
    assertEquals(lookupKeys.length, before, 'no Identity Toolkit call without a key');
    assert(errors.some((line) => line.includes('SAFETYCHECKLIST_FIREBASE_API_KEY') && !line.includes('qa-server-key')));
    assertEquals((await call('list', null)).status, 401);
    const options = await handler(new Request('https://gateway.invalid/document-jobs', { method: 'OPTIONS', headers: { origin: 'https://leo12testa-jpg.github.io' } }));
    assertEquals(options.status, 204);
  } finally {
    env.set('SAFETYCHECKLIST_FIREBASE_API_KEY', 'qa-server-key');
  }
  const ok = await call('list', 'owner');
  assertEquals(ok.status, 200);
  assertEquals(lookupKeys.at(-1), 'qa-server-key');
});

Deno.test('status/download: non-owner technician gets 404, owner and admin get the job', async () => {
  const id = seedJob('queued');
  assertEquals((await call('status', 'other', { query: { id } })).status, 404);
  assertEquals((await call('download', 'other', { query: { id, file_id: crypto.randomUUID() } })).status, 404);
  assertEquals((await call('status', 'owner', { query: { id } })).status, 200);
  assertEquals((await call('status', 'admin', { query: { id } })).status, 200);
  assertEquals((await call('status', 'owner', { query: { id: 'not-a-uuid' } })).status, 400);
  assertEquals((await call('status', 'owner', { query: { id: crypto.randomUUID() } })).status, 404);
});

Deno.test('cancel/retry: invalid states 409, non-owner 404, valid transitions applied', async () => {
  const processing = seedJob('processing');
  assertEquals((await call('cancel', 'owner', { body: { id: processing } })).status, 409);
  assertEquals((await call('retry', 'owner', { body: { id: processing } })).status, 409);
  const queued = seedJob('queued');
  assertEquals((await call('cancel', 'other', { body: { id: queued } })).status, 404);
  assertEquals((await call('retry', 'owner', { body: { id: queued } })).status, 409);
  const cancelled = await call('cancel', 'owner', { body: { id: queued } });
  assertEquals(cancelled.status, 200);
  assertEquals(jobs.get(queued)?.status, 'cancelled');
  assertEquals((await call('cancel', 'owner', { body: { id: queued } })).status, 409);
  const failed = seedJob('error', { agent_outputs: { extraction: {}, analysis: {} }, attempt_count: 5 });
  const retried = await call('retry', 'owner', { body: { id: failed } });
  assertEquals(retried.body, { ok: true, status: 'queued', phase: 'draft' });
  assertEquals(jobs.get(failed)?.attempt_count, 0);
});

Deno.test('cancel is compare-and-set: a job claimed by the worker meanwhile is not overwritten', async () => {
  const id = seedJob('queued');
  beforePatch = (jobId) => { const row = jobs.get(jobId); if (row) row.status = 'processing'; };
  try {
    const r = await call('cancel', 'owner', { body: { id } });
    assertEquals(r.status, 409);
    assertEquals(jobs.get(id)?.status, 'processing');
  } finally {
    beforePatch = null;
  }
});

Deno.test('review: technician 403 even on own job, wrong state 409, bad decision 400, admin approves', async () => {
  const id = seedJob('needs_review', { phase: 'review' });
  assertEquals((await call('review', 'owner', { body: { id, decision: 'approved' } })).status, 403);
  assertEquals((await call('review', 'admin', { body: { id, decision: 'maybe' } })).status, 400);
  const queued = seedJob('queued');
  assertEquals((await call('review', 'admin', { body: { id: queued, decision: 'approved' } })).status, 409);
  const ok = await call('review', 'admin', { body: { id, decision: 'changes_requested', comment: 'Integrare POS' } });
  assertEquals(ok.body, { ok: true, status: 'awaiting_input' });
  assertEquals(jobs.get(id)?.review_decision, 'changes_requested');
});

Deno.test('malformed action bodies are 400, never a leaked 503 TypeError', async () => {
  for (const body of ['null', '[]', '"x"', '{not json']) {
    const r = await call('cancel', 'owner', { body });
    assertEquals(r.status, 400, body);
    assertEquals(r.body.error, 'Identificativo lavoro non valido.');
  }
  assertEquals((await call('cancel', 'owner', { body: { id: 12345 } })).status, 400);
  assertEquals((await call('nope', 'owner', { body: {} })).status, 400);
});

Deno.test('create: consent required when DOCUMENT_PIPELINE_ENABLED=true', async () => {
  env.set('DOCUMENT_PIPELINE_ENABLED', 'true');
  try {
    const before = insertedJobs.length;
    const missing = await call('create', 'owner', { body: form({ documentType: 'duvri' }, { checklist: pdf() }) });
    assertEquals(missing.status, 400);
    assert(String(missing.body.error).includes('confermare il trasferimento'));
    const wrongType = await call('create', 'owner', { body: form({ documentType: 'duvri', aiDataProcessingConsent: 'yes' }, { checklist: pdf() }) });
    assertEquals(wrongType.status, 400);
    assertEquals(insertedJobs.length, before);
    const ok = await call('create', 'owner', { body: form({ documentType: 'duvri', aiDataProcessingConsent: true }, { checklist: pdf() }) });
    assertEquals(ok.status, 201);
  } finally {
    env.delete('DOCUMENT_PIPELINE_ENABLED');
  }
});

Deno.test('create: incomplete or invalid input is rejected before any job row or upload', async () => {
  const before = { jobs: insertedJobs.length, uploads: uploads.length };
  const cases: [FormData, number][] = [
    [form({ title: 'x' }), 400],
    [form('{broken', { checklist: pdf() }), 400],
    [form({ documentType: 'pem' }, { checklist: pdf() }), 400],
    [form({ documentType: 7 }, { checklist: pdf() }), 400],
    [form({}, { checklist: new File([new Uint8Array(0)], 'vuoto.pdf') }), 400],
    [form({}, { checklist: new File([new TextEncoder().encode('MZ')], 'tool.exe') }), 415],
    [form({}, { checklist: new File([new TextEncoder().encode('<html>')], 'finto.pdf', { type: 'application/pdf' }) }), 415],
    [form({}, { checklist: pdf(), extra: Array.from({ length: 12 }, (_, i) => new File([new TextEncoder().encode('ok')], `n${i}.txt`)) }), 413]
  ];
  for (const [data, expected] of cases) assertEquals((await call('create', 'owner', { body: data })).status, expected);
  const notMultipart = await call('create', 'owner', { body: { metadata: {} } });
  assertEquals(notMultipart.status, 415);
  const dvr = await call('create', 'owner', { body: form({ documentType: 'dvr' }, { checklist: pdf() }) });
  assertEquals(dvr.status, 400, 'dvr is a known type but not enabled in document_type_configs');
  assertEquals(insertedJobs.length, before.jobs);
  assertEquals(uploads.length, before.uploads);
});

Deno.test('create: job held until files are stored, payload/template version and file rows match the worker contract', async () => {
  const csv = new File([new TextEncoder().encode('a;b\n1;2')], 'dati.csv', { type: 'application/vnd.ms-excel' });
  const r = await call('create', 'owner', { body: form({ documentType: 'duvri', title: ' Cantiere A ' }, { checklist: pdf('../../etc/passwd.pdf'), extra: [csv] }) });
  assertEquals(r.status, 201);
  assertEquals(r.body.job.status, 'queued');
  assertEquals(r.body.job.title, 'Cantiere A');
  const inserted = insertedJobs.at(-1) as Row;
  assert(typeof inserted.next_attempt_at === 'string' && Date.parse(inserted.next_attempt_at as string) > Date.now(), 'new job must not be claimable during upload');
  assertEquals((inserted.input_payload as Row).templateVersion, 'DUVRI_BASE_GENERALE_2026');
  assertEquals(jobs.get(inserted.id as string)?.next_attempt_at, null);
  const rows = fileRows.filter((row) => row.job_id === inserted.id);
  assertEquals(rows.map((row) => row.role), ['checklist', 'supporting']);
  assertEquals(rows.map((row) => row.mime_type), ['application/pdf', 'text/csv']);
  for (const row of rows) {
    const path = String(row.object_path);
    assert(path.startsWith(`owner/${inserted.id}/`), path);
    assert(!path.split('/').includes('..'), path);
  }
  assertEquals(uploads.filter((u) => u.path.includes(String(inserted.id))).map((u) => u.mime), ['application/pdf', 'text/csv']);
});

