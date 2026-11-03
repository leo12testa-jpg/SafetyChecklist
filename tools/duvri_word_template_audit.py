#!/usr/bin/env python3
"""Read-only, offline OOXML inventory for private Colligo DUVRI templates.

Reports counts and hashes ONLY. Never prints document text, comments, authors,
file paths or filenames. Does not infer or grant D1/D2 approval.
Standard library only; suitable for running against a PRIVATE local DOCX.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

SCHEMA = "colligo-duvri-word-template-audit/1.0"
W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
MAIN = "word/document.xml"
COMMENTS = "word/comments.xml"
MAX_ENTRIES = 4000
MAX_DECLARED_BYTES = 250 * 1024 * 1024
MAX_XML_BYTES = 32 * 1024 * 1024

# Individual numbers are not logical placeholder counts. A logical field can
# contain several highlighted runs, and Word may split runs when saving.
METRICS = (
    "file_size_bytes",
    "archive_entries",
    "main_xml_structure_sha256",
    "paragraphs",
    "tables",
    "section_properties",
    "yellow_highlight_nodes",
    "yellow_highlight_runs",
    "yellow_highlight_groups_per_paragraph",
    "yellow_shading_nodes",
    "comments",
    "comment_anchor_starts",
    "comment_anchor_ends",
    "comment_references",
    "comment_anchors_consistent",
    "tracked_change_elements",
)


class InvalidTemplate(ValueError):
    """Malformed, unsupported or overly large OOXML input."""


def _file_hash(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _safe_archive(archive: zipfile.ZipFile) -> dict[str, zipfile.ZipInfo]:
    infos = archive.infolist()
    if len(infos) > MAX_ENTRIES:
        raise InvalidTemplate("OOXML_ENTRY_LIMIT_EXCEEDED")
    entries: dict[str, zipfile.ZipInfo] = {}
    total = 0
    for item in infos:
        name = item.filename
        parts = name.replace("\\", "/").split("/")
        if name.startswith(("/", "\\")) or ".." in parts or "\\" in name:
            raise InvalidTemplate("UNSAFE_OOXML_ENTRY")
        if name in entries:
            raise InvalidTemplate("DUPLICATE_OOXML_ENTRY")
        if item.flag_bits & 0x1:
            raise InvalidTemplate("ENCRYPTED_OOXML_NOT_SUPPORTED")
        # Read-only: reject symlink-like entries rather than following them.
        if (item.external_attr >> 16) & 0o170000 == 0o120000:
            raise InvalidTemplate("UNSAFE_OOXML_ENTRY")
        total += item.file_size
        if total > MAX_DECLARED_BYTES:
            raise InvalidTemplate("OOXML_UNCOMPRESSED_SIZE_LIMIT_EXCEEDED")
        entries[name] = item
    if MAIN not in entries:
        raise InvalidTemplate("MISSING_WORD_DOCUMENT_XML")
    return entries


def _read_xml(
    archive: zipfile.ZipFile, entries: dict[str, zipfile.ZipInfo], name: str
) -> ET.Element | None:
    info = entries.get(name)
    if info is None:
        return None
    if info.file_size > MAX_XML_BYTES:
        raise InvalidTemplate("OOXML_PART_SIZE_LIMIT_EXCEEDED")
    raw = archive.read(name)
    if len(raw) > MAX_XML_BYTES:
        raise InvalidTemplate("OOXML_PART_SIZE_LIMIT_EXCEEDED")
    # Never resolve DTDs / entities in client-controlled XML.
    if b"<!DOCTYPE" in raw.upper() or b"<!ENTITY" in raw.upper():
        raise InvalidTemplate("OOXML_DTD_NOT_ALLOWED")
    try:
        return ET.fromstring(raw)
    except ET.ParseError as exc:
        raise InvalidTemplate("INVALID_WORD_XML") from exc


def _structure_hash(root: ET.Element) -> str:
    digest = hashlib.sha256()
    for elem in root.iter():
        # Only names/tags, never text, author info, paths or attributes.
        digest.update(elem.tag.encode("utf-8"))
        digest.update(b"\x00")
    return digest.hexdigest()


def _ids(root: ET.Element, tag: str) -> list[str | None]:
    return [e.get(W + "id") for e in root.iter(W + tag)]


def _yellow(run: ET.Element) -> bool:
    props = run.find(W + "rPr")
    if props is None:
        return False
    return any(
        e.get(W + "val", "").lower() == "yellow"
        for e in props.findall(W + "highlight")
    )


def _counts(doc: ET.Element) -> dict:
    paragraphs = list(doc.iter(W + "p"))
    yellow_nodes = 0
    yellow_runs = 0
    yellow_groups = 0
    for para in paragraphs:
        in_group = False
        # Descendant runs include runs embedded within hyperlinks and other
        # non-plain paragraph structures. Adjacent yellow runs form one group.
        for run in para.iter(W + "r"):
            is_yellow = _yellow(run)
            if is_yellow:
                yellow_runs += 1
                if not in_group:
                    yellow_groups += 1
                in_group = True
                props = run.find(W + "rPr")
                yellow_nodes += sum(
                    1 for e in props.findall(W + "highlight")
                    if e.get(W + "val", "").lower() == "yellow"
                )
            else:
                in_group = False
    yellow_shading = sum(
        1 for e in doc.iter(W + "shd")
        if e.get(W + "fill", "").upper() in ("FFFF00", "YELLOW")
    )
    return {
        "main_xml_structure_sha256": _structure_hash(doc),
        "paragraphs": len(paragraphs),
        "tables": sum(1 for _ in doc.iter(W + "tbl")),
        "section_properties": sum(1 for _ in doc.iter(W + "sectPr")),
        "yellow_highlight_nodes": yellow_nodes,
        "yellow_highlight_runs": yellow_runs,
        "yellow_highlight_groups_per_paragraph": yellow_groups,
        "yellow_shading_nodes": yellow_shading,
        "tracked_change_elements": sum(
            1 for e in doc.iter()
            if e.tag in (W + "ins", W + "del", W + "moveFrom", W + "moveTo")
        ),
        "comment_anchor_starts": len(_ids(doc, "commentRangeStart")),
        "comment_anchor_ends": len(_ids(doc, "commentRangeEnd")),
        "comment_references": len(_ids(doc, "commentReference")),
    }


def inspect(path: Path) -> dict:
    if not path.is_file():
        raise InvalidTemplate("DOCX_NOT_FOUND")
    try:
        with zipfile.ZipFile(path, "r") as archive:
            entries = _safe_archive(archive)
            doc = _read_xml(archive, entries, MAIN)
            comments = _read_xml(archive, entries, COMMENTS)
    except (zipfile.BadZipFile, zipfile.LargeZipFile, RuntimeError, OSError) as exc:
        raise InvalidTemplate("INVALID_OR_UNREADABLE_DOCX_ARCHIVE") from exc

    if doc is None:
        raise InvalidTemplate("MISSING_WORD_DOCUMENT_XML")
    if not doc.tag.startswith(W):
        raise InvalidTemplate("UNSUPPORTED_WORD_XML_NAMESPACE")
    if comments is not None and not comments.tag.startswith(W):
        raise InvalidTemplate("UNSUPPORTED_WORD_XML_NAMESPACE")
    metrics = _counts(doc)
    comment_ids = (
        _ids(comments, "comment") if comments is not None else []
    )
    start_ids = _ids(doc, "commentRangeStart")
    end_ids = _ids(doc, "commentRangeEnd")
    reference_ids = _ids(doc, "commentReference")
    metrics.update({
        "file_size_bytes": path.stat().st_size,
        "file_sha256": _file_hash(path),
        "archive_entries": len(entries),
        "comments": len(comment_ids),
        "comment_anchors_consistent": (
            len(comment_ids) == len(set(comment_ids))
            and sorted(comment_ids) == sorted(start_ids) == sorted(end_ids)
            and set(reference_ids).issubset(set(comment_ids))
        ),
    })
    return {
        "schema_version": SCHEMA,
        "metrics": metrics,
        # These are NEVER inferred from document statistics.
        "logical_fields_mapped": None,
        "d1_approved": False,
        "d2_approved": False,
        "word_visual_qa_approved": False,
        "issuance_allowed": False,
    }


def compare(left: dict, right: dict) -> dict:
    a = left["metrics"]
    b = right["metrics"]
    changed = [name for name in METRICS if a[name] != b[name]]
    return {
        "schema_version": SCHEMA,
        "mode": "compare",
        "same_exact_file_sha256": a["file_sha256"] == b["file_sha256"],
        "changed_metric_names": changed,
        "comparison_complete": True,
        "d1_approved": False,
        "d2_approved": False,
        "issuance_allowed": False,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Offline, metadata-only DOCX audit; never authorizes DUVRI"
    )
    parser.add_argument("docx", type=Path)
    parser.add_argument("--compare", type=Path, default=None)
    args = parser.parse_args(argv)
    try:
        first = inspect(args.docx)
        result = compare(first, inspect(args.compare)) if args.compare else first
    except (InvalidTemplate, ValueError) as exc:
        # Only fixed codes generated by this tool; never print exception
        # details or private filenames from a document.
        code = str(exc)
        if not (code.isupper() and all(c.isupper() or c.isdigit() or c == "_" for c in code)):
            code = "INVALID_TEMPLATE"
        print(json.dumps({"schema_version": SCHEMA, "state": "blocked",
                          "error_code": code, "d2_approved": False,
                          "issuance_allowed": False}, sort_keys=True))
        return 2
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
