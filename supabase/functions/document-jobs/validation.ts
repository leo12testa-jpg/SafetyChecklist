/**
 * Pure validation and normalisation rules for the document-jobs gateway.
 *
 * No I/O: no fetch, no Deno.env, no storage. Every rule here is unit-tested in
 * validation.test.ts; index.ts keeps authentication, database and storage calls.
 * Errors are thrown as `Error & { status }`, the shape index.ts already maps to
 * HTTP responses.
 */

export type HttpError = Error & { status: number };
export type ActorLike = { uid: string; role: string };
export type JobLike = { created_by?: unknown; status?: unknown };
export type DocumentTypeConfigLike = {
  slug: string;
  display_name: string;
  output_format: string;
  template_object_path: string | null;
  template_version: string | null;
  skill_path: string;
};

export function httpError(status: number, message: string): HttpError {
  return Object.assign(new Error(message), { status });
}
export function fail(status: number, message: string): never {
  throw httpError(status, message);
}

export const MAX_FILES = 12;
export const MAX_FILE_BYTES = 18 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 45 * 1024 * 1024;
export const MAX_METADATA_CHARS = 80000;
export const MAX_FILENAME_CHARS = 100;

/** Server-authoritative MIME type for every accepted extension. */
export const MIME_BY_EXTENSION: Readonly<Record<string, string>> = Object.freeze({
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
});
export const ALLOWED_EXTENSIONS: ReadonlySet<string> = new Set(Object.keys(MIME_BY_EXTENSION));

/**
 * Document types the frontend offers (js/document-generation.js / index.html).
 * A type must ALSO be enabled in public.document_type_configs to be accepted;
 * today only `duvri` is seeded/enabled and only `duvri` has a worker adapter.
 */
export const KNOWN_DOCUMENT_TYPES: readonly string[] = Object.freeze(['duvri', 'dvr', 'informativa-coin']);
export const DEFAULT_DOCUMENT_TYPE = 'duvri';

export const CANCELLABLE_STATUSES: readonly string[] = Object.freeze(['queued', 'retry_wait', 'awaiting_input', 'awaiting_configuration']);
export const RETRYABLE_STATUSES: readonly string[] = Object.freeze(['awaiting_configuration', 'error', 'retry_wait', 'awaiting_input']);
export const REVIEW_DECISIONS: readonly string[] = Object.freeze(['approved', 'changes_requested', 'rejected']);

const JOB_ID_PATTERN = /^[0-9a-f-]{36}$/i;
const SLUG_PATTERN = /^[a-z][a-z0-9_-]{1,62}$/;

export function extension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot).toLowerCase() : '';
}

/**
 * Storage-safe file name: ASCII letters/digits/._- only, so no path separators,
 * no traversal segments, no control characters. Truncation keeps the extension.
 */
export function safeName(name: string): string {
  let base = String(name ?? '').normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (base.length > MAX_FILENAME_CHARS) {
    const ext = extension(base);
    base = ext && ext.length < 12
      ? base.slice(0, MAX_FILENAME_CHARS - ext.length) + ext
      : base.slice(0, MAX_FILENAME_CHARS);
  }
  if (!base || /^\.+$/.test(base)) fail(400, 'Nome file non valido.');
  return base;
}

export function canonicalMime(name: string): string | null {
  return MIME_BY_EXTENSION[extension(name)] || null;
}

export type UploadLike = { name: string; size: number; type?: string };

/** Checks extension, size and returns the server-authoritative MIME type. */
export function validateFile(file: UploadLike): { ext: string; mime: string } {
  const ext = extension(String(file?.name ?? ''));
  const mime = canonicalMime(String(file?.name ?? ''));
  if (!ALLOWED_EXTENSIONS.has(ext) || !mime) fail(415, `Formato file non supportato: ${safeName(file.name)}.`);
  if (!Number.isFinite(file.size) || file.size <= 0) fail(400, `Il file ${safeName(file.name)} è vuoto.`);
  if (file.size > MAX_FILE_BYTES) fail(413, 'Ogni file deve pesare meno di 18 MB.');
  return { ext, mime };
}

