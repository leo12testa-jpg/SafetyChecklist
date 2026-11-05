#!/usr/bin/env python3
"""Conservative acceptance audit for realistic *synthetic* DUVRI draft DOCX.

Does not replace source-mapping, expert HSE review, Word page QA or D1/D2.
NEVER grants issuance; reports only counts/indices, no private text or path.
"""
from __future__ import annotations

import argparse
import json
import re
import unicodedata
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

SPEC=Path(__file__).resolve().parents[1]/'fixtures'/'duvri-realistic-synthetic-cases.v1.json'
W='{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
SCHEMA='colligo-duvri-realistic-draft-acceptance/1.0'
LABEL=re.compile(r'\bNON\s+EMETTIBILE\b',re.I)


def normalize(value:str)->str:
    text=unicodedata.normalize('NFKD',value)
    return ' '.join(''.join(x for x in text if not unicodedata.combining(x)).casefold().split())


def docx_text(path:Path)->tuple[str,bool]:
    with zipfile.ZipFile(path) as z:
        entries=z.infolist()
        if len(entries)>1000 or sum(x.file_size for x in entries)>45_000_000:
            raise ValueError('UNTRUSTED_WORD_ARCHIVE')
        names={n.filename for n in entries}
        if 'word/document.xml' not in names or len(names)!=len(entries):
            raise ValueError('UNTRUSTED_WORD_ARCHIVE')
        texts=[]
        marker=False
        for name in names:
            if name!='word/document.xml' and not re.fullmatch(r'word/(?:header|footer)\d+\.xml',name):
                continue
            source=z.read(name)
            if len(source)>8_000_000 or b'<!DOCTYPE' in source.upper():
                raise ValueError('UNTRUSTED_WORD_XML')
            root=ET.fromstring(source)
            paragraphs=[''.join(x.text or '' for x in p.iter(W+'t'))
                        for p in root.iter(W+'p')]
            combined='\n'.join(paragraphs)
            if LABEL.search(normalize(combined)):
                marker=True
            texts.append(combined)
        return normalize('\n'.join(texts)),marker


def assess(case_id:str,path:Path)->dict:
    spec=json.loads(SPEC.read_text('utf8'))
    if spec.get('synthetic_only') is not True:
        raise ValueError('SYNTHETIC_ONLY')
    matches=[s for s in spec['cases'] if s['id']==case_id]
    if len(matches)!=1:
        raise ValueError('UNKNOWN_SYNTHETIC_CASE')
    case=matches[0]
    content,marker=docx_text(path)
    wanted=[case['committente'],case['intervention'],*case['acceptance']['must_mention']]
    absent=[i for i,value in enumerate(wanted) if normalize(value) not in content]
    unsupported=[i for i,value in enumerate(case['acceptance']['unknown_must_not_be_asserted'])
                 if normalize(value) in content]
    questions=[i for i,value in enumerate(case['acceptance']['mandatory_questions'])
               if normalize(value) not in content]
    # Questions can be summarized in a clarification register outside Word.
    # Their omission in DOCX is informational, not automatic failure.
    codes=['D1_NOT_APPROVED','D2_NOT_APPROVED',
           'EXPERT_SOURCE_REVIEW_REQUIRED','WORD_PAGE_VISUAL_REVIEW_REQUIRED']
    if absent: codes.append('SCENARIO_EXPECTED_FACTS_ABSENT')
    if unsupported: codes.append('UNSUPPORTED_SAFETY_ASSERTIONS_PRESENT')
    if not marker: codes.append('NON_EMETTIBILE_LABEL_MISSING')
    return {
        'schema_version':SCHEMA,'synthetic_only':True,'case_id':case_id,
        'state':'blocked_not_issuable',
        'core_expected_items_checked':len(wanted),
        'missing_expected_item_indices':absent,
        'forbidden_assertion_indices':unsupported,
        'unmentioned_clarification_indices':questions,
        'label_text_candidate_present':marker,
        'label_visible_all_word_pages_verified':False,
        'human_hse_review_completed':False,
        'd1_approved':False,'d2_approved':False,
        'issuance_allowed':False,'blocker_codes':codes
    }


def main()->int:
    p=argparse.ArgumentParser()
    p.add_argument('--case-id',required=True)
    p.add_argument('--docx',required=True,type=Path)
    args=p.parse_args()
    try:result=assess(args.case_id,args.docx)
    except (OSError,ValueError,zipfile.BadZipFile,ET.ParseError,json.JSONDecodeError):
        result={'schema_version':SCHEMA,'state':'blocked',
                'issuance_allowed':False,'blocker_codes':['UNREADABLE_OR_UNKNOWN_SYNTHETIC_INPUT']}
        print(json.dumps(result,sort_keys=True))
        return 2
    print(json.dumps(result,sort_keys=True))
    return 0


if __name__=='__main__':
    raise SystemExit(main())
