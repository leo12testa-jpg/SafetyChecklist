#!/usr/bin/env python3
"""Offline read-only structural QA of original/marked SYNTHETIC DUVRI Word copies.

Never determines per-page visual conformity, technical HSE approval or issuance.
Manifest must explicitly declare synthetic_only; output never echoes document text.
"""
from __future__ import annotations

import argparse
import json
import re
import unicodedata
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
R = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'
REL = '{http://schemas.openxmlformats.org/package/2006/relationships}'
LABEL = re.compile(r'NON\s+EMETTIBILE', re.I)
SCHEMA = 'colligo-duvri-synthetic-word-pair-audit/1.0'


def _zip(path: Path) -> dict[str, bytes]:
    with zipfile.ZipFile(path) as f:
        entries = f.infolist()
        if len(entries) > 1000 or sum(x.file_size for x in entries) > 45_000_000:
            raise ValueError('UNTRUSTED_ARCHIVE')
        names = [x.filename for x in entries]
        if len(names) != len(set(names)) or any(
            '..' in n.split('/') or n.startswith('/') for n in names
        ):
            raise ValueError('UNTRUSTED_ARCHIVE')
        return {n: f.read(n) for n in names if n.startswith('word/')}


def _xml(parts: dict[str, bytes], name: str) -> ET.Element:
    raw = parts.get(name)
    if not raw or len(raw) > 8_000_000 or b'<!DOCTYPE' in raw.upper():
        raise ValueError('UNTRUSTED_WORD_XML')
    return ET.fromstring(raw)


def _text(root: ET.Element) -> str:
    return '\n'.join(''.join(x.text or '' for x in para.iter(W + 't'))
                     for para in root.iter(W + 'p'))


def _normalize(text: str) -> str:
    return ' '.join(unicodedata.normalize('NFKC', text).split()).casefold()


def _header_label_candidate(root: ET.Element) -> bool:
    """Structural candidate only; does not prove a single page renders it."""
    parents = {child: parent for parent in root.iter() for child in parent}
    for paragraph in root.iter(W + 'p'):
        pieces = []
        for run in paragraph.iter(W + 'r'):
            props = run.find(W + 'rPr')
            if props is not None:
                if any(props.find(W + name) is not None
                       for name in ('vanish', 'webHidden', 'specVanish')):
                    continue
                color = props.find(W + 'color')
                if color is not None and color.get(W + 'val', '').upper() == 'FFFFFF':
                    continue
            parent, discarded = run, False
            while parent in parents:
                parent = parents[parent]
                if parent.tag in (W + 'del', W + 'moveFrom'):
                    discarded = True
                    break
            if not discarded:
                pieces.extend(el.text or '' for el in run.iter(W + 't'))
        if LABEL.search(''.join(pieces)):
            return True
    return False


def _headers(parts: dict[str, bytes]) -> tuple[bool, int, list[str]]:
    document = _xml(parts, 'word/document.xml')
    relations = _xml(parts, 'word/_rels/document.xml.rels')
    targets = {}
    for item in relations.findall(REL + 'Relationship'):
        rid, target = item.get('Id'), item.get('Target', '')
        if item.get('TargetMode') == 'External':
            continue
        if 'header' in item.get('Type', ''):
            name = target.split('/')[-1]
            if not re.fullmatch(r'header\d+\.xml', name):
                raise ValueError('UNTRUSTED_HEADER_REFERENCE')
            targets[rid] = 'word/' + name
    sections = list(document.iter(W + 'sectPr'))
    if not sections:
        return False, 0, ['MISSING_SECTION_MAP']
    even_odd = False
    if 'word/settings.xml' in parts:
        settings = _xml(parts, 'word/settings.xml')
        even_odd = settings.find(W + 'evenAndOddHeaders') is not None
    current: dict[str, str] = {}
    gaps: list[str] = []
    for idx, section in enumerate(sections):
        for ref in section.findall(W + 'headerReference'):
            kind = ref.get(W + 'type', 'default')
            current[kind] = targets.get(ref.get(R + 'id', ''), '')
        types = ['default']
        if section.find(W + 'titlePg') is not None:
            types.append('first')
        if even_odd:
            types.append('even')
        for kind in types:
            part = current.get(kind)
            if not part or part not in parts or not _header_label_candidate(_xml(parts, part)):
                gaps.append(f'{idx}:{kind}')
    return len(gaps) == 0, len(sections), gaps


