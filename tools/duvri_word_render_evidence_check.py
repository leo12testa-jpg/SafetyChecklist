#!/usr/bin/env python3
"""Independent read-only integrity gate for PRIVATE rendered DUVRI draft pages.

Given a DOCX, a renderer manifest, and rendered PNG files, verify that all
declared page images exist, have valid PNG chunk CRCs, and match SHA-256 hashes.
This does NOT render a DOCX, compare layouts, inspect images visually, prove
they were generated from the DOCX, or authorize professional issuance.

All paths and hashes stay local. Output contains only fixed codes and counts.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import struct
import sys
import zlib
from pathlib import Path

import duvri_word_template_audit as word_audit

SCHEMA = "colligo-duvri-render-evidence-check/1.0"
MANIFEST_VERSION = "colligo-duvri-render-evidence-manifest/1.0"
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
MAX_MANIFEST_BYTES = 128 * 1024
MAX_PAGES = 150
MAX_PNG_BYTES = 24 * 1024 * 1024
MAX_CHUNK_BYTES = 20 * 1024 * 1024
MAX_CHUNKS = 30000
MAX_DIMENSION = 20000
SHA256_RE = re.compile(r"^[a-f0-9]{64}$", re.IGNORECASE)
RENDERER_RE = re.compile(r"^[A-Za-z0-9_.+-]{2,80}$")
RUN_RE = re.compile(r"^[A-Za-z0-9_-]{6,128}$")


class RenderEvidenceError(ValueError):
    """Expected private input or integrity problem; do not expose paths."""


def _reject_duplicates(pairs: list[tuple[str, object]]) -> dict:
    out = {}
    for key, value in pairs:
        if key in out:
            raise RenderEvidenceError("DUPLICATE_MANIFEST_KEY")
        out[key] = value
    return out


def _read_manifest(path: Path) -> dict:
    if path.is_symlink() or not path.is_file():
        raise RenderEvidenceError("MANIFEST_NOT_FOUND_OR_LINK")
    if path.stat().st_size > MAX_MANIFEST_BYTES:
        raise RenderEvidenceError("MANIFEST_SIZE_LIMIT")
    try:
        with path.open("rb") as stream:
            doc = json.loads(stream.read(), object_pairs_hook=_reject_duplicates)
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise RenderEvidenceError("INVALID_RENDER_MANIFEST") from exc
    if not isinstance(doc, dict) or set(doc) != {
        "schema_version", "draft_sha256", "render_run_id", "renderer_name",
        "renderer_version", "page_count", "page_images"
    }:
        raise RenderEvidenceError("INVALID_RENDER_MANIFEST")
    if doc["schema_version"] != MANIFEST_VERSION:
        raise RenderEvidenceError("INVALID_RENDER_MANIFEST_VERSION")
    if not isinstance(doc["draft_sha256"], str) or not SHA256_RE.fullmatch(doc["draft_sha256"]):
        raise RenderEvidenceError("INVALID_RENDER_MANIFEST")
    if not isinstance(doc["render_run_id"], str) or not RUN_RE.fullmatch(doc["render_run_id"]):
        raise RenderEvidenceError("INVALID_RENDER_MANIFEST")
    if any(not isinstance(doc[x], str) or not RENDERER_RE.fullmatch(doc[x])
           for x in ("renderer_name", "renderer_version")):
        raise RenderEvidenceError("INVALID_RENDER_MANIFEST")
    if type(doc["page_count"]) is not int or not 1 <= doc["page_count"] <= MAX_PAGES:
        raise RenderEvidenceError("INVALID_PAGE_COUNT")
    if not isinstance(doc["page_images"], list) or len(doc["page_images"]) != doc["page_count"]:
        raise RenderEvidenceError("INCOMPLETE_RENDER_MANIFEST")
    for i, item in enumerate(doc["page_images"], start=1):
        if not isinstance(item, dict) or set(item) != {"page", "filename", "sha256"}:
            raise RenderEvidenceError("INVALID_PAGE_ENTRY")
        if type(item["page"]) is not int or item["page"] != i:
            raise RenderEvidenceError("MISSING_OR_UNORDERED_PAGE")
        if item["filename"] != f"page-{i:04d}.png":
            raise RenderEvidenceError("INVALID_PAGE_FILENAME")
        if not isinstance(item["sha256"], str) or not SHA256_RE.fullmatch(item["sha256"]):
            raise RenderEvidenceError("INVALID_PAGE_HASH")
    return doc


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as f:
        for part in iter(lambda: f.read(1024 * 1024), b""):
            digest.update(part)
    return digest.hexdigest()


def _png_dimensions(path: Path) -> tuple[int, int]:
    """Verify structure and CRC for every PNG chunk without decoding pixels."""
    if path.is_symlink() or not path.is_file():
        raise RenderEvidenceError("RENDER_PAGE_MISSING_OR_LINK")
    if not 45 <= path.stat().st_size <= MAX_PNG_BYTES:
        raise RenderEvidenceError("RENDER_PAGE_SIZE_LIMIT")
    with path.open("rb") as f:
        if f.read(8) != PNG_SIGNATURE:
            raise RenderEvidenceError("INVALID_PNG_SIGNATURE")
        count = 0
        seen_ihdr = False
        seen_idat = False
        seen_iend = False
        dimensions = (0, 0)
        while True:
            header = f.read(8)
            if not header:
                break
            if len(header) != 8:
                raise RenderEvidenceError("INVALID_PNG_CHUNKS")
            length, chunk_type = struct.unpack(">I4s", header)
            count += 1
            if count > MAX_CHUNKS or length > MAX_CHUNK_BYTES:
                raise RenderEvidenceError("PNG_CHUNK_LIMIT")
            if not re.fullmatch(rb"[A-Za-z]{4}", chunk_type):
                raise RenderEvidenceError("INVALID_PNG_CHUNKS")
            content = f.read(length)
            checksum = f.read(4)
            if len(content) != length or len(checksum) != 4:
                raise RenderEvidenceError("INVALID_PNG_CHUNKS")
            expected = struct.unpack(">I", checksum)[0]
            actual = zlib.crc32(content, zlib.crc32(chunk_type)) & 0xffffffff
            if expected != actual:
                raise RenderEvidenceError("PNG_CRC_MISMATCH")
            if count == 1:
                if chunk_type != b"IHDR" or length != 13:
                    raise RenderEvidenceError("INVALID_PNG_HEADER")
                width, height, depth, color, comp, filt, interlace = struct.unpack(">IIBBBBB", content)
                if not 100 <= width <= MAX_DIMENSION or not 100 <= height <= MAX_DIMENSION:
                    raise RenderEvidenceError("INVALID_RENDER_DIMENSIONS")
                if depth not in (1, 2, 4, 8, 16) or color not in (0, 2, 3, 4, 6):
                    raise RenderEvidenceError("INVALID_PNG_HEADER")
                if comp != 0 or filt != 0 or interlace not in (0, 1):
                    raise RenderEvidenceError("INVALID_PNG_HEADER")
                dimensions = (width, height)
                seen_ihdr = True
            elif chunk_type == b"IHDR":
                raise RenderEvidenceError("INVALID_PNG_CHUNKS")
            if chunk_type == b"IDAT":
                seen_idat = True
            if chunk_type == b"IEND":
                if length != 0 or f.read(1):
                    raise RenderEvidenceError("INVALID_PNG_TRAILING_DATA")
                seen_iend = True
                break
        if not (seen_ihdr and seen_idat and seen_iend):
            raise RenderEvidenceError("INCOMPLETE_PNG")
        return dimensions


def assess(docx: Path, manifest: Path, images_dir: Path) -> dict:
    if docx.is_symlink() or not docx.is_file():
        raise RenderEvidenceError("DRAFT_NOT_FOUND_OR_LINK")
    if images_dir.is_symlink() or not images_dir.is_dir():
        raise RenderEvidenceError("RENDER_DIRECTORY_MISSING_OR_LINK")
    m = _read_manifest(manifest)
    try:
        source_hash = word_audit.inspect(docx)["metrics"]["file_sha256"]
    except (word_audit.InvalidTemplate, OSError):
        raise RenderEvidenceError("INVALID_OR_UNREADABLE_DRAFT")
    if source_hash.lower() != m["draft_sha256"].lower():
        raise RenderEvidenceError("DRAFT_REVISION_MISMATCH")
    expected = {entry["filename"] for entry in m["page_images"]}
    try:
        found = {p.name for p in images_dir.iterdir() if p.name.lower().endswith(".png")}
    except OSError as exc:
        raise RenderEvidenceError("RENDER_DIRECTORY_UNREADABLE") from exc
    if found != expected:
        raise RenderEvidenceError("RENDER_IMAGE_SET_MISMATCH")
    dimensions = []
    for entry in m["page_images"]:
        png = images_dir / entry["filename"]
        dimensions.append(_png_dimensions(png))
        if _sha256_file(png).lower() != entry["sha256"].lower():
            raise RenderEvidenceError("RENDER_IMAGE_HASH_MISMATCH")
    return {
        "schema_version": SCHEMA,
        "state": "page_render_evidence_ready_for_independent_review",
        "page_count_declared": m["page_count"],
        "page_images_verified": len(dimensions),
        "first_and_last_page_present": True,
        "all_png_integrity_checks_passed": True,
        "rendered_content_visually_reviewed": False,
        "render_provenance_independently_attested": False,
        "d1_approved": False,
        "d2_approved": False,
        "word_visual_qa_approved": False,
        "issuance_allowed": False,
        "blocker_codes": [
            "INDEPENDENT_RENDER_PROVENANCE_REQUIRED",
            "EVERY_PAGE_VISUAL_INSPECTION_REQUIRED",
            "D1_D2_APPROVAL_REQUIRED"
        ],
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Offline draft-page integrity gate (never issues DUVRI)")
    parser.add_argument("--docx", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--images-dir", type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        result = assess(args.docx, args.manifest, args.images_dir)
        exit_code = 0
    except (RenderEvidenceError, OSError, ValueError) as exc:
        code = str(exc)
        if not re.fullmatch(r"[A-Z][A-Z0-9_]{2,90}", code):
            code = "INVALID_RENDER_EVIDENCE"
        result = {
            "schema_version": SCHEMA,
            "state": "blocked",
            "page_images_verified": 0,
            "rendered_content_visually_reviewed": False,
            "word_visual_qa_approved": False,
            "issuance_allowed": False,
            "blocker_codes": [code],
        }
        exit_code = 2
    print(json.dumps(result, sort_keys=True))
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