/**
 * Lightweight magic-byte check for formats whose structure the worker relies on.
 * Legacy .doc/.xls and text formats are not sniffed (many business tools export
 * HTML/CSV with an .xls name; the worker rejects those explicitly).
 */
export function contentMatchesExtension(ext: string, bytes: Uint8Array): boolean {
  const starts = (signature: number[]) => bytes.length >= signature.length && signature.every((value, index) => bytes[index] === value);
  if (ext === '.pdf') {
    const head = bytes.subarray(0, 1024);
    for (let i = 0; i + 4 < head.length; i += 1) {
      if (head[i] === 0x25 && head[i + 1] === 0x50 && head[i + 2] === 0x44 && head[i + 3] === 0x46 && head[i + 4] === 0x2d) return true;
    }
    return false;
  }
  if (ext === '.png') return starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (ext === '.jpg' || ext === '.jpeg') return starts([0xff, 0xd8, 0xff]);
  if (ext === '.docx' || ext === '.xlsx') return starts([0x50, 0x4b, 0x03, 0x04]);
  return true;
}

/**
 * Picks the checklist (first) plus non-empty supporting files and enforces
 * count, per-file and total limits before anything is written.
 */
export function collectUploadFiles(checklist: unknown, supporting: unknown[]): { files: File[]; total: number } {
  if (!(checklist instanceof File)) fail(400, 'Carica la checklist compilata.');
  const extra = (Array.isArray(supporting) ? supporting : [])
    .filter((item): item is File => item instanceof File && item.size > 0);
  const files = [checklist, ...extra];
  if (files.length > MAX_FILES) fail(413, 'Sono ammessi al massimo 12 file per lavoro.');
  let total = 0;
  for (const file of files) {
    validateFile(file);
    total += file.size;
    if (total > MAX_TOTAL_BYTES) fail(413, 'La dimensione totale dei file supera 45 MB.');
  }
  return { files, total };
}

/** Parses the multipart `metadata` field. Absent/blank means `{}`. */
export function parseMetadata(raw: unknown): Record<string, unknown> {
  let metadata: unknown = {};
  if (typeof raw === 'string' && raw.trim()) {
    try { metadata = JSON.parse(raw); } catch { fail(400, 'Metadati della checklist non validi.'); }
  } else if (raw !== null && raw !== undefined && typeof raw !== 'string') {
    fail(400, 'Metadati della checklist non validi.');
  }
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) fail(400, 'Metadati della checklist non validi.');
  if (JSON.stringify(metadata).length > MAX_METADATA_CHARS) fail(413, 'Metadati troppo voluminosi.');
  return metadata as Record<string, unknown>;
}

export function requestedDocumentType(metadata: Record<string, unknown>): string {
  const raw = metadata.documentType;
  if (raw !== undefined && raw !== null && typeof raw !== 'string') fail(400, 'Tipo di documento non valido.');
  const requested = typeof raw === 'string' ? raw.trim() : DEFAULT_DOCUMENT_TYPE;
  if (!SLUG_PATTERN.test(requested) || !KNOWN_DOCUMENT_TYPES.includes(requested)) fail(400, 'Tipo di documento non valido.');
  return requested;
}

export function jobTitle(metadata: Record<string, unknown>): string {
  return typeof metadata.title === 'string' ? metadata.title.trim().slice(0, 180) : '';
}

/** input_payload stored on document_jobs and read by document-worker. */
export function buildInputPayload(typeConfig: DocumentTypeConfigLike, metadata: Record<string, unknown>) {
  return {
    documentType: typeConfig.slug,
    documentTypeName: typeConfig.display_name,
    outputFormat: typeConfig.output_format,
    templateObjectPath: typeConfig.template_object_path,
    // The worker reads input_payload.templateVersion (draft/validate phases).
    templateVersion: typeConfig.template_version,
    skillPath: typeConfig.skill_path,
    title: jobTitle(metadata),
    siteType: typeof metadata.siteType === 'string' ? metadata.siteType.slice(0, 80) : 'unknown',
    complexity: typeof metadata.complexity === 'string' ? metadata.complexity.slice(0, 40) : 'to_be_assessed',
    fields: metadata
  };
}

