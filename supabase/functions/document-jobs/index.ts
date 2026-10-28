/**
 * SafetyChecklist document job gateway.
 *
 * Draft backend implementation. Not deployed. Uses Firebase Authentication/Firestore
 * for app identity and Supabase service-role access only on the server.
 */
const SUPABASE_URL = (Deno.env.get('SUPABASE_URL') || '').replace(/\/$/, '');
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const FIREBASE_PROJECT = Deno.env.get('SAFETYCHECKLIST_FIREBASE_PROJECT_ID') || 'safety-checklist-colligo';
const FIREBASE_API_KEY = Deno.env.get('SAFETYCHECKLIST_FIREBASE_API_KEY') || 'AIzaSyAdgCc8TQ1TVfF8l0NMxtm7NS95ZOl4lCA';
const ALLOWED_ORIGINS = new Set([
  'https://leo12testa-jpg.github.io',
  'http://127.0.0.1:4173',
  'http://localhost:4173'
]);
const BUCKET = 'documenti-generati';
const MAX_FILES = 12;
const MAX_FILE_BYTES = 18 * 1024 * 1024;
const MAX_TOTAL_BYTES = 45 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set(['.pdf','.docx','.doc','.xlsx','.xls','.csv','.json','.txt','.png','.jpg','.jpeg']);
const ALLOWED_MIME = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/plain',
  'text/csv',
  'application/json',
  'image/png',
  'image/jpeg',
  'application/octet-stream'
]);

type Actor = { uid: string; role: 'admin' | 'tecnico'; token: string };
type JobRow = Record<string, unknown> & { id: string; created_by: string; status: string };

