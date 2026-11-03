"""Synthetic-only independent DOCX labeling checks. No actual Colligo files."""
from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools"))
import duvri_word_draft_label_check as draft  # noqa: E402

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
PREFIX = f'<w:document xmlns:w="{W}"><w:body>'
SUFFIX = '</w:body></w:document>'


def paragraph(runs: str) -> str:
    return '<w:p>' + runs + '</w:p>'


def run(text: str, props: str = "") -> str:
    return f'<w:r>{props}<w:t>{text}</w:t></w:r>'


def xml(body: str) -> bytes:
    return ('<?xml version="1.0" encoding="utf-8"?>'
            + PREFIX + body + SUFFIX).encode()


def create(path: Path, doc: bytes, *, header: bytes | None = None,
           comments: bytes | None = None) -> None:
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", "<Types/>")
        z.writestr("word/document.xml", doc)
        if header is not None:
            z.writestr("word/header1.xml", header)
        if comments is not None:
            z.writestr("word/comments.xml", comments)


class DuvriDraftLabelTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "SYNTHETIC_NON_EMETTIBILE_NAME.docx"

    def test_filename_alone_never_counts_as_inside_document(self):
        create(self.path, xml(paragraph(run("Bozza sintetica"))))
        r = draft.inspect(self.path)
        self.assertFalse(r["non_emettibile_text_candidate"])
        self.assertIn("NON_EMETTIBILE_LABEL_NOT_IN_DOCUMENT_TEXT", r["blocker_codes"])
        self.assertFalse(r["issuance_allowed"])

    def test_body_label_candidate_still_requires_visual_and_D1_D2_review(self):
        create(self.path, xml(paragraph(run("NON EMETTIBILE"))))
        r = draft.inspect(self.path)
        self.assertTrue(r["non_emettibile_text_candidate"])
        self.assertFalse(r["label_visually_verified"])
        self.assertIn("VISUAL_QA_REQUIRED", r["blocker_codes"])
        self.assertIn("D1_NOT_APPROVED", r["blocker_codes"])
        self.assertIn("D2_NOT_APPROVED", r["blocker_codes"])
        self.assertFalse(r["issuance_allowed"])

    def test_split_across_runs_still_recognized(self):
        create(self.path, xml(paragraph(run("NON ") + run("EMETTIBILE"))))
        self.assertTrue(draft.inspect(self.path)["non_emettibile_text_candidate"])

    def test_upper_and_lower_case_recognized(self):
        create(self.path, xml(paragraph(run("non emettibile"))))
        self.assertTrue(draft.inspect(self.path)["non_emettibile_text_candidate"])

    def test_header_text_counts_only_as_unverified_candidate(self):
        body = xml(paragraph(run("Bozza di prova")))
        header = (f'<w:hdr xmlns:w="{W}">' +
                  paragraph(run("NON EMETTIBILE")) + '</w:hdr>').encode()
        create(self.path, body, header=header)
        r = draft.inspect(self.path)
        self.assertTrue(r["non_emettibile_text_candidate"])
        self.assertFalse(r["word_visual_qa_approved"])

    def test_hidden_run_does_not_pass(self):
        hidden = '<w:rPr><w:vanish/></w:rPr>'
        create(self.path, xml(paragraph(run("NON EMETTIBILE", hidden))))
        self.assertFalse(draft.inspect(self.path)["non_emettibile_text_candidate"])

    def test_white_text_does_not_pass(self):
        props = '<w:rPr><w:color w:val="FFFFFF"/></w:rPr>'
        create(self.path, xml(paragraph(run("NON EMETTIBILE", props))))
        self.assertFalse(draft.inspect(self.path)["non_emettibile_text_candidate"])

    def test_deleted_text_does_not_pass(self):
        body = paragraph('<w:del>' + run("NON EMETTIBILE") + '</w:del>')
        create(self.path, xml(body))
        self.assertFalse(draft.inspect(self.path)["non_emettibile_text_candidate"])

    def test_comment_text_is_not_visible_document_label(self):
        comments = (f'<w:comments xmlns:w="{W}"><w:comment w:id="2">'
                    + paragraph(run("NON EMETTIBILE")) +
                    '</w:comment></w:comments>').encode()
        create(self.path, xml(paragraph(run("Bozza"))), comments=comments)
        r = draft.inspect(self.path)
        self.assertFalse(r["non_emettibile_text_candidate"])
        self.assertEqual(r["comment_count"], 1)
        self.assertIn("WORD_COMMENTS_REMAIN", r["blocker_codes"])

    def test_highlight_and_comments_flagged_as_unresolved(self):
        yellow = '<w:rPr><w:highlight w:val="yellow"/></w:rPr>'
        doc = xml(paragraph(run("NON EMETTIBILE") + run("EDIT", yellow)))
        create(self.path, doc)
        r = draft.inspect(self.path)
        self.assertEqual(r["yellow_highlight_nodes"], 1)
        self.assertIn("YELLOW_HIGHLIGHTS_REMAIN", r["blocker_codes"])
        self.assertFalse(r["issuance_allowed"])

    def test_cli_does_not_echo_document_text_or_private_paths(self):
        private = "CLIENT_SYNTHETIC_SECRET_ABC"
        create(self.path, xml(paragraph(run(private) + run(" NON EMETTIBILE"))))
        result = subprocess.run(
            [sys.executable, str(ROOT / "tools" / "duvri_word_draft_label_check.py"), str(self.path)],
            text=True, capture_output=True, timeout=15, check=False
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        data = json.loads(result.stdout)
        self.assertTrue(data["non_emettibile_text_candidate"])
        self.assertFalse(data["issuance_allowed"])
        self.assertNotIn(private, result.stdout)
        self.assertNotIn(self.path.name, result.stdout)
        self.assertNotIn(str(self.path), result.stdout)

    def test_invalid_document_blocks_without_echoing_filename(self):
        self.path.write_bytes(b"THIS_IS_NOT_A_DOCX")
        result = subprocess.run(
            [sys.executable, str(ROOT / "tools" / "duvri_word_draft_label_check.py"), str(self.path)],
            text=True, capture_output=True, timeout=15, check=False
        )
        self.assertEqual(result.returncode, 2)
        data = json.loads(result.stdout)
        self.assertEqual(data["state"], "blocked")
        self.assertFalse(data["issuance_allowed"])
        self.assertNotIn(self.path.name, result.stdout)


if __name__ == "__main__":
    unittest.main()
