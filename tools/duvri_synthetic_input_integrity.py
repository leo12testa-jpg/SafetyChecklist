#!/usr/bin/env python3
"""Verify the four approved SYNTHETIC DUVRI input bundles against real bytes.

No model, network, Word master, customer document or issuance action.
Returns fixed status codes/counts only: never prints filenames, paths or text.
A validated test input is NOT a validated generated DUVRI.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import stat
import zipfile
from pathlib import Path, PurePosixPath

CASES = ("SIM-01-MANUTENZIONE", "SIM-02-COPERTURA-PV",
         "SIM-03-POZZETTO", "SIM-04-ARCHIVIO")
MIME = {
    "01_CHECKLIST_CLIENTE_COMPILATA.docx":
        ("application/vnd.openxmlformats-officedocument.wordprocessingml.document", "client_checklist"),
    "02_CAPITOLATO.pdf": ("application/pdf", "supporting_document"),
    "03_CRONOPROGRAMMA.xlsx":
        ("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "supporting_document"),
    "04_PIANTA_FITTIZIA.png": ("image/png", "drawing"),
}
SCHEMA = "colligo-duvri-synthetic-input-integrity/1.0"
MANIFEST = "00_FASCICOLO_MANIFEST.json"
EXTRAS = {"LEGGIMI.txt"}
ARCHIVE = "FASCICOLI_DUVRI_REALISTICI_SINTETICI_V1.zip"
SUMMARY = "RIEPILOGO_SICUREZZA.json"
MAX_INPUT = 12_000_000
MAX_MANIFEST = 80_000
SHA = re.compile(r"[a-f0-9]{64}\Z")


class BlockedInput(ValueError):
    pass


def _unique_pairs(pairs):
    found = {}
    for key, value in pairs:
        if key in found:
            raise BlockedInput("DUPLICATE_MANIFEST_FIELD")
        found[key] = value
    return found


def _safe_regular(path: Path, maximum: int) -> bytes:
    if path.is_symlink():
        raise BlockedInput("SYMLINK_NOT_ALLOWED")
    try:
        st = path.lstat()
    except OSError as exc:
        raise BlockedInput("MISSING_INPUT") from exc
    if not stat.S_ISREG(st.st_mode) or st.st_nlink != 1:
        raise BlockedInput("NOT_REGULAR_FILE")
    if not 1 <= st.st_size <= maximum:
        raise BlockedInput("INPUT_SIZE_REJECTED")
    try:
        with path.open("rb") as handle:
            data = handle.read(maximum + 1)
    except OSError as exc:
        raise BlockedInput("INPUT_UNREADABLE") from exc
    if len(data) != st.st_size:
        raise BlockedInput("CHANGED_INPUT")
    return data


def _office_archive(data: bytes, required: set[str]) -> None:
    from io import BytesIO
    try:
        with zipfile.ZipFile(BytesIO(data)) as archive:
            entries = archive.infolist()
            if len(entries) > 256 or sum(e.file_size for e in entries) > 30_000_000:
                raise BlockedInput("UNSAFE_OFFICE_ARCHIVE")
            names = [e.filename for e in entries]
            if len(names) != len(set(names)) or not required.issubset(set(names)):
                raise BlockedInput("UNSAFE_OFFICE_PARTS")
            for e in entries:
                p = PurePosixPath(e.filename)
                if p.is_absolute() or ".." in p.parts or e.flag_bits & 0x1:
                    raise BlockedInput("UNSAFE_OFFICE_PART")
    except (zipfile.BadZipFile, OSError, RuntimeError) as exc:
        raise BlockedInput("INVALID_OFFICE_ARCHIVE") from exc


def _kind_ok(filename: str, data: bytes) -> None:
    if filename.endswith(".docx"):
        _office_archive(data, {"[Content_Types].xml", "word/document.xml"})
    elif filename.endswith(".xlsx"):
        _office_archive(data, {"[Content_Types].xml", "xl/workbook.xml"})
    elif filename.endswith(".pdf"):
        if not data.startswith(b"%PDF-") or b"%%EOF" not in data[-128:]:
            raise BlockedInput("INVALID_PDF")
    elif filename.endswith(".png"):
        if not data.startswith(b"\x89PNG\r\n\x1a\n") or not data.endswith(
                b"\x00\x00\x00\x00IEND\xaeB\x60\x82"):
            raise BlockedInput("INVALID_PNG")
    else:
        raise BlockedInput("UNEXPECTED_EXTENSION")


def _directory(path: Path) -> None:
    try:
        st = path.lstat()
    except OSError as exc:
        raise BlockedInput("MISSING_DIRECTORY") from exc
    if not stat.S_ISDIR(st.st_mode) or path.is_symlink():
        raise BlockedInput("INVALID_DIRECTORY")


def verify_case(case_dir: Path, expected_id: str) -> int:
    if expected_id not in CASES or case_dir.name != expected_id:
        raise BlockedInput("WRONG_CASE_DIRECTORY")
    _directory(case_dir)
    manifest_bytes = _safe_regular(case_dir / MANIFEST, MAX_MANIFEST)
    try:
        manifest = json.loads(manifest_bytes.decode("utf-8"), object_pairs_hook=_unique_pairs)
    except (UnicodeError, json.JSONDecodeError, TypeError) as exc:
        raise BlockedInput("INVALID_MANIFEST_JSON") from exc
    if (not isinstance(manifest, dict) or manifest.get("synthetic_only") is not True
            or manifest.get("case_id") != expected_id
            or manifest.get("generation_mode") != "synthetic_test_only"
            or any(manifest.get(k) is not False for k in
                   ("d1_approved", "d2_approved", "word_visual_qa_approved",
                    "issuance_allowed"))):
        raise BlockedInput("MANIFEST_SCOPE_MISMATCH")
    records = manifest.get("files")
    if not isinstance(records, list) or not 2 <= len(records) <= 4:
        raise BlockedInput("INVALID_INPUT_LIST")
    seen_names = set()
    seen_ids = set()
    manifest_names = set()
    checklists = 0
    case_prefix = "FILE_" + expected_id.replace("-", "_") + "_"
    for rec in records:
        if not isinstance(rec, dict):
            raise BlockedInput("INVALID_FILE_RECORD")
        name = rec.get("filename")
        if not isinstance(name, str) or name not in MIME or name in seen_names:
            raise BlockedInput("UNEXPECTED_OR_DUPLICATE_FILENAME")
        seen_names.add(name)
        doc_id = rec.get("file_id")
        if (not isinstance(doc_id, str) or not doc_id.startswith(case_prefix)
                or not re.fullmatch(case_prefix + r"[0-9]{2}", doc_id)
                or doc_id in seen_ids):
            raise BlockedInput("CROSS_CASE_OR_DUPLICATE_FILE_ID")
        seen_ids.add(doc_id)
        if (rec.get("job_id") != expected_id.replace("-", "_")
                or rec.get("role") != MIME[name][1]
                or rec.get("mime_type") != MIME[name][0]
                or rec.get("parse_status") != "pending"):
            raise BlockedInput("CROSS_CASE_OR_ROLE_MISMATCH")
        if name.startswith("01_"):
            checklists += 1
        data = _safe_regular(case_dir / name, MAX_INPUT)
        declared_sha = rec.get("sha256")
        if (type(rec.get("size_bytes")) is not int or rec["size_bytes"] != len(data)
                or not isinstance(declared_sha, str) or not SHA.fullmatch(declared_sha)
                or hashlib.sha256(data).hexdigest() != declared_sha):
            raise BlockedInput("SOURCE_BYTES_MISMATCH")
        _kind_ok(name, data)
    if checklists != 1 or "02_CAPITOLATO.pdf" not in seen_names:
        raise BlockedInput("CHECKLIST_OR_CORE_ATTACHMENT_MISSING")
    allowed = seen_names | {MANIFEST} | EXTRAS
    if {p.name for p in case_dir.iterdir()} != allowed:
        raise BlockedInput("EXTRA_OR_MISSING_CASE_FILES")
    for name in EXTRAS:
        _safe_regular(case_dir / name, MAX_MANIFEST)
    return len(records)


def verify_corpus(root: Path) -> dict:
    _directory(root)
    actual = {p.name for p in root.iterdir()}
    expected = set(CASES) | {ARCHIVE, SUMMARY}
    if actual != expected:
        raise BlockedInput("EXTRA_OR_MISSING_CASE_DIRECTORY")
    count = sum(verify_case(root / case, case) for case in CASES)
    archive_bytes = _safe_regular(root / ARCHIVE, 30_000_000)
    summary_bytes = _safe_regular(root / SUMMARY, MAX_MANIFEST)
    try:
        summary = json.loads(summary_bytes.decode("utf-8"), object_pairs_hook=_unique_pairs)
    except (UnicodeError, json.JSONDecodeError, TypeError) as exc:
        raise BlockedInput("INVALID_SUMMARY") from exc
    if (not isinstance(summary, dict)
            or summary.get("synthetic_only") is not True
            or summary.get("issuance_allowed") is not False
            or summary.get("archive_name") != ARCHIVE
            or summary.get("archive_sha256") != hashlib.sha256(archive_bytes).hexdigest()):
        raise BlockedInput("ARCHIVE_SUMMARY_MISMATCH")
    from io import BytesIO
    try:
        with zipfile.ZipFile(BytesIO(archive_bytes)) as z:
            actual_members = z.infolist()
            expected_members = {f"{case}/{p.name}" for case in CASES
                                for p in (root / case).iterdir()}
            if (len(actual_members) != len(expected_members)
                    or {p.filename for p in actual_members} != expected_members):
                raise BlockedInput("ARCHIVE_MEMBERS_MISMATCH")
            for entry in actual_members:
                if (entry.flag_bits & 0x1 or entry.file_size > MAX_INPUT
                        or entry.filename.startswith("/")
                        or ".." in PurePosixPath(entry.filename).parts):
                    raise BlockedInput("ARCHIVE_MEMBER_UNSAFE")
                if z.read(entry) != _safe_regular(root / entry.filename, MAX_INPUT):
                    raise BlockedInput("ARCHIVE_FILE_DIFFERS")
    except (zipfile.BadZipFile, OSError, RuntimeError) as exc:
        raise BlockedInput("ARCHIVE_UNREADABLE") from exc
    return {
        "schema_version": SCHEMA, "synthetic_only": True,
        "state": "input_integrity_passed_not_issuable",
        "case_count": len(CASES), "input_count": count,
        "client_checklist_count": len(CASES),
        "human_hse_review_completed": False,
        "d1_approved": False, "d2_approved": False,
        "issuance_allowed": False, "blocker_codes": ["HSE_AND_D1_D2_REQUIRED"],
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--corpus", required=True, type=Path)
    args = parser.parse_args()
    try:
        result = verify_corpus(args.corpus)
    except (BlockedInput, OSError, ValueError):
        result = {
            "schema_version": SCHEMA, "synthetic_only": True,
            "state": "blocked_input_integrity", "case_count": 0,
            "issuance_allowed": False, "blocker_codes": ["SOURCE_INTEGRITY_BLOCKED"],
        }
        print(json.dumps(result, sort_keys=True))
        return 2
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
