"""Synthetic-only DOCX regression tests. No customer files, model calls or Office."""
import tempfile
import unittest
import zipfile
from pathlib import Path
import sys

sys.path.insert(0,str(Path(__file__).resolve().parents[2]/"tools"))
from duvri_word_layout_profile import LayoutBlocked,SCHEMA,W,transform

def p(*parts):
    return "<w:p>"+"".join(
        "<w:r><w:t>"+text+"</w:t>"+("<w:br/>" if br else "")+"</w:r>"
        for text,br in parts)+"</w:p>"

def doc(*,registry="S1 — checklist_test.docx",nsec=19,landscape=False,marker=True):
    def cell(s):
        return '<w:tc><w:tcPr><w:tcW w:type="dxa" w:w="3520"/></w:tcPr>'+s+"</w:tc>"
    table=('<w:tbl><w:tblPr><w:tblW w:w="10560" w:type="dxa"/></w:tblPr>'
           '<w:tblGrid><w:gridCol w:w="3520"/><w:gridCol w:w="3520"/><w:gridCol w:w="3520"/></w:tblGrid>'
           '<w:tr>'+cell(p(("Verifica",False)))+
           cell(p(("Elementi documentali pertinenti",False)))+
           cell(p(("Esito del tecnico",False)))+'</w:tr>'
           '<w:tr>'+cell(p(("Controllare",False)))+
           cell(p(("checklist_",True),("test.docx",False)))+
           cell(p(("Da approvare",False)))+'</w:tr></w:tbl>')
    sections=""
    for i in range(nsec):
        width,height=(16840,11900) if landscape and i==10 else (11900,16840)
        sections+=('<w:p><w:pPr><w:sectPr><w:pgSz w:w="'+str(width)+
                   '" w:h="'+str(height)+'"/><w:pgMar w:left="620" w:right="720"/>'
                   '</w:sectPr></w:pPr></w:p>')
    text=p((("SIMULAZIONE NON EMETTIBILE" if marker else "DOCUMENTO REALE"),False))
    text+=p((registry,False))+table+sections
    return ('<?xml version="1.0" encoding="UTF-8"?>'
            '<w:document xmlns:w="'+W+'"><w:body>'+text+
            '</w:body></w:document>').encode()

class WordLayoutProfileTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name)
        self.src=self.root/"original.docx";self.out=self.root/"out.docx"
        self.profile={
            "schema_version":SCHEMA,"synthetic_only":True,"section_count":19,
            "sources":[{"id":"S1","filename":"checklist_test.docx"}],
            "compact_section_breaks":[1,10,11],
            "verification_table_widths_twips":[2608,4649,3306]}
        self.write()
    def write(self,body=None,*,macro=False):
        with zipfile.ZipFile(self.src,"w") as f:
            f.writestr("word/document.xml",body if body is not None else doc())
            f.writestr("word/comments.xml",b"<synthetic comment='preserve'/>")
            f.writestr("word/media/image1.png",b"synthetic image")
            if macro:f.writestr("word/vbaProject.bin",b"forbidden")
    def reject(self):
        with self.assertRaises((LayoutBlocked,zipfile.BadZipFile)):
            transform(self.src,self.out,self.profile)
    def test_layout_profile_preserves_source_registry_images_and_comments(self):
        r=transform(self.src,self.out,self.profile)
        self.assertEqual(r["replacement_count"],1)
        self.assertEqual(r["table_profiles_applied"],1)
        self.assertEqual(r["compact_section_breaks_applied"],3)
        self.assertEqual(r["comments_removed"],0)
        self.assertFalse(r["issuance_allowed"])
        with zipfile.ZipFile(self.out) as z:
            xml=z.read("word/document.xml").decode()
            self.assertIn("S1 — checklist_test.docx",xml)
            self.assertIn(">S1</w:t>",xml)
            self.assertNotIn(">checklist_",xml)
            self.assertNotIn("<w:br",xml)
            self.assertIn('w:w="4649"',xml)
            self.assertEqual(z.read("word/media/image1.png"),b"synthetic image")
            self.assertEqual(z.read("word/comments.xml"),b"<synthetic comment='preserve'/>")
    def test_output_never_overwritten(self):
        transform(self.src,self.out,self.profile)
        self.reject()
    def test_no_real_customer_documents(self):
        self.write(doc(marker=False))
        self.reject()
    def test_unknown_source_registry_is_blocked(self):
        self.write(doc(registry="S2 — other_test.docx"))
        self.reject()
    def test_template_section_count_changes_are_blocked(self):
        self.write(doc(nsec=18))
        self.reject()
    def test_cross_orientation_compaction_is_blocked(self):
        self.write(doc(landscape=True))
        self.reject()
    def test_unapproved_profile_is_blocked(self):
        self.profile["synthetic_only"]=False
        self.reject()
    def test_filename_path_traversal_is_blocked(self):
        self.profile["sources"][0]["filename"]="../../sensitive.docx"
        self.reject()
    def test_macro_document_is_blocked(self):
        self.write(macro=True)
        self.reject()
    def test_duplicate_source_ids_are_blocked(self):
        self.profile["sources"].append({"id":"S1","filename":"other_test.docx"})
        self.reject()
    def test_bad_zip_is_blocked(self):
        self.src.write_bytes(b"this is not a Word document")
        self.reject()

if __name__=="__main__":
    unittest.main()
