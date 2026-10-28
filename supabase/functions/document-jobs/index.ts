/**
 * SafetyChecklist document job gateway.
 *
 * Draft backend implementation. Not deployed. Uses Firebase Authentication/Firestore
 * for app identity and Supabase service-role access only on the server.
 */
import {
  assertCancellable,
  assertFileId,
  assertJobAccess,
  assertJobId,
  assertRetryable,
  assertReviewer,
  buildInputPayload,
  collectUploadFiles,
  contentMatchesExtension,
  errorResponse,
  fail,
  jobTitle,
  normalizeActionBody,
  parseMetadata,
  planReview,
  requestedDocumentType,
  retryPhase,
  safeName,
  storageObjectPath,
  validateFile
} from './validation.ts';

const SUPABASE_URL = (Deno.env.get('SUPABASE_URL') || '').replace(/\/$/, '');
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const FIREBASE_PROJECT = Deno.env.get('SAFETYCHECKLIST_FIREBASE_PROJECT_ID') || 'safety-checklist-colligo';
const ALLOWED_ORIGINS = new Set([
  'https://leo12testa-jpg.github.io',
  'http://127.0.0.1:4173',
  'http://localhost:4173'
]);
const BUCKET = 'documenti-generati';
const UPLOAD_HOLD_MS = 15 * 60 * 1000;
type Actor = { uid: string; role: 'admin' | 'tecnico'; token: string };
// Mirrors the check constraint on public.document_jobs.status (schema.draft.sql).
type JobStatus = 'queued' | 'processing' | 'retry_wait' | 'awaiting_input' | 'awaiting_configuration' | 'needs_review' | 'approved' | 'rejected' | 'error' | 'cancelled';
type JobRow = Record<string, unknown> & { id: string; created_by: string; status: JobStatus };
type DocumentTypeConfig = { slug: string; display_name: string; enabled: boolean; skill_path: string; skill_version: string; template_object_path: string | null; template_version: string | null; output_format: string };

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
/**
 * Server-side Firebase Web API key (Identity Toolkit accounts:lookup only).
 * Read per request and never defaulted: a missing secret fails closed with 503
 * instead of falling back to a key embedded in the source.
 */
