"""All-real-format intake fixture tests. Test data is invented, never customer data."""
from __future__ import annotations

import hashlib
import json
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'tools'))
import duvri_realistic_synthetic_bundle as gen  # noqa:E402


class SyntheticCorpusTests(unittest.TestCase):
    def setUp(self):
        self.d=tempfile.TemporaryDirectory()
        self.addCleanup(self.d.cleanup)
        self.out=Path(self.d.name)
        self.summary=gen.create_corpus(self.out)
        self.data=json.loads(gen.SPEC.read_text('utf8'))

    def test_four_distinct_synthetic_cases(self):
        self.assertEqual(len(self.summary['cases']),4)
        self.assertEqual(len({x['id'] for x in self.summary['cases']}),4)
        self.assertTrue(self.data['synthetic_only'])
        self.assertFalse(self.summary['issuance_allowed'])

    def test_one_real_word_checklist_and_pdf_per_case(self):
        for case in self.data['cases']:
            d=self.out/case['id']
            doc=d/'01_CHECKLIST_CLIENTE_COMPILATA.docx'
            pdf=d/'02_CAPITOLATO.pdf'
            self.assertTrue(zipfile.is_zipfile(doc))
            self.assertTrue(pdf.read_bytes().startswith(b'%PDF-1.4'))
            with zipfile.ZipFile(doc) as z:
                root=ET.fromstring(z.read('word/document.xml'))
                texts=' '.join(t.text or '' for t in root.iter(gen.W+'t'))
                self.assertIn(case['committente'],texts)
                self.assertIn(case['intervention'],texts)
                self.assertIn('NON REALE',texts)

    def test_schedule_is_real_xlsx_when_case_requires_it(self):
        for case in self.data['cases']:
            file=self.out/case['id']/'03_CRONOPROGRAMMA.xlsx'
            if case['xlsx']:
                self.assertTrue(zipfile.is_zipfile(file))
                with zipfile.ZipFile(file) as z:
                    root=ET.fromstring(z.read('xl/worksheets/sheet1.xml'))
                    text=' '.join(x.text or '' for x in root.iter())
                    self.assertIn('Transito muletti',text)
            else:
                self.assertFalse(file.exists())

    def test_optional_image_is_valid_png(self):
        for case in self.data['cases']:
            file=self.out/case['id']/'04_PIANTA_FITTIZIA.png'
            if case['image_note']:
                data=file.read_bytes()
                self.assertTrue(data.startswith(b'\x89PNG\r\n\x1a\n'))
                self.assertIn(b'IEND',data[-12:])
            else:
                self.assertFalse(file.exists())

    def test_every_manifest_hash_is_recomputed_from_real_bytes(self):
        for case in self.data['cases']:
            d=self.out/case['id']
            manifest=json.loads((d/'00_FASCICOLO_MANIFEST.json').read_text())
            self.assertTrue(manifest['synthetic_only'])
            self.assertFalse(manifest['issuance_allowed'])
            self.assertFalse(manifest['d1_approved'])
            self.assertFalse(manifest['d2_approved'])
            self.assertFalse(manifest['word_visual_qa_approved'])
            self.assertEqual(len([f for f in manifest['files'] if f['role']=='client_checklist']),1)
            for f in manifest['files']:
                raw=(d/f['filename']).read_bytes()
                self.assertEqual(f['sha256'],hashlib.sha256(raw).hexdigest())
                self.assertEqual(f['size_bytes'],len(raw))
                self.assertEqual(f['job_id'],case['id'].replace('-','_'))
                self.assertEqual(f['parse_status'],'pending')

    def test_archived_files_match_case_inventory(self):
        archive=self.out/self.summary['archive_name']
        self.assertEqual(hashlib.sha256(archive.read_bytes()).hexdigest(),
                         self.summary['archive_sha256'])
        with zipfile.ZipFile(archive) as z:
            self.assertFalse(z.testzip())
            for case in self.data['cases']:
                names=z.namelist()
                self.assertTrue(any(x.startswith(case['id']+'/') for x in names))

    def test_mandatory_missing_information_never_inferred_safe(self):
        for case in self.data['cases']:
            facts=case['acceptance']
            self.assertTrue(facts['mandatory_questions'])
            self.assertTrue(facts['unknown_must_not_be_asserted'])
            self.assertTrue(facts['require_technical_review'])
            self.assertTrue(case['appaltatori'])

    def test_only_script_output_not_original_master_modified(self):
        self.assertFalse(any('COLLIGO' in f.name.upper()
            for d in self.out.iterdir() if d.is_dir() for f in d.iterdir()))
        self.assertFalse((ROOT/'index.html').is_relative_to(self.out))


if __name__=='__main__':
    unittest.main()
