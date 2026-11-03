"""Realistic-synthetic DOCX content acceptance, no client data or providers."""
from __future__ import annotations
import copy
import io
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'tools'))
import duvri_realistic_synthetic_bundle as gen  # noqa:E402
import duvri_realistic_synthetic_output_audit as qa  # noqa:E402
import json


class DraftAcceptanceTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path=Path(self.tmp.name)/'DRAFT_NON_EMETTIBILE.docx'
        self.case=json.loads(gen.SPEC.read_text('utf8'))['cases'][0]

    def make(self, *, label=True, complete=False, false_claim=False):
        x=copy.deepcopy(self.case)
        if label:x['checklist'].append(['Dicitura bozza','NON EMETTIBILE'])
        if complete:
            x['checklist'].extend([['Elemento atteso',t]
                                  for t in x['acceptance']['must_mention']])
        if false_claim:
            x['checklist'].append(['Affermazione indebita',
                                   x['acceptance']['unknown_must_not_be_asserted'][0]])
        self.path.write_bytes(gen.make_docx(x))

    def test_label_and_metadata_do_not_grant_any_approval(self):
        self.make(label=True,complete=True)
        result=qa.assess(self.case['id'],self.path)
        self.assertTrue(result['label_text_candidate_present'])
        self.assertEqual(result['missing_expected_item_indices'],[])
        self.assertEqual(result['forbidden_assertion_indices'],[])
        self.assertFalse(result['human_hse_review_completed'])
        self.assertFalse(result['label_visible_all_word_pages_verified'])
        self.assertFalse(result['d1_approved'])
        self.assertFalse(result['issuance_allowed'])

    def test_missing_marker_fails_closed(self):
        self.make(label=False)
        result=qa.assess(self.case['id'],self.path)
        self.assertIn('NON_EMETTIBILE_LABEL_MISSING',result['blocker_codes'])

    def test_forbidden_safety_assertion_is_flagged(self):
        self.make(false_claim=True)
        result=qa.assess(self.case['id'],self.path)
        self.assertEqual(result['forbidden_assertion_indices'],[0])
        self.assertIn('UNSUPPORTED_SAFETY_ASSERTIONS_PRESENT',result['blocker_codes'])

    def test_missing_case_facts_flagged_without_echo(self):
        self.make()
        result=qa.assess(self.case['id'],self.path)
        self.assertGreater(len(result['missing_expected_item_indices']),0)
        self.assertNotIn('Centro Logistico Acero Sintetico',json.dumps(result))
        self.assertIn('SCENARIO_EXPECTED_FACTS_ABSENT',result['blocker_codes'])

    def test_wrong_scenario_id_rejected(self):
        self.make()
        with self.assertRaises(ValueError):
            qa.assess('NOT_A_CASE',self.path)

    def test_corrupted_word_rejected(self):
        self.path.write_bytes(b'not a Word file')
        with self.assertRaises(zipfile.BadZipFile):
            qa.assess(self.case['id'],self.path)

    def test_cli_never_prints_paths_or_document_text(self):
        import subprocess
        self.make()
        proc=subprocess.run([sys.executable,qa.__file__,
            '--case-id',self.case['id'],'--docx',str(self.path)],
            text=True,capture_output=True,timeout=12)
        self.assertEqual(proc.returncode,0,proc.stderr)
        self.assertNotIn(str(self.path),proc.stdout)
        self.assertNotIn(self.case['committente'],proc.stdout)
        self.assertFalse(json.loads(proc.stdout)['issuance_allowed'])


if __name__=='__main__':
    unittest.main()
