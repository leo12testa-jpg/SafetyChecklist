"""Private Python worker adapter for the Colligo DUVRI review draft.

No corporate Word model, customer documents, credentials or AI prompts are
embedded here. The source-grounded engine must be installed in a protected
worker environment. This adapter never issues/approves/signs a DUVRI.
"""
from __future__ import annotations
import hashlib
import importlib
import json
import os
from pathlib import Path
import re
import sys
import tempfile
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

BUCKET = 'colligo-duvri-private'
UUID = re.compile(r'^[a-f0-9-]{36}$', re.I)
OWNER = re.compile(r'^[a-zA-Z0-9_-]{1,128}$')
SHA = re.compile(r'^[a-f0-9]{64}$')
MAX_FILE = 15 * 1024 * 1024

class WorkflowBlocked(RuntimeError):
    pass

class PrivateAPI:
    def __init__(self, url: str, service_key: str):
        if not url.startswith('https://') or not service_key or len(service_key) < 20:
            raise WorkflowBlocked('PRIVATE_API_CONFIGURATION_INVALID')
        self.url, self.key = url.rstrip('/'), service_key

    def request(self, path: str, method: str = 'GET', body: bytes | None = None,
                content_type: str = 'application/json') -> bytes:
        req = Request(self.url + path, data=body, method=method,
                      headers={'Authorization': 'Bearer ' + self.key,
                               'apikey': self.key, 'Content-Type': content_type,
                               'Prefer': 'return=representation'})
        try:
            with urlopen(req, timeout=30) as reply:
                data = reply.read(MAX_FILE + 1024)
                if len(data) > MAX_FILE + 1024:
                    raise WorkflowBlocked('REMOTE_LIMIT_EXCEEDED')
                return data
        except (HTTPError, URLError, TimeoutError):
            # Do not print HTTP bodies: private source material may be present.
            raise WorkflowBlocked('PRIVATE_API_UNAVAILABLE') from None

    def rows(self, table: str, query: str, method='GET', payload=None) -> list:
        raw = self.request('/rest/v1/' + table + query, method,
                           None if payload is None else json.dumps(payload).encode('utf-8'))
        rows = json.loads(raw)
        if not isinstance(rows, list):
            raise WorkflowBlocked('INVALID_API_RESPONSE')
        return rows

    def source(self, path: str, sha: str, size: int) -> bytes:
        if not SHA.fullmatch(sha) or not 0 < size <= MAX_FILE:
            raise WorkflowBlocked('SOURCE_MANIFEST_INVALID')
        data = self.request('/storage/v1/object/authenticated/' + BUCKET + '/' + quote(path, safe='/'))
        if len(data) != size or hashlib.sha256(data).hexdigest() != sha:
            raise WorkflowBlocked('SOURCE_HASH_MISMATCH')
        return data

    def draft(self, path: str, data: bytes):
        if not data.startswith(b'PK\x03\x04') or not 100 < len(data) <= MAX_FILE:
            raise WorkflowBlocked('OUTPUT_NOT_DOCX')
        self.request('/storage/v1/object/' + BUCKET + '/' + quote(path, safe='/'),
                     'POST', data,
                     'application/vnd.openxmlformats-officedocument.wordprocessingml.document')

def private_generator():
    folder = os.environ.get('DUVRI_PRIVATE_ENGINE_DIR', '')
    master = os.environ.get('DUVRI_MASTER_PATH', '')
    if not folder or not Path(folder).is_dir() or not master or not Path(master).is_file():
        raise WorkflowBlocked('PRIVATE_ENGINE_OR_MASTER_MISSING')
    sys.path.insert(0, folder)
    return (importlib.import_module('source_intake').write_private_job,
            importlib.import_module('duvri_draft').build_draft, Path(master))

