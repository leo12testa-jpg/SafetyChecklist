"""Synthetic-only tests: no Colligo or customer Word files are opened."""
import importlib.util
import hashlib
from io import BytesIO
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from zipfile import ZipFile

MODULE_PATH = Path(__file__).resolve().parents[2] / "tools" / "duvri_word_source_coverage_check.py"
spec = importlib.util.spec_from_file_location("duvri_word_source_coverage_check", MODULE_PATH)
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)

TYPES = (
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    '<Override PartName="/word/document.xml" ContentType="'
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
    '</Types>'
)
W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
DOC = ('<w:document xmlns:w="' + W + '"><w:body>'
       '<w:p><w:r><w:t>Controllo di</w:t></w:r><w:r><w:t xml:space="preserve">'
       ' accesso</w:t></w:r></w:p>'
       '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Rischio logistico da verificare'
       '</w:t></w:r></w:p></w:tc></w:tr></w:tbl>'
       '</w:body></w:document>')


def make_word(xml=DOC, files=None, manifest_xml=TYPES):
    out = BytesIO()
    with ZipFile(out, "w") as z:
        z.writestr("[Content_Types].xml", manifest_xml)
        z.writestr("_rels/.rels", "<Relationships/>")
        z.writestr("word/document.xml", xml)
        for name, content in (files or {}).items():
            z.writestr(name, content)
    return out.getvalue()


def make_manifest(blob, source_id="FILE_SYNTH_00001"):
    return {
        "schema_version": gate.SCHEMA,
        "job_id": "JOB_SYNTH_00001",
        "document_revision_id": "REV_SYNTH_00001",
        "draft_sha256": hashlib.sha256(blob).hexdigest(),
        "source_files": [{"file_id": source_id, "sha256": "b" * 64}],
        "required_claims": [
            {"claim_id": "CLAIM_SYNTH_00001", "file_id": source_id,
             "locator": "page:1:line:1", "exact_text": "Controllo di accesso"},
            {"claim_id": "CLAIM_SYNTH_00002", "file_id": source_id,
             "locator": "page:1:line:2",
             "exact_text": "Rischio logistico da verificare"}
        ],
        "forbidden_markers": ["Segnaposto demo"]
    }


