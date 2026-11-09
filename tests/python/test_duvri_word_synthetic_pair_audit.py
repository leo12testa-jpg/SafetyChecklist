"""Synthetic-only QA for draft pair inspection. No real company documents."""
import json
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools"))
import duvri_word_synthetic_pair_audit as audit  # noqa: E402

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
REL = "http://schemas.openxmlformats.org/package/2006/relationships"
H = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/header"


def make_docx(path, *, mark=False, first=True, default=True, change=False,
              orphan=False, second_section=False, comments=False, yellow=False):
    header_refs = ""
    if default:
        header_refs += f'<w:headerReference w:type="default" r:id="rId1"/>'
    if first:
        header_refs += f'<w:headerReference w:type="first" r:id="rId2"/>'
    title = "<w:titlePg/>" if first else ""
    sec = f"<w:sectPr>{header_refs}{title}</w:sectPr>"
    extra = ("<w:p><w:pPr>" + sec + "</w:pPr></w:p>") if second_section else ""
    if second_section:
        sec = "<w:sectPr/>"
    highlight = '<w:rPr><w:highlight w:val="yellow"/></w:rPr>' if yellow else ""
    main = (f'<w:document xmlns:w="{W}" xmlns:r="{R}"><w:body>'
            f'<w:p><w:r>{highlight}<w:t>Wagon synthetic</w:t></w:r></w:p>'
            f'<w:p><w:r><w:t>{"Changed body" if change else "Factory synthetic"}</w:t></w:r></w:p>'
            f'{extra}{sec}</w:body></w:document>')
    relation = (f'<Relationships xmlns="{REL}">'
                f'<Relationship Id="rId1" Type="{H}" Target="header1.xml"/>'
                f'<Relationship Id="rId2" Type="{H}" Target="header2.xml"/>'
                f'</Relationships>')
    marked = "NON EMETTIBILE" if mark else "header blank"
    header = lambda value: f'<w:hdr xmlns:w="{W}"><w:p><w:r><w:t>{value}</w:t></w:r></w:p></w:hdr>'
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("word/document.xml", main)
        z.writestr("word/_rels/document.xml.rels", relation)
        z.writestr("word/header1.xml", header(marked))
        z.writestr("word/header2.xml", header(marked))
        if orphan:
            z.writestr("word/header3.xml", header("NON EMETTIBILE"))
        if comments:
            z.writestr("word/comments.xml",
                       f'<w:comments xmlns:w="{W}"><w:comment w:id="0"/></w:comments>')


class PairTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        d = Path(self.tmp.name)
        self.a, self.b = d / "original.docx", d / "marked.docx"
        make_docx(self.a)
        make_docx(self.b, mark=True)

    def check(self, **kw):
        return audit.inspect(self.a, self.b, **kw)

    def test_marked_headers_are_structural_candidates_only(self):
        out = self.check()
        self.assertTrue(out["marked_header_routes_have_label_candidate"])
        self.assertFalse(out["label_visible_on_every_page_verified"])
        self.assertEqual(out["word_pages_visually_verified"], 0)
        self.assertFalse(out["issuance_allowed"])

    def test_unmarked_default_header_blocks(self):
        make_docx(self.b, mark=False)
        self.assertIn("MARKER_HEADER_ROUTING_INCOMPLETE", self.check()["blocker_codes"])

    def test_orphan_marked_header_does_not_count(self):
        make_docx(self.b, mark=False, orphan=True)
        self.assertFalse(self.check()["marked_header_routes_have_label_candidate"])

    def test_different_document_main_bytes_block(self):
        make_docx(self.b, mark=True, change=True)
        self.assertIn("MARKING_CHANGED_DOCUMENT_BODY", self.check()["blocker_codes"])

    def test_inherited_headers_across_sections(self):
        make_docx(self.a, second_section=True)
        make_docx(self.b, mark=True, second_section=True)
        out = self.check()
        self.assertEqual(out["sections_examined"], 2)
        self.assertTrue(out["marked_header_routes_have_label_candidate"])

    def test_missing_and_forbidden_fields_expose_indices_not_text(self):
        manifest = Path(self.tmp.name) / "manifest.json"
        manifest.write_text(json.dumps({
            "synthetic_only": True,
            "expected_values": ["Factory synthetic", "UNMAPPED SECRET VALUE"],
            "forbidden_terms": ["Wagon synthetic", "irrelevant"]
        }), encoding="utf8")
        out = self.check(manifest=manifest)
        self.assertEqual(out["missing_expected_value_indices"], [1])
        self.assertEqual(out["present_forbidden_term_indices"], [0])
        self.assertNotIn("UNMAPPED SECRET VALUE", json.dumps(out))

    def test_reject_non_synthetic_manifest(self):
        manifest = Path(self.tmp.name) / "manifest.json"
        manifest.write_text('{"synthetic_only":false}', encoding="utf8")
        with self.assertRaises(ValueError):
            self.check(manifest=manifest)

    def test_invalid_zip_rejected(self):
        self.b.write_bytes(b"INVALID_DOCX")
        with self.assertRaises(zipfile.BadZipFile):
            self.check()

    def test_editorial_and_yellow_metrics_keep_gate_closed(self):
        make_docx(self.b, mark=True, comments=True, yellow=True)
        out = self.check()
        self.assertEqual(out["editorial_comment_count"], 1)
        self.assertEqual(out["yellow_highlight_count"], 1)
        self.assertIn("EDITORIAL_COMMENTS_OPEN", out["blocker_codes"])
        self.assertIn("YELLOW_HIGHLIGHTS_OPEN", out["blocker_codes"])

    def test_cli_never_echoes_document_paths_or_text(self):
        import subprocess
        result = subprocess.run([sys.executable, audit.__file__,
                                 str(self.a), str(self.b)],
                                capture_output=True, text=True, timeout=15)
        self.assertEqual(result.returncode, 0)
        self.assertNotIn(str(self.a), result.stdout)
        self.assertNotIn("Factory synthetic", result.stdout)


if __name__ == "__main__":
    unittest.main()
