"""Offline tests with fake OOXML; no client documents or logos in CI."""
import importlib.util
import tempfile
import unittest
import zipfile
from pathlib import Path

MODULE=Path(__file__).resolve().parents[2]/"tools"/"duvri_layout_contract_v1.py"
spec=importlib.util.spec_from_file_location("duvri_layout_contract_v1",MODULE)
layout=importlib.util.module_from_spec(spec)
spec.loader.exec_module(layout)

def sect(top,bottom,left,right,landscape=False):
    w,h=(16838,11906) if landscape else (11906,16838)
    return ('<w:sectPr><w:pgSz w:w="%d" w:h="%d"/>'% (w,h)+
            '<w:pgMar w:top="%d" w:bottom="%d" w:left="%d" w:right="%d"/></w:sectPr>'%
            (top,bottom,left,right))

def fixture(path,*,toc=True,broken=False,landscape=False):
    c=sect(1140,822,618,561)
    body=sect(1418,1134,1134,1134)
    wide=sect(1304,1134,1134,1418,True)
    page=('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
          '<w:body><w:p><w:r><w:t>DOCUMENTO DI VALUTAZIONE DEI RISCHI</w:t></w:r></w:p>'
          +('<w:p><w:r><w:t>INDICE DEL DOCUMENTO</w:t></w:r></w:p>' if toc else '')+
          '<w:tbl><w:tr><w:tc><w:tcPr><w:shd w:fill="C6D9F1"/></w:tcPr></w:tc></w:tr></w:tbl>'
          '<w:tbl><w:tr><w:tc><w:p/></w:tc></w:tr></w:tbl>'
          '<w:p><w:pPr>'+c+'</w:pPr></w:p>'
          '<w:p><w:pPr>'+body.replace('w:top="1418"','w:top="300"' if broken else 'w:top="1418"')+
          '</w:pPr></w:p>'
          +(('<w:p><w:pPr>'+wide+'</w:pPr></w:p>') if landscape else '')+
          '</w:body></w:document>')
    with zipfile.ZipFile(path,"w") as z:
        z.writestr("word/document.xml",page)
        z.writestr("word/header1.xml","<header/>")
        z.writestr("word/footer1.xml","<footer/>")
        z.writestr("word/media/logo.png",b"fake")
        z.writestr("word/comments.xml",b"<review/>")

class DuvriLayoutTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path=Path(self.tmp.name)/"test.docx"
    def test_reference_layout_passes_without_approving_issuance(self):
        fixture(self.path)
        out=layout.audit(self.path)
        self.assertEqual(out["state"],"layout_reference_qa_passed")
        self.assertFalse(out["issuance_allowed"])
        self.assertFalse(out["document_modified"])
        self.assertEqual(out["parts"]["comments_parts"],1)
    def test_landscape_pages_are_supported(self):
        fixture(self.path,landscape=True)
        out=layout.audit(self.path)
        self.assertEqual(out["state"],"layout_reference_qa_passed")
        self.assertEqual(out["sections"][-1]["orientation"],"landscape")
    def test_wrong_margin_blocks(self):
        fixture(self.path,broken=True)
        out=layout.audit(self.path)
        self.assertEqual(out["state"],"layout_reference_qa_blocked")
        self.assertIn("MARGIN_MISMATCH_SECTION_2_TOP",out["blocker_codes"])
    def test_missing_index_blocks(self):
        fixture(self.path,toc=False)
        self.assertIn("TABLE_OF_CONTENTS_MISSING",layout.audit(self.path)["blocker_codes"])
    def test_bad_archive_is_rejected(self):
        self.path.write_bytes(b"bad file")
        with self.assertRaises(zipfile.BadZipFile):
            layout.audit(self.path)
    def test_never_overwrites_input(self):
        fixture(self.path)
        self.assertTrue(self.path.stat().st_size>0)
        original=self.path.read_bytes()
        layout.audit(self.path)
        self.assertEqual(self.path.read_bytes(),original)

if __name__=="__main__":
    unittest.main()
