import { assert, assertEquals, assertThrows } from './test-assert.ts';
import {
  assertCancellable,
  assertFileId,
  assertJobAccess,
  assertJobId,
  assertRetryable,
  assertReviewer,
  buildInputPayload,
  canonicalMime,
  collectUploadFiles,
  contentMatchesExtension,
  errorResponse,
  MAX_FILE_BYTES,
  MAX_FILES,
  normalizeActionBody,
  parseMetadata,
  planReview,
  requestedDocumentType,
  retryPhase,
  safeName,
  storageObjectPath,
  validateFile
} from './validation.ts';

function status(fn: () => unknown): number {
  try { fn(); } catch (error) { return Number((error as { status?: number }).status); }
  throw new Error('expected an error');
}
const file = (name: string, bytes: number | Uint8Array<ArrayBuffer> = 4, type = '') =>
  new File([typeof bytes === 'number' ? new Uint8Array(bytes) : bytes], name, { type });
/** Fake File for size-limit tests without allocating tens of MB. */
const sized = (name: string, size: number): File => {
  const f = file(name, 1);
  Object.defineProperty(f, 'size', { value: size });
  return f;
};

Deno.test('metadata: absent or blank is {}, malformed/wrong type is 400, oversize is 413', () => {
  assertEquals(parseMetadata(null), {});
  assertEquals(parseMetadata('   '), {});
  assertEquals(parseMetadata('{"title":"x"}'), { title: 'x' });
  assertEquals(status(() => parseMetadata('{not json')), 400);
  assertEquals(status(() => parseMetadata('[]')), 400);
  assertEquals(status(() => parseMetadata('null')), 400);
  assertEquals(status(() => parseMetadata('42')), 400);
  assertEquals(status(() => parseMetadata(file('metadata.json'))), 400);
  assertEquals(status(() => parseMetadata(JSON.stringify({ notes: 'x'.repeat(80001) }))), 413);
});

Deno.test('document type: default duvri, allow-list duvri/dvr/informativa-coin, wrong type rejected', () => {
  assertEquals(requestedDocumentType({}), 'duvri');
  assertEquals(requestedDocumentType({ documentType: ' dvr ' }), 'dvr');
  assertEquals(requestedDocumentType({ documentType: 'informativa-coin' }), 'informativa-coin');
  for (const bad of ['', 'DUVRI', 'pem', '../duvri', 'duvri;drop', 'd'.repeat(70)]) {
    assertEquals(status(() => requestedDocumentType({ documentType: bad })), 400, bad);
  }
  for (const wrongType of [123, true, ['duvri'], { slug: 'duvri' }]) {
    assertEquals(status(() => requestedDocumentType({ documentType: wrongType })), 400);
  }
});

Deno.test('filenames: traversal, separators and control characters cannot reach the storage path', () => {
  for (const name of ['../../etc/passwd.pdf', '..\\..\\win.ini.txt', 'a/b/c.pdf', 'x\u0000y.pdf', '%2e%2e%2fsecret.pdf']) {
    const safe = safeName(name);
    assert(!safe.includes('/') && !safe.includes('\\') && !safe.includes('%') && !/[\x00-\x1f]/.test(safe), safe);
    const path = storageObjectPath('uid1', '11111111-1111-4111-8111-111111111111', 0, safe);
    assertEquals(path.split('/').length, 3);
    assert(!path.split('/').includes('..'));
  }
  assertEquals(safeName('Verbale è già.pdf'), 'Verbale-e-gia.pdf');
  for (const bad of ['', '..', '.', '...', '///', '\u0000']) assertEquals(status(() => safeName(bad)), 400, JSON.stringify(bad));
});

Deno.test('filenames: truncation to 100 characters keeps the extension', () => {
  const safe = safeName('a'.repeat(150) + '.docx');
  assertEquals(safe.length, 100);
  assert(safe.endsWith('.docx'));
});

