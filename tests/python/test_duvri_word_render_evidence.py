"""Private DUVRI rendered-page integrity tests, using only synthetic DOCX/PNG."""
from __future__ import annotations

import hashlib
import json
import struct
import subprocess
import sys
import tempfile
import unittest
import zipfile
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools"))
import duvri_word_render_evidence_check as gate  # noqa: E402

WORD_XML = (
    '<?xml version="1.0" encoding="utf-8"?>'
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
    '<w:body><w:p><w:r><w:t>SECRET_SYNTHETIC_TEXT</w:t></w:r></w:p></w:body>'
    '</w:document>'
)


def make_docx(path: Path) -> None:
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", "<Types/>")
        z.writestr("word/document.xml", WORD_XML)


def chunk(name: bytes, payload: bytes) -> bytes:
    return (struct.pack(">I", len(payload)) + name + payload
            + struct.pack(">I", zlib.crc32(payload, zlib.crc32(name)) & 0xffffffff))


def make_png(*, width: int = 300, height: int = 400, shade: int = 80) -> bytes:
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    scanlines = b"".join(b"\0" + bytes([shade, 90, 100]) * width for _ in range(height))
    return (gate.PNG_SIGNATURE + chunk(b"IHDR", ihdr)
            + chunk(b"IDAT", zlib.compress(scanlines)) + chunk(b"IEND", b""))


class DuvriWordRenderEvidenceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        home = Path(self.temp.name)
        self.docx = home / "private-DUVRI.docx"
        self.manifest = home / "secret-render.json"
        self.images = home / "renders"
        self.images.mkdir()
        make_docx(self.docx)
        self.write_bundle(2)

    def write_bundle(self, count: int = 2):
        images = []
        for page in range(1, count + 1):
            filename = f"page-{page:04d}.png"
            raw = make_png(shade=page * 40)
            (self.images / filename).write_bytes(raw)
            images.append({
                "page": page,
                "filename": filename,
                "sha256": hashlib.sha256(raw).hexdigest()
            })
        manifest = {
            "schema_version": gate.MANIFEST_VERSION,
            "draft_sha256": hashlib.sha256(self.docx.read_bytes()).hexdigest(),
            "render_run_id": "SYNTH_RENDER_RUN_001",
            "renderer_name": "SYNTH_RENDERER",
            "renderer_version": "TEST_1",
            "page_count": count,
            "page_images": images,
        }
        self.manifest.write_text(json.dumps(manifest), encoding="utf-8")
        return manifest

    def edit_manifest(self, change):
        m = json.loads(self.manifest.read_text(encoding="utf-8"))
        change(m)
        self.manifest.write_text(json.dumps(m), encoding="utf-8")

    def error(self, code):
        with self.assertRaisesRegex(gate.RenderEvidenceError, f"^{code}$"):
            gate.assess(self.docx, self.manifest, self.images)

    def test_valid_two_page_bundle_is_only_ready_for_human_visual_review(self):
        result = gate.assess(self.docx, self.manifest, self.images)
        self.assertEqual(result["state"], "page_render_evidence_ready_for_independent_review")
        self.assertEqual(result["page_images_verified"], 2)
        self.assertTrue(result["first_and_last_page_present"])
        self.assertTrue(result["all_png_integrity_checks_passed"])
        self.assertFalse(result["rendered_content_visually_reviewed"])
        self.assertFalse(result["render_provenance_independently_attested"])
        self.assertFalse(result["d1_approved"])
        self.assertFalse(result["d2_approved"])
        self.assertFalse(result["word_visual_qa_approved"])
        self.assertFalse(result["issuance_allowed"])

    def test_edited_docx_invalidates_all_render_images(self):
        make_docx(self.docx)
        with zipfile.ZipFile(self.docx, "a") as z:
            z.writestr("synthetic-mark.txt", "UPDATED")
        self.error("DRAFT_REVISION_MISMATCH")

    def test_missing_middle_page_is_rejected(self):
        (self.images / "page-0001.png").unlink()
        self.error("RENDER_IMAGE_SET_MISMATCH")

    def test_stale_extra_png_is_rejected(self):
        (self.images / "old-stale.png").write_bytes(make_png())
        self.error("RENDER_IMAGE_SET_MISMATCH")

    def test_wrong_sha_of_a_page_is_rejected(self):
        self.edit_manifest(lambda m: m["page_images"][0].update({"sha256": "f" * 64}))
        self.error("RENDER_IMAGE_HASH_MISMATCH")

    def test_png_crc_corruption_is_detected_before_hash(self):
        file = self.images / "page-0001.png"
        raw = bytearray(file.read_bytes())
        raw[35] ^= 1
        file.write_bytes(raw)
        self.error("PNG_CRC_MISMATCH")

    def test_invalid_png_signature_fails_closed(self):
        file = self.images / "page-0001.png"
        raw = file.read_bytes()
        file.write_bytes(b"NOT_PNG!" + raw[8:])
        self.error("INVALID_PNG_SIGNATURE")

    def test_page_number_out_of_order_blocks(self):
        self.edit_manifest(lambda m: m["page_images"][0].update({"page": 2}))
        self.error("MISSING_OR_UNORDERED_PAGE")

    def test_page_filename_traversal_is_blocked(self):
        self.edit_manifest(lambda m: m["page_images"][0].update(
            {"filename": "../private-secret.png"}
        ))
        self.error("INVALID_PAGE_FILENAME")

    def test_manifest_with_fewer_page_records_is_blocked(self):
        self.edit_manifest(lambda m: m["page_images"].pop())
        self.error("INCOMPLETE_RENDER_MANIFEST")

    def test_zero_pages_is_not_a_valid_render(self):
        self.edit_manifest(lambda m: m.update({"page_count": 0, "page_images": []}))
        self.error("INVALID_PAGE_COUNT")

    def test_manifest_duplicate_keys_are_rejected(self):
        text = self.manifest.read_text(encoding="utf-8")
        self.manifest.write_text(
            text.replace('"page_count": 2', '"page_count": 2, "page_count": 2'),
            encoding="utf-8"
        )
        self.error("DUPLICATE_MANIFEST_KEY")

    def test_low_resolution_page_fails(self):
        low = make_png(width=32, height=32)
        (self.images / "page-0001.png").write_bytes(low)
        self.error("INVALID_RENDER_DIMENSIONS")

    def test_unreadable_docx_cannot_be_marked_rendered(self):
        self.docx.write_bytes(b"NOT_A_DOCX")
        self.error("INVALID_OR_UNREADABLE_DRAFT")

    def test_symlink_render_image_is_rejected_if_supported(self):
        target = self.images / "page-0001.png"
        data = target.read_bytes()
        target.unlink()
        linked_target = Path(self.temp.name) / "other.png"
        linked_target.write_bytes(data)
        try:
            target.symlink_to(linked_target)
        except (OSError, NotImplementedError):
            self.skipTest("Symlinks not available on this test platform")
        self.error("RENDER_PAGE_MISSING_OR_LINK")

    def test_cli_does_not_echo_paths_hashes_or_customer_text(self):
        cli = subprocess.run(
            [sys.executable, str(ROOT / "tools" / "duvri_word_render_evidence_check.py"),
             "--docx", str(self.docx),
             "--manifest", str(self.manifest),
             "--images-dir", str(self.images)],
            capture_output=True, text=True, timeout=20, check=False
        )
        self.assertEqual(cli.returncode, 0, cli.stderr)
        output = json.loads(cli.stdout)
        self.assertFalse(output["issuance_allowed"])
        for secret in (
            "SECRET_SYNTHETIC_TEXT", str(self.docx), str(self.images),
            "SYNTH_RENDER_RUN_001", json.loads(self.manifest.read_text())["draft_sha256"],
        ):
            self.assertNotIn(secret, cli.stdout)

    def test_wrong_manifest_schema_is_rejected(self):
        self.edit_manifest(lambda m: m.update({"schema_version": "UNTRUSTED_SCHEMA"}))
        self.error("INVALID_RENDER_MANIFEST_VERSION")

    def test_png_iend_missing_is_rejected(self):
        file = self.images / "page-0001.png"
        file.write_bytes(file.read_bytes()[:-12])
        self.error("INCOMPLETE_PNG")

    def test_manifest_with_extra_private_content_is_not_accepted(self):
        self.edit_manifest(lambda m: m.update({"client_name": "SECRET_CLIENT_SYNTH"}))
        self.error("INVALID_RENDER_MANIFEST")


if __name__ == "__main__":
    unittest.main()
