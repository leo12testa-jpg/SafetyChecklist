"""Read-only Colligo DUVRI corporate-layout QA: structure, not substantive HSE approval.

The profile is based on two independently reviewed 2026 Colligo references,
NOT on client data. It accepts variable content, logos, images, tables and
landscape sections. Never rewrites margins or section breaks.
"""
from __future__ import annotations

import json
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
NS = {"w": W}
K = lambda n: "{%s}%s" % (W, n)
LAYOUT_ID = "COLLIGO-DUVRI-CORPORATE-2026-V1"

# twips. Measurements from the approved graphical references, with a small
# 0.15 cm tolerance for Word round-trip. All values are centimeters.
COVER = {"top": 2.01, "bottom": 1.45, "left": 1.09, "right": 0.99}
PORTRAIT = {"top": 2.50, "bottom": 2.00, "left": 2.00, "right": 2.00}
LANDSCAPE = {"top": 2.30, "bottom": 2.00, "left": 2.00, "right": 2.50}
TOLERANCE_CM = 0.15
MAX_BYTES = 40 * 1024 * 1024

def _attribute(node, attr, default=None):
    return node.get(K(attr), default) if node is not None else default

def _cm(twips):
    return round(int(twips) / 567.0, 3)

def audit(path):
    path = Path(path)
    if not path.is_file() or path.is_symlink() or path.stat().st_size > MAX_BYTES:
        raise ValueError("DOCX_FILE_UNSAFE")
    with zipfile.ZipFile(path) as z:
        names = z.namelist()
        if len(names) != len(set(names)) or "word/document.xml" not in names:
            raise ValueError("DOCX_PARTS_INVALID")
        if any(n.lower().endswith("vbaproject.bin") or n.startswith("/") or ".." in n.split("/") for n in names):
            raise ValueError("DOCX_PACKAGE_UNSAFE")
        doc = ET.fromstring(z.read("word/document.xml"))
        parts = {
            "images": sum(n.startswith("word/media/") for n in names),
            "headers": sum(n.startswith("word/header") and n.endswith(".xml") for n in names),
            "footers": sum(n.startswith("word/footer") and n.endswith(".xml") for n in names),
            "comments_parts": sum("comments" in n.lower() and n.endswith(".xml") for n in names)
        }
    sections = []
    for node in doc.findall(".//w:sectPr", NS):
        page = node.find("w:pgSz", NS)
        margins = node.find("w:pgMar", NS)
        if page is None or margins is None:
            sections.append(None)
            continue
        width, height = int(_attribute(page, "w", 0)), int(_attribute(page, "h", 0))
        geometry = {k: _cm(_attribute(margins,k,0)) for k in ("top","bottom","left","right")}
        sections.append({"orientation": "landscape" if width > height else "portrait",
                         "width_cm": _cm(width), "height_cm": _cm(height),
                         "margins_cm": geometry})
    text = " ".join((el.text or "") for el in doc.findall(".//w:t",NS)).upper()
    tables = doc.findall(".//w:tbl",NS)
    shading = {str(_attribute(el,"fill","")).upper()
               for el in doc.findall(".//w:shd",NS)}
    blockers=[]
    notes=[]
    if not sections or any(v is None for v in sections):
        blockers.append("SECTION_GEOMETRY_MISSING")
    else:
        for i, section in enumerate(sections):
            reference = COVER if i == 0 else (LANDSCAPE if section["orientation"] == "landscape" else PORTRAIT)
            for key,value in reference.items():
                if abs(section["margins_cm"][key]-value)>TOLERANCE_CM:
                    blockers.append("MARGIN_MISMATCH_SECTION_%d_%s" % (i+1,key.upper()))
        if sections[0]["orientation"] != "portrait":
            blockers.append("COVER_NOT_PORTRAIT")
        if len(sections)<2:
            blockers.append("COVER_BODY_NOT_SEPARATED")
    if "DOCUMENTO DI VALUTAZIONE DEI RISCHI" not in text:
        blockers.append("DUVRI_COVER_TITLE_MISSING")
    if "INDICE DEL DOCUMENTO" not in text:
        blockers.append("TABLE_OF_CONTENTS_MISSING")
    if "C6D9F1" not in shading:
        blockers.append("SIGNATURE_BLUE_STYLE_MISSING")
    if len(tables)<2:
        blockers.append("COVER_SIGNATURE_OR_DATE_TABLE_MISSING")
    if not parts["images"]:
        blockers.append("COLLIGO_BRANDING_IMAGE_MISSING")
    if not parts["headers"] or not parts["footers"]:
        blockers.append("CORPORATE_HEADERS_OR_FOOTERS_MISSING")
    if any(s["orientation"] == "landscape" for s in sections if s):
        notes.append("Landscape sections are intentionally allowed and must retain their original page breaks.")
    notes.append("No content, risks, signatures or reviewer comments were modified or approved.")
    notes.append("Final Word Desktop PDF pagination and visual QA remain mandatory.")
    return {
        "schema":"colligo-duvri-layout-qa/1.0",
        "profile_id":LAYOUT_ID,
        "state":"layout_reference_qa_passed" if not blockers else "layout_reference_qa_blocked",
        "section_count":len(sections),
        "table_count":len(tables),
        "parts":parts,
        "sections":sections,
        "blocker_codes":sorted(set(blockers)),
        "notes":notes,
        "document_modified":False,
        "issuance_allowed":False
    }

def main(argv=None):
    import argparse
    p=argparse.ArgumentParser()
    p.add_argument("docx",type=Path)
    p.add_argument("--out",type=Path,default=None)
    args=p.parse_args(argv)
    try:
        report=audit(args.docx)
    except (ValueError,OSError,ET.ParseError,zipfile.BadZipFile):
        report={"schema":"colligo-duvri-layout-qa/1.0","profile_id":LAYOUT_ID,
                "state":"layout_reference_qa_blocked","blocker_codes":["FILE_OR_XML_REJECTED"],
                "document_modified":False,"issuance_allowed":False}
    data=json.dumps(report,ensure_ascii=False,indent=2)
    if args.out:
        if args.out.resolve()==args.docx.resolve() or args.out.exists():
            raise SystemExit("OUTPUT_EXISTS_OR_DOCX_TARGET")
        args.out.write_text(data,encoding="utf-8")
    else:
        print(data)
    return 0 if report["state"]=="layout_reference_qa_passed" else 2

if __name__=="__main__":
    sys.exit(main())