def run_once(api: PrivateAPI) -> dict:
    if os.environ.get('DUVRI_WORKER_ENABLED') != 'true':
        raise WorkflowBlocked('WORKER_DISABLED')
    make_dossier, make_word, master = private_generator()
    found = api.rows('duvri_jobs',
        '?state=eq.awaiting_worker&order=created_at.asc&limit=1&select=id,owner_uid,manifest')
    if not found:
        return {'state': 'idle'}
    j = found[0]
    job, uid = j['id'], j['owner_uid']
    if not UUID.fullmatch(job) or not OWNER.fullmatch(uid):
        raise WorkflowBlocked('JOB_IDENTIFIER_INVALID')
    claimed = api.rows('duvri_jobs',
        '?id=eq.' + job + '&state=eq.awaiting_worker&select=id,manifest,owner_uid',
        'PATCH', {'state': 'processing'})
    if len(claimed) != 1:
        return {'state': 'claimed_elsewhere'}
    try:
        manifest = claimed[0]['manifest']
        if not isinstance(manifest, list) or not 1 <= len(manifest) <= 12:
            raise WorkflowBlocked('INVALID_MANIFEST')
        files = api.rows('duvri_job_files',
                         '?job_id=eq.' + job + '&select=slot,object_path,length_bytes,sha256')
        if len(files) != len(manifest):
            raise WorkflowBlocked('INCOMPLETE_SOURCES')
        by_slot = {int(f['slot']): f for f in files}
        sources = []
        for i, info in enumerate(manifest):
            if i not in by_slot:
                raise WorkflowBlocked('SLOT_MISSING')
            evidence = by_slot[i]
            expected = uid + '/' + job + '/' + str(i) + '.' + str(info['extension'])
            if evidence['object_path'] != expected or not info.get('name'):
                raise WorkflowBlocked('UNEXPECTED_SOURCE_LOCATION')
            if i == 0 and info.get('extension') != 'docx':
                raise WorkflowBlocked('CHECKLIST_NOT_WORD')
            if info.get('extension') not in {'docx','pdf','xlsx','png','jpg','jpeg','csv','txt','zip'}:
                raise WorkflowBlocked('SOURCE_EXTENSION_NOT_SUPPORTED')
            data = api.source(expected, evidence['sha256'], evidence['length_bytes'])
            # Re-check independently even if an API adapter returns corrupted bytes.
            if hashlib.sha256(data).hexdigest() != evidence['sha256']:
                raise WorkflowBlocked('SOURCE_HASH_MISMATCH')
            if len(data) != info['size']:
                raise WorkflowBlocked('MANIFEST_SIZE_MISMATCH')
            sources.append((info['name'], data))
        with tempfile.TemporaryDirectory(prefix='duvri_private_') as root:
            folder, _ = make_dossier(Path(root), sources[0], sources[1:])
            output = Path(root) / 'DUVRI_BOZZA_NON_EMETTIBILE.docx'
            result = make_word(folder, master, output)
            if result.get('word_generated') is not True or result.get('issuance_allowed') is not False \
               or result.get('document_status') != 'NON_EMETTIBILE':
                raise WorkflowBlocked('DRAFT_REVIEW_GATE_INVALID')
            docx = output.read_bytes()
            sha = hashlib.sha256(docx).hexdigest()
            if sha != result.get('sha256'):
                raise WorkflowBlocked('DRAFT_HASH_INVALID')
            target = uid + '/' + job + '/draft.docx'
            api.draft(target, docx)
            updated = api.rows('duvri_jobs', '?id=eq.' + job + '&state=eq.processing&select=id',
                'PATCH', {'state': 'needs_review', 'result_path': target, 'result_sha256': sha})
            if len(updated) != 1:
                raise WorkflowBlocked('DRAFT_STATUS_RACE')
        return {'state': 'needs_review', 'word_generated': True, 'issuance_allowed': False}
    except Exception as exc:
        category = str(exc) if isinstance(exc, WorkflowBlocked) else 'WORKER_PROCESSING_ERROR'
        try:
            api.rows('duvri_jobs', '?id=eq.' + job + '&state=eq.processing&select=id',
                     'PATCH', {'state': 'failed', 'failure_code': category[:80]})
        except Exception:
            pass
        return {'state': 'failed', 'word_generated': False, 'issuance_allowed': False}

if __name__ == '__main__':
    if os.environ.get('DUVRI_WORKER_ENABLED') != 'true':
        raise SystemExit('WORKER_DISABLED')
    api = PrivateAPI(os.environ.get('SUPABASE_URL', ''),
                     os.environ.get('SUPABASE_SERVICE_ROLE_KEY', ''))
    print(json.dumps(run_once(api), sort_keys=True))
