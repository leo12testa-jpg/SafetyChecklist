"""Trigger HMAC regression; no network, clients or Word templates."""
import hashlib
import hmac
import importlib.util
from pathlib import Path
import unittest

ROOT=Path(__file__).resolve().parents[2]
MODULE=ROOT/'backend'/'duvri'/'api'/'process.py'
spec=importlib.util.spec_from_file_location('duvri_private_http_trigger',MODULE)
trigger=importlib.util.module_from_spec(spec)
spec.loader.exec_module(trigger)

JOB='12345678-1234-4123-8123-123456789012'
STAMP='1794230000'
KEY='very-long-synthetic-worker-key-is-not-a-secret'
def signature(job=JOB,stamp=STAMP,key=KEY):
    return hmac.new(key.encode('utf-8'),(stamp+'.'+job).encode('ascii'),
                    hashlib.sha256).hexdigest()

class WorkerTriggerTests(unittest.TestCase):
    def test_correct_signed_message(self):
        self.assertTrue(trigger.verify_trigger(JOB,STAMP,signature(),KEY,now=int(STAMP)))
    def test_wrong_secret_and_modified_job_fail(self):
        self.assertFalse(trigger.verify_trigger(JOB,STAMP,signature(key='different-long-synthetic-worker-key'),KEY,now=int(STAMP)))
        altered='12345678-1234-4123-8123-123456789013'
        self.assertFalse(trigger.verify_trigger(altered,STAMP,signature(),KEY,now=int(STAMP)))
    def test_replays_older_than_two_minutes_fail(self):
        self.assertFalse(trigger.verify_trigger(JOB,STAMP,signature(),KEY,now=int(STAMP)+121))
        self.assertFalse(trigger.verify_trigger(JOB,STAMP,signature(),KEY,now=int(STAMP)-121))
    def test_short_or_empty_key_is_denied(self):
        self.assertFalse(trigger.verify_trigger(JOB,STAMP,signature(),'short',now=int(STAMP)))
        self.assertFalse(trigger.verify_trigger(JOB,STAMP,signature(),'',now=int(STAMP)))
    def test_incorrect_signature_and_job_rejected(self):
        self.assertFalse(trigger.verify_trigger(JOB,STAMP,'0'*64,KEY,now=int(STAMP)))
        self.assertFalse(trigger.verify_trigger('../path',STAMP,signature(),KEY,now=int(STAMP)))
        self.assertFalse(trigger.verify_trigger(JOB,'notatime',signature(),KEY,now=int(STAMP)))

if __name__=='__main__':
    unittest.main()