def _manifest(path: Path | None) -> dict:
    if path is None:
        return {'expected_values': [], 'forbidden_terms': []}
    data = json.loads(path.read_text('utf-8'))
    if not isinstance(data, dict) or data.get('synthetic_only') is not True:
        raise ValueError('SYNTHETIC_MANIFEST_REQUIRED')
    allowed = ('expected_values', 'forbidden_terms')
    for key in allowed:
        values = data.get(key, [])
        if not isinstance(values, list) or len(values) > 100 or any(
            not isinstance(x, str) or not x.strip() or len(x) > 400 for x in values
        ):
            raise ValueError('INVALID_SYNTHETIC_MANIFEST')
    return {k: data.get(k, []) for k in allowed}


def inspect(original: Path, marked: Path, manifest: Path | None = None) -> dict:
    a, b, m = _zip(original), _zip(marked), _manifest(manifest)
    same_body = a.get('word/document.xml') == b.get('word/document.xml')
    header_complete, sections, gaps = _headers(b)
    doc = _xml(b, 'word/document.xml')
    body = _text(doc)
    hdr = '\n'.join(_text(_xml(b, name)) for name in b
                    if re.fullmatch(r'word/header\d+\.xml', name))
    full = _normalize(body + '\n' + hdr)
    missing = [i for i, value in enumerate(m['expected_values'])
               if _normalize(value) not in full]
    forbidden = [i for i, value in enumerate(m['forbidden_terms'])
                 if _normalize(value) in full]
    comments = 0
    if 'word/comments.xml' in b:
        comments = len(_xml(b, 'word/comments.xml').findall(W + 'comment'))
    yellow = sum(1 for n in doc.iter(W + 'highlight')
                 if n.get(W + 'val') in ('yellow', 'darkYellow'))
    codes = ['HUMAN_WORD_RENDER_REVIEW_REQUIRED', 'D1_NOT_APPROVED', 'D2_NOT_APPROVED']
    if not same_body:
        codes.append('MARKING_CHANGED_DOCUMENT_BODY')
    if not header_complete:
        codes.append('MARKER_HEADER_ROUTING_INCOMPLETE')
    if missing:
        codes.append('EXPECTED_SYNTHETIC_VALUE_MISSING')
    if forbidden:
        codes.append('SCENARIO_TEXT_CONTEXT_MISMATCH')
    if comments:
        codes.append('EDITORIAL_COMMENTS_OPEN')
    if yellow:
        codes.append('YELLOW_HIGHLIGHTS_OPEN')
    return {
        'schema_version': SCHEMA,
        'state': 'blocked_pending_independent_word_qa',
        'main_document_xml_unchanged': same_body,
        'marked_header_routes_have_label_candidate': header_complete,
        'sections_examined': sections,
        'header_routes_missing_label': gaps,
        'expected_values_checked': len(m['expected_values']),
        'missing_expected_value_indices': missing,
        'forbidden_terms_checked': len(m['forbidden_terms']),
        'present_forbidden_term_indices': forbidden,
        'editorial_comment_count': comments,
        'yellow_highlight_count': yellow,
        'word_pages_visually_verified': 0,
        'label_visible_on_every_page_verified': False,
        'issuance_allowed': False,
        'blocker_codes': codes,
    }


def main():
    parser = argparse.ArgumentParser(description='Read-only synthetic DUVRI Word copy QA')
    parser.add_argument('original', type=Path)
    parser.add_argument('marked', type=Path)
    parser.add_argument('--manifest', type=Path)
    args = parser.parse_args()
    try:
        result = inspect(args.original, args.marked, args.manifest)
    except (OSError, ValueError, zipfile.BadZipFile, ET.ParseError, json.JSONDecodeError):
        result = {'schema_version': SCHEMA, 'state': 'blocked',
                  'blocker_codes': ['UNREADABLE_OR_UNTRUSTED_INPUT'],
                  'issuance_allowed': False}
        print(json.dumps(result, sort_keys=True))
        return 2
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
