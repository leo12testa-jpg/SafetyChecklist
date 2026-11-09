"""Synthetic XML fixtures only; never import real Colligo DOCX or contact providers."""
from __future__ import annotations

import contextlib
import io
import json
import tempfile
import unittest
import zipfile
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools"))
from duvri_demo_editorial_gate import inspect, UnsafeWord

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"


def part(text, *, anchor=True, overlong=False):
    links = '<w:hyperlink w:anchor="TOC1"><w:r><w:t>nav</w:t></w:r></w:hyperlink>' if anchor else ""
    cells = '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>' + (
        'x' * 610 if overlong else 'misura sintetica') + '</w:t></w:r></w:p></w:tc></w:tr></w:tbl>'
    return ('<w:document xmlns:w="' + W + '"><w:body><w:p><w:r><w:t>'
            + text + '</w:t></w:r></w:p>' + links + cells
            + '<w:sectPr/></w:body></w:document>').encode()


def header(mark="NON EMETTIBILE"):
    return ('<w:hdr xmlns:w="' + W + '"><w:p><w:r><w:t>' + mark
            + '</w:t></w:r></w:p></w:hdr>').encode()


BASE = "BOZZA NON EMETTIBILE. INT01 INT02. EVIDENZE DA VALIDARE"


class EditorialGateTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.target = Path(self.tmp.name) / "fixture.docx"

    def make(self, text=BASE, *, hdr="NON EMETTIBILE", anchor=True, long=False,
             comments=False, doc=True, duplicate=False):
        items = {}
        if doc:
            items["word/document.xml"] = part(text, anchor=anchor, overlong=long)
        items["word/header1.xml"] = header(hdr)
        if comments:
            items["word/comments.xml"] = (
                '<w:comments xmlns:w="' + W + '"><w:comment w:id="1"/></w:comments>').encode()
        with zipfile.ZipFile(self.target, "w", zipfile.ZIP_DEFLATED) as z:
            for name, content in items.items():
                z.writestr(name, content)
            if duplicate:
                with contextlib.redirect_stderr(io.StringIO()):
                    z.writestr("word/document.xml", items["word/document.xml"])
        return inspect(self.target)

    def has(self, code, **kwargs):
        result = self.make(**kwargs)
        self.assertIn(code, result["issue_codes"])
        self.assertEqual(result["editorial_preflight"], "blocked")
        self.assertFalse(result["issuance_allowed"])

    def test_candidate_does_not_approve_document(self):
        report = self.make()
        self.assertEqual(report["issue_codes"], [])
        self.assertEqual(report["editorial_preflight"], "candidate_passed_not_approved")
        self.assertEqual(report["section_count"], 1)
        self.assertEqual(report["table_count"], 1)
        self.assertFalse(report["issuance_allowed"])
        self.assertFalse(report["word_desktop_visual_qa_completed"])
        self.assertFalse(report["ai_review_independently_verified"])

    def test_draft_marker_missing(self):
        self.has("NON_EMETTIBILE_MARKER_MISSING",
                 text="INT01 INT02", hdr="revision only")

    def test_header_draft_marker_missing(self):
        self.has("HEADER_FOOTER_DRAFT_MARK_MISSING", hdr="no draft mark")

    def test_old_index_placeholder_blocked(self):
        self.has("LEGACY_TOC_PLACEHOLDER", text=BASE + " SOMMARIO DA AGGIORNARE IN WORD")

    def test_editorial_id_unresolved(self):
        self.has("EDITORIAL_ID_NOT_RESOLVED", text=BASE + " DUVRI_[DATO NON DISPONIBILE]")

    def test_editorial_id_variant_spaced(self):
        self.has("EDITORIAL_ID_NOT_RESOLVED", text=BASE + " DUVRI_ [ DATO NON DISPONIBILE ]")

    def test_overlong_table_cells(self):
        self.has("OVERLONG_TABLE_CELLS", long=True)

    def test_missing_navigation(self):
        self.has("NO_INTERNAL_NAVIGATION", anchor=False)

    def test_missing_interference_ids(self):
        self.has("INTERFERENCE_MARKERS_INCOMPLETE", text="BOZZA NON EMETTIBILE. INT01.")

    def test_ai_review_not_completed(self):
        self.has("AI_REVIEW_DECLARED_INCOMPLETE", text=BASE + " REVISIONE AI NON COMPLETATA")

    def test_legacy_source_string_warning(self):
        self.has("LEGACY_SYNTHETIC_SOURCE_REFERENCE", text=BASE + " CHECKLIST_REAL_SYN_01.docx")

    def test_comment_count_reported_without_content(self):
        data = self.make(comments=True)
        self.assertEqual(data["comment_count"], 1)
        self.assertNotIn("secret", json.dumps(data))

    def test_invalid_word_archive(self):
        self.target.write_bytes(b"not a DOCX")
        with self.assertRaises(UnsafeWord):
            inspect(self.target)

    def test_missing_document_part(self):
        with self.assertRaises(UnsafeWord):
            self.make(doc=False)

    def test_duplicate_zip_entry_refused(self):
        with self.assertRaises(UnsafeWord):
            self.make(duplicate=True)

    def test_document_text_never_in_report(self):
        confidential_canary = "SYNTHETIC_SECRET_NEVER_LOG_919"
        result = self.make(text=BASE + " " + confidential_canary)
        self.assertNotIn(confidential_canary, json.dumps(result))
        self.assertTrue(result["document_content_in_report"] is False)

    def test_zip_traversal_refused(self):
        with zipfile.ZipFile(self.target, "w") as z:
            z.writestr("../outside", b"x")
            z.writestr("word/document.xml", part(BASE))
        with self.assertRaises(UnsafeWord):
            inspect(self.target)

    def test_invalid_word_xml_refused(self):
        with zipfile.ZipFile(self.target, "w") as z:
            z.writestr("word/document.xml", b"<w:document")
        with self.assertRaises(UnsafeWord):
            inspect(self.target)

    def test_dangerous_doctype_refused(self):
        with zipfile.ZipFile(self.target, "w") as z:
            z.writestr("word/document.xml", b"<!DOCTYPE x><root/>")
        with self.assertRaises(UnsafeWord):
            inspect(self.target)


if __name__ == "__main__":
    unittest.main()