export function storageObjectPath(uid: string, jobId: string, index: number, filename: string): string {
  return `${uid}/${jobId}/${String(index + 1).padStart(2, '0')}_${filename}`;
}

export function isJobId(value: unknown): value is string {
  return typeof value === 'string' && JOB_ID_PATTERN.test(value);
}
export function assertJobId(value: unknown): string {
  if (!isJobId(value)) fail(400, 'Identificativo lavoro non valido.');
  return value;
}
export function assertFileId(value: unknown): string {
  if (!isJobId(value)) fail(400, 'Identificativo file non valido.');
  return value;
}

/** Admins see every job; other roles only their own. Others get 404, not 403. */
export function canAccessJob(actor: ActorLike, job: JobLike): boolean {
  return actor.role === 'admin' || (typeof job.created_by === 'string' && job.created_by === actor.uid);
}
export function assertJobAccess(actor: ActorLike, job: JobLike | null | undefined): void {
  if (!job || !canAccessJob(actor, job)) fail(404, 'Lavoro documentale non trovato.');
}

export function assertCancellable(status: unknown): void {
  if (!CANCELLABLE_STATUSES.includes(String(status))) fail(409, 'Questo lavoro non può essere annullato nella fase corrente.');
}
export function assertRetryable(status: unknown): void {
  if (!RETRYABLE_STATUSES.includes(String(status))) fail(409, 'Questo lavoro non è in uno stato ripristinabile.');
}
/** Resume from the first phase whose checkpoint is missing. */
export function retryPhase(agentOutputs: unknown): 'extract' | 'analyze' | 'draft' | 'validate' {
  const outputs = agentOutputs && typeof agentOutputs === 'object' && !Array.isArray(agentOutputs)
    ? agentOutputs as Record<string, unknown>
    : {};
  return outputs.draft ? 'validate' : outputs.analysis ? 'draft' : outputs.extraction ? 'analyze' : 'extract';
}

export function assertReviewer(role: string): void {
  if (role !== 'admin') fail(403, 'La revisione finale è riservata a un amministratore autorizzato.');
}
export function planReview(jobStatus: unknown, body: Record<string, unknown>) {
  if (jobStatus !== 'needs_review') fail(409, 'Il documento non è in attesa di revisione.');
  const decision = typeof body.decision === 'string' ? body.decision : '';
  if (!REVIEW_DECISIONS.includes(decision)) fail(400, 'Decisione di revisione non valida.');
  const status = decision === 'approved' ? 'approved' : decision === 'rejected' ? 'rejected' : 'awaiting_input';
  const comment = typeof body.comment === 'string' ? body.comment.trim().slice(0, 2000) : '';
  const statusMessage = decision === 'approved'
    ? 'Revisione umana registrata come approvata.'
    : decision === 'rejected' ? 'Documento rifiutato in revisione.' : 'Modifiche/dati aggiuntivi richiesti.';
  return { status, decision, comment, statusMessage };
}

/** JSON action bodies: anything that is not a plain object becomes `{}`. */
export function normalizeActionBody(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
}

/**
 * Maps a thrown value to an HTTP status/message. Only errors raised on purpose
 * (with a numeric `status`) expose their message; anything else is generic so
 * internal exception text never reaches the browser.
 */
export function errorResponse(error: unknown): { status: number; message: string; expected: boolean } {
  const status = Number((error as { status?: unknown } | null)?.status);
  if (Number.isInteger(status) && status >= 400 && status <= 599) {
    const message = String((error as Error).message || (status < 500 ? 'Richiesta non valida.' : 'Servizio documentale non disponibile.'));
    return { status, message, expected: true };
  }
  return { status: 503, message: 'Servizio documentale non disponibile.', expected: false };
}
