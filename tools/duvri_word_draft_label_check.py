#!/usr/bin/env python3
"""Offline, read-only DUVRI draft safety-label preflight.

Finds a *candidate* NON EMETTIBILE phrase in body or header/footer Word XML,
without echoing document content. A structural candidate is NOT visual proof.
The result ALWAYS blocks issuance, pending D1/D2 and independent visual QA.
Runs entirely offline with Python stdlib, on authorized private DOCX files.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

import duvri_word_template_audit as ooxml

SCHEMA = "colligo-duvri-word-draft-label-check/1.0"
W = ooxml.W
LABEL = re.compile(r"NON\s+EMETTIBILE", re.IGNORECASE)
EXCLUDED_ANCESTORS = frozenset({
    W + "del", W + "moveFrom", W + "instrText",
})


def _hidden_run(run: ET.Element) -> bool:
    props = run.find(W + "rPr")
    if props is None:
        return False
    # These are not comprehensive visual checks, but prevent obvious
    # hidden/deleted content from being counted as a label candidate.
    for tag in ("vanish", "webHidden", "specVanish"):
        element = props.find(W + tag)
        if element is not None and element.get(W + "val", "1") not in ("0", "false", "off"):
            return True
    color = props.find(W + "color")
    if color is not None and color.get(W + "val", "").upper() == "FFFFFF":
        return True
    return False


def _label_candidate(root: ET.Element) -> bool:
    parents = {child: parent for parent in root.iter() for child in parent}
    for para in root.iter(W + "p"):
        paragraph_text: list[str] = []
        for run in para.iter(W + "r"):
            if _hidden_run(run):
                continue
            ancestor = run
            discarded = False
            while ancestor in parents:
                ancestor = parents[ancestor]
                if ancestor.tag in EXCLUDED_ANCESTORS:
                    discarded = True
                    break
            if discarded:
                continue
            for text_node in run.findall(W + "t"):
                if text_node.text:
                    paragraph_text.append(text_node.text)
        if LABEL.search("".join(paragraph_text)):
            return True
    return False


def inspect(path: Path) -> dict:
    inventory = ooxml.inspect(path)
    metrics = inventory["metrics"]
    label_candidate = False
    with zipfile.ZipFile(path, "r") as archive:
        entries = ooxml._safe_archive(archive)
        for name in entries:
            # Body and potential headers/footers only. We never count comments,
            # document properties, glossary, deleted text, or arbitrary files.
            if name != ooxml.MAIN and not re.fullmatch(
                r"word/(?:header|footer)[0-9]+\.xml", name
            ):
                continue
            root = ooxml._read_xml(archive, entries, name)
            if root is None:
                continue
            expected = W + ("document" if name == ooxml.MAIN else
                            "hdr" if "/header" in name else "ftr")
            if root.tag != expected:
                raise ooxml.InvalidTemplate("UNSUPPORTED_WORD_XML_NAMESPACE")
            if _label_candidate(root):
                label_candidate = True

    reasons = []
    if not label_candidate:
        reasons.append("NON_EMETTIBILE_LABEL_NOT_IN_DOCUMENT_TEXT")
    if metrics["yellow_highlight_nodes"]:
        reasons.append("YELLOW_HIGHLIGHTS_REMAIN")
    if metrics["comments"]:
        reasons.append("WORD_COMMENTS_REMAIN")
    if metrics["tracked_change_elements"]:
        reasons.append("TRACKED_CHANGES_REMAIN")
    if not metrics["comment_anchors_consistent"]:
        reasons.append("COMMENT_ANCHORS_INCONSISTENT")
    # Even if all structural checks passed, only rendering and a human
    # reviewing EVERY page can establish legibility and correct placement.
    reasons += ["D1_NOT_APPROVED", "D2_NOT_APPROVED", "VISUAL_QA_REQUIRED"]
    return {
        "schema_version": SCHEMA,
        "state": "blocked_non_emittable_draft",
        "non_emettibile_text_candidate": label_candidate,
        "label_visually_verified": False,
        "yellow_highlight_nodes": metrics["yellow_highlight_nodes"],
        "comment_count": metrics["comments"],
        "tracked_change_elements": metrics["tracked_change_elements"],
        "blocker_codes": reasons,
        "d1_approved": False,
        "d2_approved": False,
        "word_visual_qa_approved": False,
        "issuance_allowed": False,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Private DOCX draft safety label check. Never approves DUVRI."
    )
    parser.add_argument("docx", type=Path)
    args = parser.parse_args(argv)
    try:
        outcome = inspect(args.docx)
    except (ooxml.InvalidTemplate, zipfile.BadZipFile, OSError, ValueError):
        outcome = {
            "schema_version": SCHEMA,
            "state": "blocked",
            "non_emettibile_text_candidate": False,
            "label_visually_verified": False,
            "blocker_codes": ["UNREADABLE_OR_UNTRUSTED_DOCX"],
            "d1_approved": False,
            "d2_approved": False,
            "word_visual_qa_approved": False,
            "issuance_allowed": False,
        }
        print(json.dumps(outcome, sort_keys=True))
        return 2
    print(json.dumps(outcome, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