Deno.test('files: extension allow-list, server-side MIME, empty and oversize files', () => {
  assertEquals(validateFile(file('a.PDF')).mime, 'application/pdf');
  // Windows browsers report .csv as application/vnd.ms-excel: the stored MIME follows the extension.
  assertEquals(validateFile(file('a.csv', 4, 'application/vnd.ms-excel')).mime, 'text/csv');
  assertEquals(validateFile(file('a.pdf', 4, 'image/png')).mime, 'application/pdf');
  assertEquals(canonicalMime('x.exe'), null);
  for (const name of ['a.exe', 'a.html', 'a.svg', 'a', 'a.pdf.exe', 'a.zip']) {
    assertEquals(status(() => validateFile(file(name, 4, 'application/pdf'))), 415, name);
  }
  assertEquals(status(() => validateFile(file('empty.pdf', 0))), 400);
  assertEquals(status(() => validateFile(sized('big.pdf', MAX_FILE_BYTES + 1))), 413);
  validateFile(sized('limit.pdf', MAX_FILE_BYTES));
});

Deno.test('files: magic bytes must match pdf/png/jpeg/docx/xlsx extensions', () => {
  const enc = new TextEncoder();
  assert(contentMatchesExtension('.pdf', enc.encode('%PDF-1.7\n')));
  assert(contentMatchesExtension('.pdf', enc.encode('\r\n\r\n%PDF-1.4')));
  assert(!contentMatchesExtension('.pdf', enc.encode('<html>')));
  assert(contentMatchesExtension('.png', new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0])));
  assert(!contentMatchesExtension('.png', new Uint8Array([255, 216, 255, 0])));
  assert(contentMatchesExtension('.jpeg', new Uint8Array([255, 216, 255, 224])));
  assert(contentMatchesExtension('.docx', new Uint8Array([0x50, 0x4b, 3, 4, 0])));
  assert(!contentMatchesExtension('.xlsx', enc.encode('a;b;c')));
  // Legacy/text formats are not sniffed.
  assert(contentMatchesExtension('.xls', enc.encode('<table>')));
  assert(contentMatchesExtension('.csv', enc.encode('a,b')));
});

Deno.test('upload set: checklist required, at most 12 files, 45 MB total, empty supporting files ignored', () => {
  assertEquals(status(() => collectUploadFiles(null, [])), 400);
  assertEquals(status(() => collectUploadFiles('checklist.pdf', [])), 400);
  const one = collectUploadFiles(file('c.pdf'), [file('empty.pdf', 0), 'not-a-file', file('s.png')]);
  assertEquals(one.files.map((f) => f.name), ['c.pdf', 's.png']);
  assertEquals(one.total, 8);
  const eleven = Array.from({ length: MAX_FILES - 1 }, (_, i) => file(`s${i}.txt`));
  assertEquals(collectUploadFiles(file('c.pdf'), eleven).files.length, MAX_FILES);
  assertEquals(status(() => collectUploadFiles(file('c.pdf'), [...eleven, file('extra.txt')])), 413);
  const big = [sized('a.pdf', 17 * 1024 * 1024), sized('b.pdf', 17 * 1024 * 1024)];
  assertEquals(status(() => collectUploadFiles(sized('c.pdf', 17 * 1024 * 1024), big)), 413);
  assertEquals(status(() => collectUploadFiles(file('c.pdf', 0), [])), 400);
  assertEquals(status(() => collectUploadFiles(file('c.exe'), [])), 415);
});

Deno.test('input payload carries template version for the worker', () => {
  const payload = buildInputPayload({
    slug: 'duvri', display_name: 'DUVRI', output_format: 'docx', template_object_path: 'templates/duvri.docx',
    template_version: 'DUVRI_BASE_GENERALE_2026', skill_path: 'skills/duvri-colligo/SKILL.md'
  }, { title: '  Cantiere  ', siteType: 5, aiDataProcessingConsent: true });
  assertEquals(payload.templateVersion, 'DUVRI_BASE_GENERALE_2026');
  assertEquals(payload.templateObjectPath, 'templates/duvri.docx');
  assertEquals(payload.title, 'Cantiere');
  assertEquals(payload.siteType, 'unknown');
  assertEquals(payload.complexity, 'to_be_assessed');
  assertEquals((payload.fields as Record<string, unknown>).aiDataProcessingConsent, true);
});