function firebaseApiKey(): string {
  const key = Deno.env.get('SAFETYCHECKLIST_FIREBASE_API_KEY') || '';
  if (!key) {
    console.error('[document-jobs] SAFETYCHECKLIST_FIREBASE_API_KEY non impostata: autenticazione rifiutata (503).');
    fail(503, 'Configurazione server incompleta: chiave Firebase non impostata.');
  }
  return key;
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
    !claims || typeof claims !== 'object' ||
    claims.aud !== FIREBASE_PROJECT ||
    claims.iss !== `https://securetoken.google.com/${FIREBASE_PROJECT}` ||
    typeof claims.sub !== 'string' || !claims.sub ||
    !Number.isFinite(claims.exp) || claims.exp <= Date.now() / 1000 ||
    !Number.isFinite(claims.iat)
  ) fail(401, 'Sessione non valida o scaduta.');

  const apiKey = firebaseApiKey();
  const lookup = await fetchTimeout(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`,
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
function stableArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}
async function digest(bytes: Uint8Array) {
  const hash = await crypto.subtle.digest('SHA-256', stableArrayBuffer(bytes));
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2,'0')).join('');
}
function storagePath(path: string) {
  return path.split('/').map((part) => encodeURIComponent(part)).join('/');
}
async function storageUpload(path: string, bytes: Uint8Array, mime: string) {
  const response = await fetchTimeout(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${storagePath(path)}`, {
    method: 'POST',
    headers: dbHeaders({ 'content-type': mime, 'x-upsert': 'false', 'cache-control': 'private, max-age=0' }),
    body: stableArrayBuffer(bytes)
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
async function findJob(id: string, actor: Actor): Promise<JobRow> {
  assertJobId(id);
  const rows = await db(`document_jobs?id=eq.${encodeURIComponent(id)}&select=*`) as JobRow[];
  const job = rows?.[0];
  assertJobAccess(actor, job);
  return job as JobRow;
}
/**
 * Applies a user-driven state change only if the job is still in the status we
 * validated (compare-and-set). Prevents cancel/retry/review from overwriting a
 * job the worker claimed in the meantime.
 */
async function transitionJob(job: JobRow, patch: Record<string, unknown>) {
  const rows = await db(`document_jobs?id=eq.${encodeURIComponent(job.id)}&status=eq.${encodeURIComponent(job.status)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(patch)
  }) as unknown[];
  if (!Array.isArray(rows) || rows.length !== 1) fail(409, 'Lo stato del lavoro è cambiato nel frattempo. Aggiorna l’elenco e riprova.');
}
async function event(jobId: string, actor: string | null, phase: string, type: string, message: string, details: Record<string,unknown> = {}) {
  await db('document_job_events', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify([{ job_id: jobId, actor_uid: actor, phase, event_type: type, message, details }])
  });
}
async function createJob(req: Request, actor: Actor, form: FormData) {
  const metadata = parseMetadata(form.get('metadata'));
  if (Deno.env.get('DOCUMENT_PIPELINE_ENABLED') === 'true' && metadata.aiDataProcessingConsent !== true) {
    fail(400, 'Per avviare l’elaborazione cloud devi confermare il trasferimento dei file al provider AI configurato.');
  }
  const { files, total } = collectUploadFiles(form.get('checklist'), form.getAll('files'));
  const requestedType = requestedDocumentType(metadata);
  // Read and sniff every file before creating the job row, so a mislabelled
  // file never produces an orphan job or a partial upload.
  const prepared: { file: File; bytes: Uint8Array; mime: string; filename: string }[] = [];
  for (const file of files) {
    const { ext, mime } = validateFile(file);
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!contentMatchesExtension(ext, bytes)) fail(415, `Il contenuto di ${safeName(file.name)} non corrisponde all’estensione del file.`);
    prepared.push({ file, bytes, mime, filename: safeName(file.name) });
  }
  const typeConfigs = await db(
    `document_type_configs?slug=eq.${encodeURIComponent(requestedType)}&enabled=eq.true&select=slug,display_name,enabled,skill_path,skill_version,template_object_path,template_version,output_format`
  ) as DocumentTypeConfig[];
  const typeConfig = typeConfigs?.[0];
  if (!typeConfig) fail(400, 'Questo tipo di documento non è ancora attivo. Seleziona un tipo disponibile oppure chiedi all’amministratore di configurarlo.');
  const title = jobTitle(metadata);
  const payload = buildInputPayload(typeConfig, metadata);
  const created = await db('document_jobs', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify([{
      created_by: actor.uid,
      created_by_role: actor.role,
      document_type: typeConfig.slug,
      title,
      status: 'queued',
      phase: 'extract',
      // Hold the job out of claim_document_job() until every file row exists;
      // cleared below once the upload completes.
      next_attempt_at: new Date(Date.now() + UPLOAD_HOLD_MS).toISOString(),
      status_message: 'Checklist ricevuta per ' + typeConfig.display_name + '; in attesa di elaborazione cloud.',
      input_payload: payload,
      template_version: typeConfig.template_version,
      skill_version: typeConfig.skill_version
    }])
  }) as JobRow[];
  const job = created?.[0];
  if (!job?.id) fail(503, 'Impossibile creare il lavoro documentale.');

  const uploadedPaths: string[] = [];
  try {
    const fileRows = [];
    for (let index = 0; index < prepared.length; index += 1) {
      const { file, bytes: fileBytes, mime: mimeType, filename } = prepared[index];
      const role = index === 0 ? 'checklist' : 'supporting';
      const path = storageObjectPath(actor.uid, job.id, index, filename);
      await storageUpload(path, fileBytes, mimeType);
      uploadedPaths.push(path);
      fileRows.push({
        job_id: job.id,
        uploaded_by: actor.uid,
        role,
        object_path: path,
        filename,
        mime_type: mimeType,
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
      body: JSON.stringify({ updated_at: new Date().toISOString(), next_attempt_at: null, status_message: 'Checklist e allegati salvati in archivio privato. In coda.' })
    });
    await event(job.id, actor.uid, 'extract', 'created', 'Lavoro documentale creato e allegati archiviati.', { file_count: files.length, total_bytes: total });
    return json(req, { job: { id: job.id, documentType: typeConfig.slug, documentTypeName: typeConfig.display_name, status: 'queued', phase: 'extract', title, created_at: job.created_at }, message: 'Lavoro salvato. Il browser può essere chiuso dopo la conferma; l’elaborazione richiede che il worker cloud sia configurato e attivo.' }, 201);
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
async function usageSummary(req: Request, actor: Actor) {
  if (actor.role !== 'admin') fail(403, 'Il riepilogo consumi è riservato agli amministratori.');
  const now = new Date();
  const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const rows = await db(
    'document_job_events?select=job_id,agent,phase,details,created_at&created_at=gte.' +
    encodeURIComponent(periodStart) + '&order=created_at.asc&limit=5000'
  ) as Record<string,unknown>[];
  const usageEvents = (rows || []).filter((row) =>
    !!row.details && typeof row.details === 'object' &&
    (row.details as Record<string,unknown>).usageKind === 'ai_usage'
  );
  const costs = usageEvents.map((row) => (row.details as Record<string,unknown>).estimatedCostUsd)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  const estimatedSpendUsd = costs.reduce((sum, value) => sum + value, 0);
  const budgetUsdRaw = Number(Deno.env.get('DOCUMENT_AI_CREDIT_BUDGET_USD') || '40');
  const budgetUsd = Number.isFinite(budgetUsdRaw) && budgetUsdRaw > 0 ? budgetUsdRaw : 40;
  const jobs = new Set(usageEvents.map((row) => String(row.job_id || '')).filter(Boolean));
  const inputTokens = usageEvents.reduce((sum, row) => sum + (Number((row.details as Record<string,unknown>)?.inputTokens) || 0), 0);
  const outputTokens = usageEvents.reduce((sum, row) => sum + (Number((row.details as Record<string,unknown>)?.outputTokens) || 0), 0);
  const averageCostPerJobUsd = jobs.size && costs.length === usageEvents.length ? estimatedSpendUsd / jobs.size : null;
  const estimatedRemainingWithinBudgetUsd = Math.max(0, budgetUsd - estimatedSpendUsd);
  const estimatedJobsRemaining = averageCostPerJobUsd && averageCostPerJobUsd > 0
    ? Math.floor(estimatedRemainingWithinBudgetUsd / averageCostPerJobUsd)
    : null;
  return json(req, {
    scope: 'SafetyChecklist document jobs only',
    periodStart,
    budgetUsd,
    callsMeasured: usageEvents.length,
    jobsMeasured: jobs.size,
    inputTokens,
    outputTokens,
    estimatedSpendUsd,
    estimatedRemainingWithinBudgetUsd,
    averageCostPerJobUsd,
    estimatedJobsRemaining,
    allCallCostsKnown: costs.length === usageEvents.length,
    note: 'Stima basata sui soli job registrati da SafetyChecklist. Non include Playground, altre chiavi API o altri strumenti che condividono i crediti Claude Team; il saldo ufficiale è quello della Claude Console.'
  });
}
async function statusJob(req: Request, actor: Actor, id: string) {
  const job = await findJob(id, actor);
  const files = await db(`document_job_files?job_id=eq.${encodeURIComponent(id)}&select=id,role,filename,mime_type,size_bytes,created_at&order=created_at.asc`) as Record<string,unknown>[];
  const events = await db(`document_job_events?job_id=eq.${encodeURIComponent(id)}&select=agent,phase,event_type,message,details,created_at&order=created_at.asc&limit=100`) as Record<string,unknown>[];
  return json(req, { job, files: files || [], events: events || [] });
}
async function downloadFile(req: Request, actor: Actor, id: string, fileId: string) {
  const job = await findJob(id, actor);
  assertFileId(fileId);
  const rows = await db(`document_job_files?id=eq.${encodeURIComponent(fileId)}&job_id=eq.${encodeURIComponent(job.id)}&select=id,filename,mime_type,object_path`) as Record<string,unknown>[];
  const file = rows?.[0];
  if (!file || typeof file.object_path !== 'string') fail(404, 'File non trovato.');
  const response = await fetchTimeout(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${storagePath(file.object_path)}`, {
    headers: dbHeaders()
  }, 60000);
  if (!response.ok) fail(response.status === 404 ? 404 : 503, 'File non disponibile.');
  const name = safeName(String(file.filename || 'documento.bin'));
  const length = response.headers.get('content-length');
  return new Response(response.body, {
    headers: responseHeaders(req, {
      'content-type': String(file.mime_type || 'application/octet-stream'),
      'content-disposition': `attachment; filename="${name}"`,
      ...(length ? { 'content-length': length } : {})
    })
  });
}
async function cancelJob(req: Request, actor: Actor, id: string) {
  const job = await findJob(id, actor);
  assertCancellable(job.status);
  await transitionJob(job, { status: 'cancelled', status_message: 'Lavoro annullato dall’utente.', updated_at: new Date().toISOString(), lease_until: null, claim_token: null });
  await event(id, actor.uid, String(job.phase || 'review'), 'review', 'Lavoro annullato.', {});
  return json(req, { ok: true, status: 'cancelled' });
}
async function retryJob(req: Request, actor: Actor, id: string) {
  const job = await findJob(id, actor);
  assertRetryable(job.status);
  const phase = retryPhase(job.agent_outputs);
  await transitionJob(job, {
    status: 'queued',
    phase,
    status_message: 'Lavoro rimesso in coda su richiesta autorizzata.',
    attempt_count: 0,
    lease_until: null,
    claim_token: null,
    next_attempt_at: null,
    updated_at: new Date().toISOString()
  });
  await event(id, actor.uid, phase, 'retry', 'Lavoro rimesso in coda.', {});
  return json(req, { ok: true, status: 'queued', phase });
}
async function reviewJob(req: Request, actor: Actor, body: Record<string, unknown>, id: string) {
  assertReviewer(actor.role);
  const job = await findJob(id, actor);
  const { status, decision, comment: message, statusMessage } = planReview(job.status, body);
  const priorPayload = job.input_payload && typeof job.input_payload === 'object' ? job.input_payload as Record<string,unknown> : {};
  await transitionJob(job, {
    status,
    status_message: statusMessage,
    review_decision: decision,
    reviewed_by: actor.uid,
    reviewed_at: new Date().toISOString(),
    input_payload: { ...priorPayload, review: { decision, comment: message } },
    updated_at: new Date().toISOString(),
    completed_at: decision === 'approved' ? new Date().toISOString() : null
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
      if (action === 'usage') return await usageSummary(req, actor);
      if (action === 'download') return await downloadFile(req, actor, url.searchParams.get('id') || '', url.searchParams.get('file_id') || '');
      return json(req, { error: 'Azione non riconosciuta.' }, 400);
    }
    if (action === 'create') {
      if (!(req.headers.get('content-type') || '').includes('multipart/form-data')) fail(415, 'Usa multipart/form-data per checklist e allegati.');
      const form = await req.formData().catch(() => fail(400, 'Richiesta multipart non valida.'));
      return await createJob(req, actor, form);
    }
    const body = normalizeActionBody(await req.json().catch(() => ({})));
    const id = typeof body.id === 'string' ? body.id : '';
    if (action === 'cancel') return await cancelJob(req, actor, id);
    if (action === 'retry') return await retryJob(req, actor, id);
    if (action === 'review') return await reviewJob(req, actor, body, id);
    return json(req, { error: 'Azione non riconosciuta.' }, 400);
  } catch (error: unknown) {
    const { status, message, expected } = errorResponse(error);
    if (!expected) console.error('[document-jobs] unexpected error', (error as { name?: string } | null)?.name || 'Error');
    return json(req, { error: message }, status);
  }
});