class DuvriWordSourceCoverageTests(unittest.TestCase):
    def setUp(self):
        self.word = make_word()
        self.manifest = make_manifest(self.word)

    def test_valid_multi_run_and_table_text(self):
        r = gate.assess(self.word, self.manifest)
        self.assertEqual(r["state"], "candidate_text_coverage")
        self.assertEqual(r["claims_matched"], 2)
        self.assertEqual(r["claims_missing"], 0)
        self.assertFalse(r["semantic_hse_review_approved"])
        self.assertFalse(r["source_bytes_independently_verified"])
        self.assertFalse(r["document_layout_verified"])
        self.assertFalse(r["issuance_allowed"])

    def test_missing_claim_does_not_pass(self):
        self.manifest["required_claims"][1]["exact_text"] = "Informazione non presente"
        r = gate.assess(self.word, self.manifest)
        self.assertEqual(r["state"], "blocked")
        self.assertEqual(r["claims_missing"], 1)
        self.assertEqual(r["claims_matched"], 1)
        self.assertEqual(r["error_code"], "WORD_COVERAGE_INCOMPLETE")

    def test_placeholder_does_not_pass(self):
        xml = DOC.replace("</w:body>", "<w:p><w:r><w:t>Segnaposto demo</w:t></w:r></w:p></w:body>")
        self.word = make_word(xml)
        self.manifest = make_manifest(self.word)
        r = gate.assess(self.word, self.manifest)
        self.assertEqual(r["forbidden_markers_found"], 1)
        self.assertEqual(r["state"], "blocked")

    def test_wrong_word_hash_rejected(self):
        self.manifest["draft_sha256"] = "0" * 64
        with self.assertRaises(gate.GateError) as e:
            gate.assess(self.word, self.manifest)
        self.assertEqual(str(e.exception), "DRAFT_HASH_MISMATCH")

    def test_claim_from_unlisted_source_rejected(self):
        self.manifest["required_claims"][0]["file_id"] = "UNAUTH_SYNTH_000"
        with self.assertRaises(gate.GateError) as e:
            gate.assess(self.word, self.manifest)
        self.assertEqual(str(e.exception), "INVALID_MANIFEST")

    def test_duplicate_ids_rejected(self):
        self.manifest["required_claims"][1]["claim_id"] = "CLAIM_SYNTH_00001"
        with self.assertRaises(gate.GateError):
            gate.assess(self.word, self.manifest)

    def test_extra_manifest_fields_rejected(self):
        self.manifest["issued"] = True
        with self.assertRaises(gate.GateError):
            gate.assess(self.word, self.manifest)

    def test_macro_component_rejected(self):
        doc = make_word(files={"word/vbaProject.bin": "synthetic"})
        with self.assertRaises(gate.GateError) as e:
            gate.assess(doc, make_manifest(doc))
        self.assertEqual(str(e.exception), "UNSAFE_DOCX_CONTAINER")

    def test_word_content_type_required(self):
        wrong = TYPES.replace("wordprocessingml.document.main+xml", "sheet.main+xml")
        doc = make_word(manifest_xml=wrong)
        with self.assertRaises(gate.GateError) as e:
            gate.assess(doc, make_manifest(doc))
        self.assertEqual(str(e.exception), "DOCX_NOT_WORD")

    def test_manifest_cannot_be_empty(self):
        self.manifest["required_claims"] = []
        with self.assertRaises(gate.GateError):
            gate.assess(self.word, self.manifest)

    def test_word_document_xml_must_be_well_formed(self):
        doc = make_word("<w:document><bad")
        with self.assertRaises(gate.GateError) as e:
            gate.assess(doc, make_manifest(doc))
        self.assertEqual(str(e.exception), "OOXML_INVALID")

    def test_word_xml_dtd_disallowed(self):
        doc = make_word('<!DOCTYPE w:document [<!ENTITY x "bad">]>' + DOC)
        with self.assertRaises(gate.GateError) as e:
            gate.assess(doc, make_manifest(doc))
        self.assertEqual(str(e.exception), "OOXML_UNSAFE_XML")

    def test_cli_reports_only_aggregates(self):
        with tempfile.TemporaryDirectory() as dir_name:
            directory = Path(dir_name)
            docx = directory / "synthetic.docx"
            meta = directory / "manifest.json"
            docx.write_bytes(self.word)
            meta.write_text(json.dumps(self.manifest), encoding="utf-8")
            result = subprocess.run([
                sys.executable, str(MODULE_PATH), "--docx", str(docx),
                "--manifest", str(meta)
            ], capture_output=True, text=True, check=False)
            self.assertEqual(result.returncode, 0)
            self.assertEqual(json.loads(result.stdout)["state"], "candidate_text_coverage")
            self.assertNotIn("Controllo di accesso", result.stdout)
            self.assertNotIn("synthetic.docx", result.stdout)
            self.manifest["required_claims"][0]["exact_text"] = "Non trovato"
            meta.write_text(json.dumps(self.manifest), encoding="utf-8")
            result = subprocess.run([
                sys.executable, str(MODULE_PATH), "--docx", str(docx),
                "--manifest", str(meta)
            ], capture_output=True, text=True, check=False)
            self.assertEqual(result.returncode, 2)
            self.assertEqual(json.loads(result.stdout)["claims_missing"], 1)
            self.assertNotIn("Non trovato", result.stdout)

    def test_symlink_rejected(self):
        with tempfile.TemporaryDirectory() as dir_name:
            directory = Path(dir_name)
            docx = directory / "file.docx"
            link = directory / "link.docx"
            meta = directory / "manifest.json"
            docx.write_bytes(self.word)
            try:
                link.symlink_to(docx)
            except (OSError, NotImplementedError):
                self.skipTest("Symlinks not available")
            meta.write_text(json.dumps(self.manifest), encoding="utf-8")
            report = gate.run(link, meta)
            self.assertEqual(report["error_code"], "DOCX_UNAVAILABLE")
            self.assertFalse(report["issuance_allowed"])


if __name__ == "__main__":
    unittest.main()
