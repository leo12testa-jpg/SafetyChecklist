"""Tests use only invented Word XML; no Colligo or customer document."""
import importlib.util
import io
import json
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MODULE_PATH = ROOT / "tools" / "duvri_word_template_audit.py"
spec = importlib.util.spec_from_file_location("duvri_word_template_audit", MODULE_PATH)
audit = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(audit)

WNS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"


def document(text="SECRET_SYNTHETIC_TEXT", *, anchor_end=True, changed=False):
    end = '<w:commentRangeEnd w:id="7"/>' if anchor_end else ""
    shade = '<w:shd w:fill="FFFF00"/>' if changed else ""
    return (f'''<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="{WNS}"><w:body>
<w:p><w:commentRangeStart w:id="7"/>
<w:r><w:rPr><w:highlight w:val="yellow"/></w:rPr><w:t>{text}</w:t></w:r>
<w:r><w:rPr><w:highlight w:val="yellow"/></w:rPr><w:t>XYZ</w:t></w:r>
<w:r><w:t>PLAIN</w:t></w:r>
{end}<w:r><w:commentReference w:id="7"/></w:r></w:p>
<w:tbl><w:tr><w:tc><w:p><w:r><w:t>DATA</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
<w:sectPr>{shade}</w:sectPr>
</w:body></w:document>''').encode()


def comment_xml():
    return (f'''<w:comments xmlns:w="{WNS}">
<w:comment w:id="7" w:author="PRIVATE_SYNTHETIC_AUTHOR">
<w:p><w:r><w:t>PRIVATE_SYNTHETIC_COMMENT</w:t></w:r></w:p>
</w:comment></w:comments>''').encode()


def make_docx(path, *, doc=None, comments=None, evil=False, include_document=True):
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as out:
        out.writestr("[Content_Types].xml", "<Types/>")
        if include_document:
            out.writestr("word/document.xml", doc if doc is not None else document())
        if comments is not False:
            out.writestr("word/comments.xml", comments if comments is not None else comment_xml())
        if evil:
            out.writestr("../private.txt", "TEST")


class DuvriWordTemplateAuditTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "invented.docx"
        make_docx(self.path)

    def test_counts_are_separate_from_logical_fields_and_no_issuance(self):
        result = audit.inspect(self.path)
        metrics = result["metrics"]
        self.assertEqual(metrics["paragraphs"], 2)
        self.assertEqual(metrics["tables"], 1)
        self.assertEqual(metrics["section_properties"], 1)
        self.assertEqual(metrics["yellow_highlight_nodes"], 2)
        self.assertEqual(metrics["yellow_highlight_runs"], 2)
        self.assertEqual(metrics["yellow_highlight_groups_per_paragraph"], 1)
        self.assertEqual(metrics["comments"], 1)
        self.assertEqual(metrics["comment_anchor_starts"], 1)
        self.assertEqual(metrics["comment_anchor_ends"], 1)
        self.assertTrue(metrics["comment_anchors_consistent"])
        self.assertIsNone(result["logical_fields_mapped"])
        self.assertFalse(result["d1_approved"])
        self.assertFalse(result["d2_approved"])
        self.assertFalse(result["issuance_allowed"])

    def test_text_change_can_preserve_structure_while_changing_file_hash(self):
        second = Path(self.temp.name) / "other.docx"
        make_docx(second, doc=document("DIFFERENT_PRIVATE_SYNTHETIC_TEXT"))
        a = audit.inspect(self.path)
        b = audit.inspect(second)
        self.assertNotEqual(a["metrics"]["file_sha256"], b["metrics"]["file_sha256"])
        self.assertEqual(
            a["metrics"]["main_xml_structure_sha256"],
            b["metrics"]["main_xml_structure_sha256"],
        )
        diff = audit.compare(a, b)
        self.assertFalse(diff["same_exact_file_sha256"])
        self.assertFalse(diff["d2_approved"])
        self.assertFalse(diff["issuance_allowed"])
        self.assertNotIn("PRIVATE_SYNTHETIC", json.dumps(diff))

    def test_comment_anchor_mismatch_does_not_authorize_document(self):
        make_docx(self.path, doc=document(anchor_end=False))
        result = audit.inspect(self.path)
        self.assertFalse(result["metrics"]["comment_anchors_consistent"])
        self.assertFalse(result["issuance_allowed"])

    def test_shading_is_not_counted_as_highlight(self):
        make_docx(self.path, doc=document(changed=True))
        result = audit.inspect(self.path)
        self.assertEqual(result["metrics"]["yellow_shading_nodes"], 1)
        self.assertEqual(result["metrics"]["yellow_highlight_nodes"], 2)

    def test_missing_main_document_is_rejected(self):
        make_docx(self.path, include_document=False)
        with self.assertRaisesRegex(audit.InvalidTemplate, "MISSING_WORD_DOCUMENT_XML"):
            audit.inspect(self.path)

    def test_archive_path_traversal_rejected(self):
        make_docx(self.path, evil=True)
        with self.assertRaisesRegex(audit.InvalidTemplate, "UNSAFE_OOXML_ENTRY"):
            audit.inspect(self.path)

    def test_xml_dtd_and_entity_declarations_rejected(self):
        xml = document().replace(
            b'<w:document ',
            b'<!DOCTYPE w:document [<!ENTITY xxe "SECRET">]><w:document ',
            1
        )
        make_docx(self.path, doc=xml)
        with self.assertRaisesRegex(audit.InvalidTemplate, "OOXML_DTD_NOT_ALLOWED"):
            audit.inspect(self.path)

    def test_cli_prints_only_metadata_not_text_paths_or_comments(self):
        completed = subprocess.run(
            [sys.executable, str(MODULE_PATH), str(self.path)],
            capture_output=True, text=True, check=False, timeout=15
        )
        self.assertEqual(completed.returncode, 0, completed.stderr)
        output = json.loads(completed.stdout)
        self.assertFalse(output["d2_approved"])
        for phrase in (
            "SECRET_SYNTHETIC_TEXT", "PRIVATE_SYNTHETIC_COMMENT",
            "PRIVATE_SYNTHETIC_AUTHOR", self.path.name, str(self.path),
        ):
            self.assertNotIn(phrase, completed.stdout)

    def test_invalid_archive_gives_fixed_error_without_filename(self):
        self.path.write_text("broken", encoding="utf-8")
        completed = subprocess.run(
            [sys.executable, str(MODULE_PATH), str(self.path)],
            capture_output=True, text=True, check=False, timeout=15
        )
        self.assertEqual(completed.returncode, 2)
        result = json.loads(completed.stdout)
        self.assertEqual(result["error_code"], "INVALID_OR_UNREADABLE_DOCX_ARCHIVE")
        self.assertFalse(result["issuance_allowed"])
        self.assertNotIn(str(self.path), completed.stdout)

    def test_comparison_exposes_changed_metric_names_not_contents(self):
        second = Path(self.temp.name) / "other.docx"
        make_docx(second, doc=document(changed=True))
        completed = subprocess.run(
            [sys.executable, str(MODULE_PATH), str(self.path), "--compare", str(second)],
            capture_output=True, text=True, check=False, timeout=15
        )
        self.assertEqual(completed.returncode, 0, completed.stderr)
        result = json.loads(completed.stdout)
        self.assertIn("yellow_shading_nodes", result["changed_metric_names"])
        self.assertFalse(result["d2_approved"])
        self.assertFalse(result["issuance_allowed"])
        self.assertNotIn("SECRET_SYNTHETIC_TEXT", completed.stdout)


if __name__ == "__main__":
    unittest.main()
