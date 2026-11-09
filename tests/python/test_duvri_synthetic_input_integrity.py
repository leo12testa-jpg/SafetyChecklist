"""Synthetic-only integrity regression tests; no private client data or models."""
from __future__ import annotations
import hashlib
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools"))
import duvri_realistic_synthetic_bundle as make  # noqa: E402
import duvri_synthetic_input_integrity as guard  # noqa: E402


class InputIntegrityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp_orig = tempfile.TemporaryDirectory()
        cls.original = Path(cls.tmp_orig.name) / "known_synthetic_cases"
        make.create_corpus(cls.original)

    @classmethod
    def tearDownClass(cls):
        cls.tmp_orig.cleanup()

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name) / "cases"
        shutil.copytree(self.original, self.root)

    def manifest(self, case="SIM-01"):
        path = self.root / case / guard.MANIFEST
        return path, json.loads(path.read_text("utf-8"))

    def write_manifest(self, path, payload):
        path.write_text(json.dumps(payload, ensure_ascii=False), "utf-8")

    def blocked(self):
        with self.assertRaises(guard.BlockedInput):
            guard.verify_corpus(self.root)

    def test_generator_produces_four_consistent_cases(self):
        r = guard.verify_corpus(self.root)
        self.assertEqual(r["case_count"], 4)
        self.assertEqual(r["client_checklist_count"], 4)
        self.assertGreaterEqual(r["input_count"], 8)
        self.assertEqual(r["state"], "input_integrity_passed_not_issuable")
        self.assertFalse(r["issuance_allowed"])

    def test_checklist_byte_tampering(self):
        p = self.root / "SIM-01" / "01_CHECKLIST_CLIENTE_COMPILATA.docx"
        p.write_bytes(p.read_bytes() + b"!tampered")
        self.blocked()

    def test_cross_case_pdf_swap(self):
        foreign = self.root / "SIM-02" / "02_CAPITOLATO.pdf"
        target = self.root / "SIM-01" / "02_CAPITOLATO.pdf"
        target.write_bytes(foreign.read_bytes())
        self.blocked()

    def test_wrong_case_id(self):
        path, payload = self.manifest()
        payload["case_id"] = "SIM-02"
        self.write_manifest(path, payload)
        self.blocked()

    def test_foreign_job_id(self):
        path, payload = self.manifest()
        payload["files"][0]["job_id"] = "SIM_03"
        self.write_manifest(path, payload)
        self.blocked()

    def test_foreign_file_id(self):
        path, payload = self.manifest()
        payload["files"][0]["file_id"] = "FILE_SIM_03_01"
        self.write_manifest(path, payload)
        self.blocked()

    def test_duplicate_file_id(self):
        path, payload = self.manifest()
        payload["files"][1]["file_id"] = payload["files"][0]["file_id"]
        self.write_manifest(path, payload)
        self.blocked()

    def test_duplicate_filename(self):
        path, payload = self.manifest()
        payload["files"][1]["filename"] = payload["files"][0]["filename"]
        self.write_manifest(path, payload)
        self.blocked()

    def test_wrong_mime(self):
        path, payload = self.manifest()
        payload["files"][0]["mime_type"] = "application/pdf"
        self.write_manifest(path, payload)
        self.blocked()

    def test_marking_d1_approved_is_blocked(self):
        path, payload = self.manifest()
        payload["d1_approved"] = True
        self.write_manifest(path, payload)
        self.blocked()

    def test_extra_file_is_blocked(self):
        (self.root / "SIM-01" / "unreviewed.txt").write_text("synthetic", "utf-8")
        self.blocked()

    def test_missing_attached_pdf_is_blocked(self):
        (self.root / "SIM-02" / "02_CAPITOLATO.pdf").unlink()
        self.blocked()

    def test_symlink_to_other_case_is_blocked(self):
        path = self.root / "SIM-01" / "02_CAPITOLATO.pdf"
        path.unlink()
        path.symlink_to(self.root / "SIM-02" / "02_CAPITOLATO.pdf")
        self.blocked()

    def test_summary_hash_mismatch_is_blocked(self):
        path = self.root / guard.SUMMARY
        payload = json.loads(path.read_text("utf-8"))
        payload["archive_sha256"] = "0" * 64
        path.write_text(json.dumps(payload), "utf-8")
        self.blocked()

    def test_archive_content_not_equal_to_directory_is_blocked(self):
        # Generate internally consistent modified ZIP and update summary SHA,
        # while keeping the original case files untouched.
        from io import BytesIO
        import zipfile
        archive = self.root / guard.ARCHIVE
        src = archive.read_bytes()
        output = BytesIO()
        with zipfile.ZipFile(BytesIO(src)) as original, zipfile.ZipFile(output, "w") as dst:
            for name in original.namelist():
                content = original.read(name)
                if name == "SIM-01/02_CAPITOLATO.pdf":
                    content += b"\n%synthetic tampering"
                dst.writestr(name, content, compress_type=zipfile.ZIP_DEFLATED)
        archive.write_bytes(output.getvalue())
        summary = self.root / guard.SUMMARY
        payload = json.loads(summary.read_text("utf-8"))
        payload["archive_sha256"] = hashlib.sha256(archive.read_bytes()).hexdigest()
        summary.write_text(json.dumps(payload), "utf-8")
        self.blocked()

    def test_duplicate_manifest_json_key_rejected(self):
        path, payload = self.manifest()
        text = json.dumps(payload)
        path.write_text(text[:-1] + ', "case_id":"SIM-01"}', "utf-8")
        self.blocked()

    def test_extra_root_case_rejected(self):
        (self.root / "SIM-05").mkdir()
        self.blocked()

    def test_cli_reports_only_codes_and_counts(self):
        proc = subprocess.run([sys.executable,
            str(ROOT / "tools" / "duvri_synthetic_input_integrity.py"),
            "--corpus", str(self.root)],
            capture_output=True, text=True, timeout=20)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        result = json.loads(proc.stdout)
        self.assertFalse(result["issuance_allowed"])
        self.assertNotIn(str(self.root), proc.stdout)
        self.assertNotIn("Centro", proc.stdout)


if __name__ == "__main__":
    unittest.main()