function responseHeaders(req: Request, more: Record<string,string> = {}) {
  const origin = req.headers.get('origin') || '';
  return {
    ...(origin && ALLOWED_ORIGINS.has(origin) ? { 'access-control-allow-origin': origin } : {}),
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'cache-control': 'private, no-store',
    'x-content-type-options': 'nosniff',
    vary: 'Origin',
    ...more
  };
}
function json(req: Request, payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: responseHeaders(req, { 'content-type': 'application/json; charset=utf-8' })
  });
}
function fail(status: number, message: string): never {
  throw Object.assign(new Error(message), { status });
}
async function fetchTimeout(url: string, init: RequestInit = {}, timeout = 30000) {
  return await fetch(url, { ...init, signal: AbortSignal.timeout(timeout) });
}
function decodeFirestore(value: any): any {
  if (!value || typeof value !== 'object') return null;
  if ('stringValue' in value) return value.stringValue;
  if ('booleanValue' in value) return value.booleanValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return Number(value.doubleValue);
  if ('timestampValue' in value) return value.timestampValue;
  if ('nullValue' in value) return null;
  if ('mapValue' in value) return Object.fromEntries(
    Object.entries(value.mapValue.fields || {}).map(([key, item]) => [key, decodeFirestore(item)])
  );
  if ('arrayValue' in value) return (value.arrayValue.values || []).map(decodeFirestore);
  return null;
}
async function authenticate(req: Request): Promise<Actor> {
  const header = req.headers.get('authorization') || '';
  if (!header.startsWith('Bearer ') || header.length > 10000) fail(401, 'Accesso richiesto.');
  const token = header.slice(7);
  let claims: any;
  try {
    claims = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
  } catch {
    fail(401, 'Sessione non valida.');
  }
  if (
    claims.aud !== FIREBASE_PROJECT ||
    claims.iss !== `https://securetoken.google.com/${FIREBASE_PROJECT}` ||
    typeof claims.sub !== 'string' || !claims.sub ||
    !Number.isFinite(claims.exp) || claims.exp <= Date.now() / 1000 ||
    !Number.isFinite(claims.iat)
  ) fail(401, 'Sessione non valida o scaduta.');

  const lookup = await fetchTimeout(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(FIREBASE_API_KEY)}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ idToken: token })
    }
  );
  if (!lookup.ok) fail(401, 'Sessione non valida.');
  const account = (await lookup.json()).users?.[0];
  if (!account?.localId || account.disabled || account.localId !== claims.sub) fail(401, 'Account non valido.');

  const profileResponse = await fetchTimeout(
    `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/utenti/${encodeURIComponent(account.localId)}`,
    { headers: { authorization: `Bearer ${token}` } }
  );
  if ([401, 403, 404].includes(profileResponse.status)) fail(403, 'Account non autorizzato.');
  if (!profileResponse.ok) fail(503, 'Verifica account temporaneamente non disponibile.');
  const profile = decodeFirestore({ mapValue: { fields: (await profileResponse.json()).fields } });
  if (
    !profile ||
    profile.uid !== account.localId ||
    profile.attivo !== true ||
    !['admin','tecnico'].includes(profile.ruolo)
  ) fail(403, 'Account non attivo o non autorizzato.');
  return { uid: account.localId, role: profile.ruolo, token };
}
function dbHeaders(extra: Record<string,string> = {}) {
  return {
    apikey: SERVICE_KEY,
    authorization: `Bearer ${SERVICE_KEY}`,
    'content-type': 'application/json',
    ...extra
  };
}
async function db(path: string, init: RequestInit = {}) {
  if (!SUPABASE_URL || !SERVICE_KEY) fail(503, 'Backend documentale non configurato.');
  const response = await fetchTimeout(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: dbHeaders((init.headers || {}) as Record<string,string>)
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    console.error('[document-jobs] database request failed', response.status, detail.slice(0, 300));
    fail(503, 'Registro documentale temporaneamente non disponibile.');
  }
  if (response.status === 204) return null;
  const raw = await response.text();
  return raw ? JSON.parse(raw) : null;
}
function safeName(name: string) {
  const base = name.normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
  if (!base || base === '.' || base === '..') fail(400, 'Nome file non valido.');
  return base;
}
function extension(name: string) {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot).toLowerCase() : '';
}
function mimeFor(file: File) {
  const supplied = (file.type || '').split(';')[0].trim().toLowerCase();
  if (supplied && supplied !== 'application/octet-stream' && ALLOWED_MIME.has(supplied)) return supplied;
  const byExtension: Record<string,string> = {
    '.pdf': 'application/pdf',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.doc': 'application/msword',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.xls': 'application/vnd.ms-excel',
    '.csv': 'text/csv',
    '.json': 'application/json',
    '.txt': 'text/plain',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg'
  };
  return byExtension[extension(file.name)] || supplied || 'application/octet-stream';
}
function validateFile(file: File) {
  const ext = extension(file.name);
  const mime = mimeFor(file);
  if (!ALLOWED_EXTENSIONS.has(ext) || !ALLOWED_MIME.has(mime)) fail(415, `Formato file non supportato: ${safeName(file.name)}.`);
  if (file.size <= 0 || file.size > MAX_FILE_BYTES) fail(413, 'Ogni file deve pesare meno di 18 MB.');
}
async function digest(bytes: Uint8Array) {
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2,'0')).join('');
}
function storagePath(path: string) {
  return path.split('/').map((part) => encodeURIComponent(part)).join('/');
}
async function storageUpload(path: string, bytes: Uint8Array, mime: string) {
  const response = await fetchTimeout(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${storagePath(path)}`, {
    method: 'POST',
    headers: dbHeaders({ 'content-type': mime, 'x-upsert': 'false', 'cache-control': 'private, max-age=0' }),
    body: bytes
  }, 60000);
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    console.error('[document-jobs] private upload failed', response.status, detail.slice(0, 300));
    fail(503, 'Caricamento privato non riuscito; il lavoro non è stato avviato.');
  }
}
async function storageDelete(paths: string[]) {
  if (!paths.length) return;
  await fetchTimeout(`${SUPABASE_URL}/storage/v1/object/${BUCKET}`, {
    method: 'DELETE',
    headers: dbHeaders(),
    body: JSON.stringify({ prefixes: paths })
  }, 30000).catch(() => {});
}
function ownerFilter(actor: Actor, job: JobRow) {
  if (actor.role === 'admin') return;
  if (job.created_by !== actor.uid) fail(404, 'Lavoro documentale non trovato.');
}
async function findJob(id: string, actor: Actor): Promise<JobRow> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) fail(400, 'Identificativo lavoro non valido.');
  const rows = await db(`document_jobs?id=eq.${encodeURIComponent(id)}&select=*`) as JobRow[];
  const job = rows?.[0];
  if (!job) fail(404, 'Lavoro documentale non trovato.');
  ownerFilter(actor, job);
  return job;
}
async function event(jobId: string, actor: string | null, phase: string, type: string, message: string, details: Record<string,unknown> = {}) {
  await db('document_job_events', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify([{ job_id: jobId, actor_uid: actor, phase, event_type: type, message, details }])
  });
}
async function createJob(req: Request, actor: Actor, form: FormData) {
  const intakeString = form.get('metadata');
  let metadata: Record<string,unknown> = {};
  if (typeof intakeString === 'string' && intakeString.trim()) {
    try { metadata = JSON.parse(intakeString); } catch { fail(400, 'Metadati della checklist non validi.'); }
  }
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) fail(400, 'Metadati della checklist non validi.');
  if (JSON.stringify(metadata).length > 80000) fail(413, 'Metadati troppo voluminosi.');
  const checklist = form.get('checklist');
  if (!(checklist instanceof File)) fail(400, 'Carica la checklist compilata.');
  const support = form.getAll('files').filter((item): item is File => item instanceof File && item.size > 0);
  const files = [checklist, ...support];
  if (files.length > MAX_FILES) fail(413, 'Sono ammessi al massimo 12 file per lavoro.');
  let total = 0;
  for (const file of files) {
    validateFile(file);
    total += file.size;
    if (total > MAX_TOTAL_BYTES) fail(413, 'La dimensione totale dei file supera 45 MB.');
  }
  const title = typeof metadata.title === 'string' ? metadata.title.trim().slice(0, 180) : '';
  const payload = {
    title,
    siteType: typeof metadata.siteType === 'string' ? metadata.siteType.slice(0, 80) : 'unknown',
    complexity: typeof metadata.complexity === 'string' ? metadata.complexity.slice(0, 40) : 'to_be_assessed',
    fields: metadata
  };
  const created = await db('document_jobs', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify([{
      created_by: actor.uid,
      created_by_role: actor.role,
      document_type: 'duvri',
      title,
      status: 'queued',
      phase: 'extract',
      status_message: 'Checklist ricevuta; in attesa di elaborazione cloud.',
      input_payload: payload,
      template_version: 'DUVRI_BASE_GENERALE_2026',
      skill_version: 'duvri-colligo/0.1.0'
    }])
  }) as JobRow[];
  const job = created?.[0];
  if (!job?.id) fail(503, 'Impossibile creare il lavoro documentale.');

  const uploadedPaths: string[] = [];
  try {
    const fileRows = [];
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      const fileBytes = new Uint8Array(await file.arrayBuffer());
      const filename = safeName(file.name);
      const role = index === 0 ? 'checklist' : 'supporting';
      const path = `${actor.uid}/${job.id}/${String(index + 1).padStart(2,'0')}_${filename}`;
      const mimeType = mimeFor(file);
      await storageUpload(path, fileBytes, mimeType);
      uploadedPaths.push(path);
      fileRows.push({
        job_id: job.id,
        uploaded_by: actor.uid,
        role,
        object_path: path,
        filename,
        mime_type: mimeFor(file),
        size_bytes: file.size,
        sha256: await digest(fileBytes)
      });
    }
    await db('document_job_files', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify(fileRows)
    });
    await db(`document_jobs?id=eq.${encodeURIComponent(job.id)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ updated_at: new Date().toISOString(), status_message: 'Checklist e allegati salvati in archivio privato. In coda.' })
    });
    await event(job.id, actor.uid, 'extract', 'created', 'Lavoro documentale creato e allegati archiviati.', { file_count: files.length, total_bytes: total });
    return json(req, { job: { id: job.id, status: 'queued', phase: 'extract', title, created_at: job.created_at }, message: 'Lavoro salvato. Il browser può essere chiuso dopo la conferma; l’elaborazione richiede che il worker cloud sia configurato e attivo.' }, 201);
  } catch (error) {
    await storageDelete(uploadedPaths);
    await db(`document_jobs?id=eq.${encodeURIComponent(job.id)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ status: 'error', status_message: 'Caricamento allegati non completato.', updated_at: new Date().toISOString() })
    }).catch(() => {});
    throw error;
  }
}
async function listJobs(req: Request, actor: Actor) {
  const filter = actor.role === 'admin' ? '' : `&created_by=eq.${encodeURIComponent(actor.uid)}`;
  const rows = await db(`document_jobs?select=id,created_by,document_type,title,status,phase,status_message,created_at,updated_at,completed_at,review_decision&order=created_at.desc&limit=50${filter}`) as Record<string,unknown>[];
  return json(req, { jobs: rows || [] });
}
async function statusJob(req: Request, actor: Actor, id: string) {
  const job = await findJob(id, actor);
  const files = await db(`document_job_files?job_id=eq.${encodeURIComponent(id)}&select=id,role,filename,mime_type,size_bytes,created_at&order=created_at.asc`) as Record<string,unknown>[];
  const events = await db(`document_job_events?job_id=eq.${encodeURIComponent(id)}&select=agent,phase,event_type,message,created_at&order=created_at.asc&limit=100`) as Record<string,unknown>[];
  return json(req, { job, files: files || [], events: events || [] });
}
async function downloadFile(req: Request, actor: Actor, id: string, fileId: string) {
  const job = await findJob(id, actor);
  if (!/^[0-9a-f-]{36}$/i.test(fileId)) fail(400, 'Identificativo file non valido.');
  const rows = await db(`document_job_files?id=eq.${encodeURIComponent(fileId)}&job_id=eq.${encodeURIComponent(job.id)}&select=id,filename,mime_type,object_path`) as Record<string,unknown>[];
  const file = rows?.[0];
  if (!file || typeof file.object_path !== 'string') fail(404, 'File non trovato.');
  const response = await fetchTimeout(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${storagePath(file.object_path)}`, {
    headers: dbHeaders()
  }, 60000);
  if (!response.ok) fail(response.status === 404 ? 404 : 503, 'File non disponibile.');
  const name = safeName(String(file.filename || 'documento.bin'));
  return new Response(response.body, {
    headers: responseHeaders(req, {
      'content-type': String(file.mime_type || 'application/octet-stream'),
      'content-disposition': `attachment; filename="${name}"`,
      'content-length': response.headers.get('content-length') || ''
    })
  });
}
async function cancelJob(req: Request, actor: Actor, id: string) {
  const job = await findJob(id, actor);
  if (!['queued','retry_wait','awaiting_input','awaiting_configuration'].includes(job.status)) fail(409, 'Questo lavoro non può essere annullato nella fase corrente.');
  await db(`document_jobs?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ status: 'cancelled', status_message: 'Lavoro annullato dall’utente.', updated_at: new Date().toISOString(), lease_until: null, claim_token: null })
  });
  await event(id, actor.uid, String(job.phase || 'review'), 'review', 'Lavoro annullato.', {});
  return json(req, { ok: true, status: 'cancelled' });
}
async function reviewJob(req: Request, actor: Actor, body: any, id: string) {
  if (actor.role !== 'admin') fail(403, 'La revisione finale è riservata a un amministratore autorizzato.');
  const job = await findJob(id, actor);
  if (job.status !== 'needs_review') fail(409, 'Il documento non è in attesa di revisione.');
  const decision = String(body.decision || '');
  if (!['approved','changes_requested','rejected'].includes(decision)) fail(400, 'Decisione di revisione non valida.');
  const status = decision === 'approved' ? 'approved' : decision === 'rejected' ? 'rejected' : 'awaiting_input';
  const message = typeof body.comment === 'string' ? body.comment.trim().slice(0, 2000) : '';
  const priorPayload = job.input_payload && typeof job.input_payload === 'object' ? job.input_payload as Record<string,unknown> : {};
  await db(`document_jobs?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      status,
      status_message: decision === 'approved' ? 'Revisione umana registrata come approvata.' : decision === 'rejected' ? 'Documento rifiutato in revisione.' : 'Modifiche/dati aggiuntivi richiesti.',
      review_decision: decision,
      reviewed_by: actor.uid,
      reviewed_at: new Date().toISOString(),
      input_payload: { ...priorPayload, review: { decision, comment: message } },
      updated_at: new Date().toISOString(),
      completed_at: decision === 'approved' ? new Date().toISOString() : null
    })
  });
  await event(id, actor.uid, 'review', 'review', 'Esito della revisione umana registrato.', { decision });
  return json(req, { ok: true, status });
}
Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin') || '';
  if (origin && !ALLOWED_ORIGINS.has(origin)) return json(req, { error: 'Origine non consentita.' }, 403);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: responseHeaders(req) });
  if (!['GET','POST'].includes(req.method)) return json(req, { error: 'Metodo non consentito.' }, 405);
  try {
    if (!SUPABASE_URL || !SERVICE_KEY) fail(503, 'Backend documentale non configurato.');
    const actor = await authenticate(req);
    const url = new URL(req.url);
    const action = url.searchParams.get('action') || '';
    if (req.method === 'GET') {
      if (action === 'list') return await listJobs(req, actor);
      if (action === 'status') return await statusJob(req, actor, url.searchParams.get('id') || '');
      if (action === 'download') return await downloadFile(req, actor, url.searchParams.get('id') || '', url.searchParams.get('file_id') || '');
      return json(req, { error: 'Azione non riconosciuta.' }, 400);
    }
    if (action === 'create') {
      if (!(req.headers.get('content-type') || '').includes('multipart/form-data')) fail(415, 'Usa multipart/form-data per checklist e allegati.');
      const form = await req.formData();
      return await createJob(req, actor, form);
    }
    const body = await req.json().catch(() => ({}));
    const id = String(body.id || '');
    if (action === 'cancel') return await cancelJob(req, actor, id);
    if (action === 'review') return await reviewJob(req, actor, body, id);
    return json(req, { error: 'Azione non riconosciuta.' }, 400);
  } catch (error: any) {
    const status = Number(error?.status) || 503;
    const message = status < 500 ? String(error.message || 'Richiesta non valida.') : String(error.message || 'Servizio documentale non disponibile.');
    return json(req, { error: message }, status);
  }
});
