#!/usr/bin/env python3
"""Fail-closed read-only source-to-Word text coverage check for DUVRI drafts.

Accepts only a private, backend-produced manifest. This tool cannot verify the
source files, infer HSE correctness, check Word pagination, or authorize issuance.
It emits aggregate counts and fixed error codes ONLY: never input text or paths.
No internet, OCR, model calls, or writes to the DOCX.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import sys
import xml.etree.ElementTree as ET
import zipfile

SCHEMA = "colligo-duvri-word-source-coverage/1.0"
WORD_NS = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
IDENTIFIER = re.compile(r"^[A-Za-z0-9_-]{6,128}$")
SHA256 = re.compile(r"^[a-fA-F0-9]{64}$")
WORD_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"
MAX_MANIFEST_BYTES = 1024 * 1024
MAX_DOCX_BYTES = 50 * 1024 * 1024
MAX_XML_BYTES = 20 * 1024 * 1024
MAX_ZIP_ENTRIES = 4000
MAX_ZIP_TOTAL = 200 * 1024 * 1024


class GateError(Exception):
    """Contains fixed codes only; never customer content."""


def fail(code):
    raise GateError(code)


def exact_fields(value, names):
    return isinstance(value, dict) and set(value) == set(names)


def identifier(value):
    return isinstance(value, str) and bool(IDENTIFIER.fullmatch(value))


def digest(value):
    return isinstance(value, str) and bool(SHA256.fullmatch(value))


def valid_text(value, minimum, maximum):
    return (isinstance(value, str) and minimum <= len(value) <= maximum
            and value.strip() == value and value != "" and "\x00" not in value)


def normalize(value):
    return " ".join(value.split())


def manifest_checks(manifest):
    """Validate a strict contract; verified IDs/hashes are NOT backend attestations."""
    if not exact_fields(manifest, (
        "schema_version", "job_id", "document_revision_id", "draft_sha256",
        "source_files", "required_claims", "forbidden_markers"
    )):
        fail("INVALID_MANIFEST")
    if (manifest["schema_version"] != SCHEMA
            or not identifier(manifest["job_id"])
            or not identifier(manifest["document_revision_id"])
            or not digest(manifest["draft_sha256"])):
        fail("INVALID_MANIFEST")
    sources = manifest["source_files"]
    claims = manifest["required_claims"]
    markers = manifest["forbidden_markers"]
    if (not isinstance(sources, list) or not 1 <= len(sources) <= 100
            or not isinstance(claims, list) or not 1 <= len(claims) <= 500
            or not isinstance(markers, list) or len(markers) > 30):
        fail("INVALID_MANIFEST")
    source_ids = set()
    for source in sources:
        if (not exact_fields(source, ("file_id", "sha256"))
                or not identifier(source["file_id"])
                or not digest(source["sha256"])
                or source["file_id"] in source_ids):
            fail("INVALID_MANIFEST")
        source_ids.add(source["file_id"])
    claim_ids = set()
    for claim in claims:
        if (not exact_fields(claim, ("claim_id", "file_id", "locator", "exact_text"))
                or not identifier(claim["claim_id"])
                or claim["claim_id"] in claim_ids
                or claim["file_id"] not in source_ids
                or not valid_text(claim["locator"], 1, 300)
                or not valid_text(claim["exact_text"], 4, 1500)
                or normalize(claim["exact_text"]) == ""):
            fail("INVALID_MANIFEST")
        claim_ids.add(claim["claim_id"])
    if (any(not valid_text(marker, 4, 120) for marker in markers)
            or len({normalize(m).casefold() for m in markers}) != len(markers)):
        fail("INVALID_MANIFEST")
    return claims, markers, len(source_ids)


def safe_read(path, max_bytes, code):
    if path.is_symlink() or not path.is_file() or path.stat().st_size > max_bytes:
        fail(code)
    try:
        return path.read_bytes()
    except (OSError, ValueError):
        fail(code)


def parse_word_paragraphs(blob):
    if not zipfile.is_zipfile(__import__("io").BytesIO(blob)):
        fail("DOCX_NOT_WORD")
    try:
        with zipfile.ZipFile(__import__("io").BytesIO(blob)) as archive:
            infos = archive.infolist()
            names = [entry.filename for entry in infos]
            if (len(names) > MAX_ZIP_ENTRIES
                    or sum(entry.file_size for entry in infos) > MAX_ZIP_TOTAL
                    or len(set(names)) != len(names)
                    or any(name.startswith("/") or "\\" in name
                           or ".." in name.split("/") for name in names)
                    or any(name.lower().rsplit("/", 1)[-1] in
                           ("vbaproject.bin", "vbaprojectsignature.bin")
                           for name in names)):
                fail("UNSAFE_DOCX_CONTAINER")
            required = ("[Content_Types].xml", "_rels/.rels", "word/document.xml")
            if not all(name in names for name in required):
                fail("DOCX_NOT_WORD")
            meta = archive.getinfo("[Content_Types].xml")
            main = archive.getinfo("word/document.xml")
            if meta.file_size > 256 * 1024 or main.file_size > MAX_XML_BYTES:
                fail("OOXML_TOO_LARGE")
            manifest_xml = archive.read(meta)
            document_xml = archive.read(main)
    except GateError:
        raise
    except (zipfile.BadZipFile, RuntimeError, OSError, ValueError, EOFError):
        fail("DOCX_DAMAGED")
    # No external entities or custom DTDs are required for a WordprocessingML part.
    if (b"<!DOCTYPE" in document_xml.upper()
            or b"<!ENTITY" in document_xml.upper()
            or b"<!DOCTYPE" in manifest_xml.upper()):
        fail("OOXML_UNSAFE_XML")
    try:
        types_root = ET.fromstring(manifest_xml)
        root = ET.fromstring(document_xml)
    except ET.ParseError:
        fail("OOXML_INVALID")
    overrides = [
        el for el in types_root
        if el.tag.endswith("}Override")
        and el.attrib.get("PartName") == "/word/document.xml"
        and el.attrib.get("ContentType") == WORD_TYPE
    ]
    if not overrides or root.tag != WORD_NS + "document":
        fail("DOCX_NOT_WORD")
    paragraphs = []
    for p in root.iter(WORD_NS + "p"):
        # Word may split a single phrase across many w:r/w:t nodes.
        # Do not include deleted text or formatting XML as visible text.
        spans = []
        for child in p.iter():
            if child.tag == WORD_NS + "t" and child.text:
                spans.append(child.text)
            elif child.tag in (WORD_NS + "tab", WORD_NS + "br"):
                spans.append(" ")
        text = normalize("".join(spans))
        if text:
            paragraphs.append(text)
    if not paragraphs:
        fail("DOCX_EMPTY")
    return paragraphs


def assess(docx_bytes, manifest):
    claims, markers, source_count = manifest_checks(manifest)
    if hashlib.sha256(docx_bytes).hexdigest() != manifest["draft_sha256"].lower():
        fail("DRAFT_HASH_MISMATCH")
    paragraphs = parse_word_paragraphs(docx_bytes)
    expected = [normalize(c["exact_text"]) for c in claims]
    not_found = sum(not any(value in para for para in paragraphs) for value in expected)
    normalized_paragraphs = [para.casefold() for para in paragraphs]
    forbidden = sum(any(normalize(m).casefold() in para
                        for para in normalized_paragraphs) for m in markers)
    return {
        "schema_version": SCHEMA,
        "state": "candidate_text_coverage" if not_found == 0 and forbidden == 0 else "blocked",
        "sources_declared": source_count,
        "claims_required": len(claims),
        "claims_matched": len(claims) - not_found,
        "claims_missing": not_found,
        "forbidden_markers_found": forbidden,
        "source_bytes_independently_verified": False,
        "document_layout_verified": False,
        "semantic_hse_review_approved": False,
        "issuance_allowed": False,
        "error_code": None if not_found == 0 and forbidden == 0 else
                      "WORD_COVERAGE_INCOMPLETE"
    }


def blocked(code):
    return {
        "schema_version": SCHEMA, "state": "blocked",
        "sources_declared": 0, "claims_required": 0, "claims_matched": 0,
        "claims_missing": 0, "forbidden_markers_found": 0,
        "source_bytes_independently_verified": False,
        "document_layout_verified": False,
        "semantic_hse_review_approved": False,
        "issuance_allowed": False, "error_code": code
    }


def run(docx_path, manifest_path):
    try:
        manifest_bytes = safe_read(Path(manifest_path), MAX_MANIFEST_BYTES, "MANIFEST_UNAVAILABLE")
        try:
            manifest = json.loads(manifest_bytes)
        except (UnicodeError, ValueError):
            fail("INVALID_MANIFEST")
        docx = safe_read(Path(docx_path), MAX_DOCX_BYTES, "DOCX_UNAVAILABLE")
        return assess(docx, manifest)
    except GateError as exc:
        return blocked(str(exc))
    except (OSError, ValueError):
        return blocked("LOCAL_VALIDATION_ERROR")


def main():
    parser = argparse.ArgumentParser(
        description="Private local, read-only DUVRI source-to-DOCX text coverage gate")
    parser.add_argument("--docx", required=True)
    parser.add_argument("--manifest", required=True)
    args = parser.parse_args()
    report = run(args.docx, args.manifest)
    print(json.dumps(report, sort_keys=True, separators=(",", ":")))
    return 0 if report["state"] == "candidate_text_coverage" else 2


if __name__ == "__main__":
    sys.exit(main())