Deno.test('identifiers: job and file ids must be UUID-shaped', () => {
  assertEquals(assertJobId('11111111-1111-4111-8111-111111111111'), '11111111-1111-4111-8111-111111111111');
  for (const bad of ['', '1', '../11111111-1111-4111-8111-11111111', 'x'.repeat(36), 42, null]) {
    assertEquals(status(() => assertJobId(bad)), 400);
    assertEquals(status(() => assertFileId(bad)), 400);
  }
});

Deno.test('access: non-owner technician gets 404, owner and admin allowed', () => {
  const job = { created_by: 'owner', status: 'queued' };
  assertJobAccess({ uid: 'owner', role: 'tecnico' }, job);
  assertJobAccess({ uid: 'someone', role: 'admin' }, job);
  assertEquals(status(() => assertJobAccess({ uid: 'other', role: 'tecnico' }, job)), 404);
  assertEquals(status(() => assertJobAccess({ uid: 'owner', role: 'tecnico' }, null)), 404);
  assertEquals(status(() => assertJobAccess({ uid: 'owner', role: 'tecnico' }, { status: 'queued' })), 404);
});

Deno.test('transitions: cancel and retry only from allowed states', () => {
  for (const s of ['queued', 'retry_wait', 'awaiting_input', 'awaiting_configuration']) assertCancellable(s);
  for (const s of ['processing', 'needs_review', 'approved', 'rejected', 'error', 'cancelled', undefined]) {
    assertEquals(status(() => assertCancellable(s)), 409, String(s));
  }
  for (const s of ['awaiting_configuration', 'error', 'retry_wait', 'awaiting_input']) assertRetryable(s);
  for (const s of ['queued', 'processing', 'needs_review', 'approved', 'rejected', 'cancelled', undefined]) {
    assertEquals(status(() => assertRetryable(s)), 409, String(s));
  }
});

Deno.test('retry resumes from the first missing checkpoint', () => {
  assertEquals(retryPhase(null), 'extract');
  assertEquals(retryPhase([]), 'extract');
  assertEquals(retryPhase({ extraction: {} }), 'analyze');
  assertEquals(retryPhase({ extraction: {}, analysis: {} }), 'draft');
  assertEquals(retryPhase({ extraction: {}, analysis: {}, draft: {} }), 'validate');
});

Deno.test('review: admin only, needs_review only, closed set of decisions', () => {
  assertReviewer('admin');
  assertEquals(status(() => assertReviewer('tecnico')), 403);
  assertEquals(status(() => planReview('queued', { decision: 'approved' })), 409);
  assertEquals(status(() => planReview('needs_review', { decision: 'APPROVED' })), 400);
  assertEquals(status(() => planReview('needs_review', {})), 400);
  assertEquals(status(() => planReview('needs_review', { decision: ['approved'] })), 400);
  assertEquals(planReview('needs_review', { decision: 'approved' }).status, 'approved');
  assertEquals(planReview('needs_review', { decision: 'rejected' }).status, 'rejected');
  const changes = planReview('needs_review', { decision: 'changes_requested', comment: '  ' + 'c'.repeat(2100) });
  assertEquals(changes.status, 'awaiting_input');
  assertEquals(changes.comment.length, 2000);
  assertEquals(planReview('needs_review', { decision: 'approved', comment: 7 }).comment, '');
});

Deno.test('action bodies and error mapping never leak internal exceptions', () => {
  assertEquals(normalizeActionBody(null), {});
  assertEquals(normalizeActionBody([1]), {});
  assertEquals(normalizeActionBody('x'), {});
  assertEquals(normalizeActionBody({ id: 'a' }), { id: 'a' });
  assertEquals(errorResponse(Object.assign(new Error('Accesso richiesto.'), { status: 401 })), { status: 401, message: 'Accesso richiesto.', expected: true });
  assertEquals(errorResponse(new TypeError("Cannot read properties of null (reading 'id')")), { status: 503, message: 'Servizio documentale non disponibile.', expected: false });
  assertEquals(errorResponse(null).status, 503);
  assertThrows(() => assertJobId('x'));
});
