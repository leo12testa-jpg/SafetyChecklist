#!/usr/bin/env python3
"""Read-only editorial QA of a Colligo DUVRI DOCX draft.

Never changes a DOCX; emits only allowlisted counters and codes, no text,
customer names, paths, comments, credentials or document content. A positive
structural report is NOT proof of Microsoft Word page QA, AI review or HSE.
"""
from __future__ import annotations

import argparse
import json
import re
import zipfile
from collections import Counter
from pathlib import Path
from xml.etree import ElementTree as ET

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
SCHEMA = "colligo-duvri-demo-editorial-preflight/1.0"
MAX_ENTRIES = 1600
MAX_TOTAL = 64 * 1024 * 1024
MAX_PART = 16 * 1024 * 1024
LONG_CELL_LIMIT = 600


class UnsafeWord(ValueError):
    pass


def _safe_parts(path: Path) -> dict[str, bytes]:
    output = {}
    try:
        with zipfile.ZipFile(path) as z:
            infos = z.infolist()
            if not infos or len(infos) > MAX_ENTRIES:
                raise UnsafeWord("INVALID_ARCHIVE")
            names = [e.filename for e in infos]
            if len(names) != len(set(names)):
                raise UnsafeWord("DUPLICATE_ZIP_ENTRY")
            if any(name.startswith("/") or "\\" in name or ".." in name.split("/")
                   for name in names):
                raise UnsafeWord("UNSAFE_ZIP_PATH")
            if any(e.flag_bits & 1 for e in infos):
                raise UnsafeWord("ENCRYPTED_ZIP")
            if any(e.file_size > MAX_PART for e in infos) or sum(
                    e.file_size for e in infos) > MAX_TOTAL:
                raise UnsafeWord("DOCX_TOO_LARGE")
            for entry in infos:
                name = entry.filename
                if name == "word/document.xml" or re.fullmatch(
                        r"word/(?:header|footer)\d+\.xml", name) or name == "word/comments.xml":
                    data = z.read(entry)
                    if b"<!DOCTYPE" in data.upper() or b"<!ENTITY" in data.upper():
                        raise UnsafeWord("UNSAFE_XML")
                    output[name] = data
    except (OSError, zipfile.BadZipFile, RuntimeError) as ex:
        raise UnsafeWord("UNREADABLE_DOCX") from ex
    if "word/document.xml" not in output:
        raise UnsafeWord("DOCUMENT_PART_MISSING")
    return output


def inspect(path: Path) -> dict:
    parts = _safe_parts(path)
    paragraphs = []
    headers = []
    tables = 0
    comments = 0
    long_cells = 0
    anchors = 0
    sections = 0
    for name, data in parts.items():
        try:
            root = ET.fromstring(data)
        except ET.ParseError as ex:
            raise UnsafeWord("BROKEN_XML") from ex
        if name == "word/comments.xml":
            comments += sum(1 for _ in root.iter(W + "comment"))
            continue
        t = "\n".join("".join(x.text or "" for x in p.iter(W + "t"))
                      for p in root.iter(W + "p"))
        if name == "word/document.xml":
            paragraphs.append(t)
            sections = sum(1 for _ in root.iter(W + "sectPr"))
            tables = sum(1 for _ in root.iter(W + "tbl"))
            long_cells = sum(
                len("".join(t.text or "" for t in c.iter(W + "t"))) > LONG_CELL_LIMIT
                for c in root.iter(W + "tc"))
            anchors += sum(1 for h in root.iter(W + "hyperlink")
                           if W + "anchor" in h.attrib)
        else:
            headers.append(t)
    text = "\n".join(paragraphs + headers).upper()
    header_text = "\n".join(headers).upper()
    issues = []
    if "NON EMETTIBILE" not in text:
        issues.append("NON_EMETTIBILE_MARKER_MISSING")
    if "NON EMETTIBILE" not in header_text:
        issues.append("HEADER_FOOTER_DRAFT_MARK_MISSING")
    if "SOMMARIO DA AGGIORNARE IN WORD" in text:
        issues.append("LEGACY_TOC_PLACEHOLDER")
    if re.search(r"DUVRI_\s*\[\s*DATO NON DISPONIBILE\s*\]", text):
        issues.append("EDITORIAL_ID_NOT_RESOLVED")
    if long_cells:
        issues.append("OVERLONG_TABLE_CELLS")
    if anchors == 0:
        issues.append("NO_INTERNAL_NAVIGATION")
    if not re.search(r"\bINT\s*0?1\b", text) or not re.search(r"\bINT\s*0?2\b", text):
        issues.append("INTERFERENCE_MARKERS_INCOMPLETE")
    if "REVISIONE AI NON COMPLETATA" in text:
        issues.append("AI_REVIEW_DECLARED_INCOMPLETE")
    # A reference to a previously used synthetic checklist is informational
    # and must not be deleted without inspecting its true source locator.
    if "CHECKLIST_REAL_SYN_01.DOCX" in text:
        issues.append("LEGACY_SYNTHETIC_SOURCE_REFERENCE")
    return {
        "schema": SCHEMA,
        "scope": "read_only_structural_editorial",
        "editorial_preflight": "blocked" if issues else "candidate_passed_not_approved",
        "issue_codes": sorted(set(issues)),
        "issue_count": len(set(issues)),
        "section_count": sections,
        "table_count": tables,
        "long_cell_count": long_cells,
        "comment_count": comments,
        "internal_anchor_count": anchors,
        "word_desktop_visual_qa_completed": False,
        "source_mapping_independently_verified": False,
        "ai_review_independently_verified": False,
        "hse_review_approved": False,
        "d1_d2_approved": False,
        "issuance_allowed": False,
        "document_content_in_report": False,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("docx", type=Path)
    args = parser.parse_args()
    try:
        result = inspect(args.docx)
        code = 0 if result["editorial_preflight"] == "candidate_passed_not_approved" else 2
    except (UnsafeWord, ValueError) as ex:
        code = 2
        result = {
            "schema": SCHEMA,
            "editorial_preflight": "blocked",
            "issue_codes": ["UNREADABLE_OR_UNSAFE_DOCX"],
            "issuance_allowed": False,
            "document_content_in_report": False,
        }
    print(json.dumps(result, sort_keys=True, ensure_ascii=False))
    return code


if __name__ == "__main__":
    raise SystemExit(main())
