"""Synthetic-only tests for the private DUVRI cloud worker adapter."""
import hashlib
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

MODULE=Path(__file__).resolve().parents[2]/'backend'/'duvri'/'worker_entrypoint.py'
spec=importlib.util.spec_from_file_location('duvri_cloud_worker',MODULE)
worker=importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)
JOB='cc1e89e1-a31b-41c2-9236-cd56cad0d6aa'
SOURCE=b'PK\x03\x04synthetic-source'
DOCX=b'PK\x03\x04'+b'synthetic-review-word'*12

class FakeAPI:
    def __init__(self,empty=False,tamper=False):
        self.empty,self.tamper=empty,tamper
        self.updated=[]
        self.saved=[]
    def rows(self,table,query,method='GET',payload=None):
        manifest=[{'slot':0,'name':'Checklist_DUVRI.docx',
                   'size':len(SOURCE),'extension':'docx'}]
        if table=='duvri_jobs' and method=='GET':
            return [] if self.empty else [{'id':JOB,'owner_uid':'user42','manifest':manifest}]
        if table=='duvri_jobs' and method=='PATCH':
            self.updated.append(payload)
            return [{'id':JOB,'owner_uid':'user42','manifest':manifest}]
        if table=='duvri_job_files':
            return [{'slot':0,'object_path':'user42/'+JOB+'/0.docx',
                'length_bytes':len(SOURCE),'sha256':hashlib.sha256(SOURCE).hexdigest()}]
        raise AssertionError(table)
    def source(self,path,sha,size):
        return SOURCE[:-1]+b'X' if self.tamper else SOURCE
    def draft(self,path,bytes_):
        self.saved.append((path,bytes_))

def fake_engine():
    def dossier(root,checklist,rest):
        assert checklist[1]==SOURCE and not rest
        target=Path(root)/'dossier'
        target.mkdir()
        return target,{}
    def draft(folder,master,dest):
        Path(dest).write_bytes(DOCX)
        return {'word_generated':True,'issuance_allowed':False,
            'document_status':'NON_EMETTIBILE',
            'sha256':hashlib.sha256(DOCX).hexdigest()}
    return dossier,draft,Path('/synthetic-master')

class TestCloudWorker(unittest.TestCase):
    def test_disabled_by_default(self):
        with patch.dict('os.environ',{},clear=True):
            with self.assertRaisesRegex(worker.WorkflowBlocked,'WORKER_DISABLED'):
                worker.run_once(FakeAPI())
    def test_no_job_is_idle(self):
        with patch.dict('os.environ',{'DUVRI_WORKER_ENABLED':'true'}),\
             patch.object(worker,'private_generator',fake_engine),\
             patch.object(worker,'resolve_master',return_value=Path('/synthetic-master')):
            self.assertEqual(worker.run_once(FakeAPI(empty=True)),{'state':'idle'})
    def test_only_non_issuing_draft_can_be_uploaded(self):
        api=FakeAPI()
        with patch.dict('os.environ',{'DUVRI_WORKER_ENABLED':'true'}),\
             patch.object(worker,'private_generator',fake_engine),\
             patch.object(worker,'resolve_master',return_value=Path('/synthetic-master')):
            result=worker.run_once(api)
        self.assertEqual(result,{'state':'needs_review','word_generated':True,'issuance_allowed':False})
        self.assertEqual(api.saved[0],('user42/'+JOB+'/draft.docx',DOCX))
        self.assertEqual(api.updated[-1]['state'],'needs_review')
        self.assertEqual(api.updated[-1]['result_sha256'],hashlib.sha256(DOCX).hexdigest())
    def test_tampered_source_cannot_produce_word(self):
        api=FakeAPI(tamper=True)
        with patch.dict('os.environ',{'DUVRI_WORKER_ENABLED':'true'}),\
             patch.object(worker,'private_generator',fake_engine),\
             patch.object(worker,'resolve_master',return_value=Path('/synthetic-master')):
            result=worker.run_once(api)
        self.assertEqual(result['state'],'failed')
        self.assertFalse(api.saved)
        self.assertEqual(api.updated[-1]['state'],'failed')
        self.assertEqual(api.updated[-1]['failure_code'],'SOURCE_HASH_MISMATCH')
    def test_selected_job_id_rejects_untrusted_selector(self):
        with patch.dict('os.environ',{'DUVRI_WORKER_ENABLED':'true'}):
            with self.assertRaisesRegex(worker.WorkflowBlocked,'JOB_IDENTIFIER_INVALID'):
                worker.run_once(FakeAPI(),job_id='../other')

    def test_remote_master_with_incorrect_hash_is_blocked(self):
        from tempfile import TemporaryDirectory
        class WrongMaster:
            def request(self,path):
                assert 'authenticated/colligo-duvri-private/system/' in path
                return b'PK\\x03\\x04'+b'wrong-master'*20
        with TemporaryDirectory() as d:
            with self.assertRaisesRegex(worker.WorkflowBlocked,'PRIVATE_MASTER_HASH_MISMATCH'):
                worker.resolve_master(WrongMaster(),Path(d),None)

    def test_invalid_private_service_config_is_blocked(self):
        with self.assertRaises(worker.WorkflowBlocked):
            worker.PrivateAPI('https://example.com','short')

if __name__=='__main__':
    unittest.main()
