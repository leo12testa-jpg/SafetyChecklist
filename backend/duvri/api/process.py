"""Private server-to-server trigger for the DUVRI Python compiler.

Designed for a Python HTTP function runtime; no third-party package is needed
for this endpoint. V5 engine and the official master MUST be installed privately
on that runtime and must never enter the public SafetyChecklist repository.
"""
from __future__ import annotations
import hashlib
import hmac
import json
import os
from pathlib import Path
import sys
import time
from http.server import BaseHTTPRequestHandler

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from worker_entrypoint import PrivateAPI, WorkflowBlocked, run_once, UUID

def verify_trigger(job_id: str, stamp: str, signature: str, key: str, now: int | None = None) -> bool:
    if not isinstance(job_id,str) or not UUID.fullmatch(job_id):
        return False
    if not isinstance(stamp,str) or not stamp.isdecimal() or len(stamp)>13:
        return False
    if not isinstance(key,str) or len(key)<32:
        return False
    now = int(time.time()) if now is None else now
    if abs(now-int(stamp))>120:
        return False
    expected=hmac.new(key.encode('utf-8'),(stamp+'.'+job_id).encode('ascii'),
                      hashlib.sha256).hexdigest()
    return isinstance(signature,str) and hmac.compare_digest(signature,expected)

class handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        # No URLs, user ids, source filenames, auth headers or raw worker errors in logs.
        return

    def _result(self, code, data):
        payload=json.dumps(data,separators=(',',':')).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type','application/json')
        self.send_header('Cache-Control','private,no-store')
        self.send_header('X-Content-Type-Options','nosniff')
        self.send_header('Content-Length',str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self):
        self._result(404,{'error':'NOT_FOUND'})

    def do_POST(self):
        if self.path!='/api/process':
            self._result(404,{'error':'NOT_FOUND'});return
        if os.environ.get('DUVRI_WORKER_ENABLED')!='true':
            self._result(503,{'error':'WORKER_DISABLED'});return
        length=self.headers.get('Content-Length','')
        if not length.isdecimal() or not 1<=int(length)<=256:
            self._result(413,{'error':'INVALID_LENGTH'});return
        try:
            data=json.loads(self.rfile.read(int(length)))
        except (ValueError, UnicodeDecodeError):
            self._result(400,{'error':'INVALID_PAYLOAD'});return
        job_id=data.get('job_id') if isinstance(data,dict) else None
        if not verify_trigger(job_id,
            self.headers.get('X-Colligo-Worker-Timestamp',''),
            self.headers.get('X-Colligo-Worker-Signature',''),
            os.environ.get('DUVRI_WORKER_HMAC_KEY','')):
            self._result(401,{'error':'NOT_AUTHORIZED'});return
        try:
            api=PrivateAPI(os.environ.get('SUPABASE_URL',''),
                           os.environ.get('SUPABASE_SERVICE_ROLE_KEY',''))
            result=run_once(api,job_id=job_id)
        except (WorkflowBlocked,ValueError,KeyError):
            self._result(503,{'error':'WORKER_NOT_READY'});return
        except Exception:
            self._result(503,{'error':'WORKER_FAILURE'});return
        # No technical payload or private fact content is ever reflected.
        state=result.get('state','error') if isinstance(result,dict) else 'error'
        self._result(200 if state in ('needs_review','idle','claimed_elsewhere','failed') else 503,
                     {'state':state,'issuance_allowed':False})
