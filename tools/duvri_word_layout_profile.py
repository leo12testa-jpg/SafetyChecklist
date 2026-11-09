"""Deterministic offline Word-layout patch for a PINNED synthetic DUVRI draft.

Never approves/emits a DUVRI, never deletes comments, never changes margins,
images or style parts. Uses only Python stdlib. Do NOT apply to customer files.
"""
from __future__ import annotations
import hashlib
import json
import re
import zipfile
from pathlib import Path
from xml.dom import minidom

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
XML = "http://www.w3.org/XML/1998/namespace"
SCHEMA = "colligo-duvri-synthetic-layout-profile/1.0"
MAX_DOCX = 35_000_000
MAX_XML = 20_000_000
SOURCE_ID = re.compile(r"S[1-9][0-9]{0,2}\Z")
FILE_NAME = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.() -]{0,249}\.(?:docx|pdf|xlsx|png|jpg|jpeg)\Z",re.I)

class LayoutBlocked(ValueError):
    pass

def _tags(node, name):
    return node.getElementsByTagNameNS(W,name)

def _text(node):
    return "".join(n.firstChild.nodeValue if n.firstChild else "" for n in _tags(node,"t"))

def _set_text(node,value):
    while node.firstChild:
        node.removeChild(node.firstChild)
    node.appendChild(node.ownerDocument.createTextNode(value))
    if value.startswith(" ") or value.endswith(" "):
        node.setAttributeNS(XML,"xml:space","preserve")

def _replace_in_paragraph(p, entries):
    texts=_tags(p,"t")
    if not texts:
        return 0
    old=[n.firstChild.nodeValue if n.firstChild else "" for n in texts]
    joined="".join(old)
    # The legend is the sole authoritative full filename lookup.
    if any(re.search(r"(?<![A-Za-z0-9])"+re.escape(sid)+r"\s*[\-—–]\s*"+re.escape(name),joined)
           for sid,name in entries):
        return 0
    matches=[]
    for sid,name in entries:
        pos=0
        while True:
            pos=joined.find(name,pos)
            if pos<0:
                break
            matches.append((pos,pos+len(name),sid))
            pos+=len(name)
    if not matches:
        return 0
    matches.sort()
    if any(end>next_start for (_,end,_),(next_start,_,_) in zip(matches,matches[1:])):
        raise LayoutBlocked("OVERLAPPING_SOURCE_NAMES")
    offsets=[]
    cursor=0
    for val in old:
        offsets.append(cursor)
        cursor+=len(val)
    parts=[""]*len(texts)
    def append_unchanged(begin,end):
        for i,val in enumerate(old):
            low=offsets[i];high=low+len(val)
            a=max(low,begin);b=min(high,end)
            if b>a:
                parts[i]+=val[a-low:b-low]
    cursor=0
    for start,end,token in matches:
        append_unchanged(cursor,start)
        for i,val in enumerate(old):
            if offsets[i]<=start<offsets[i]+len(val):
                parts[i]+=token
                break
        else:
            raise LayoutBlocked("SOURCE_START_NOT_MAPPED")
        cursor=end
    append_unchanged(cursor,len(joined))
    # Drop only hard breaks originally positioned INSIDE a replaced filename.
    pos=0
    def walk(node):
        nonlocal pos
        for child in list(node.childNodes):
            if child.nodeType!=child.ELEMENT_NODE:
                continue
            if child.namespaceURI==W and child.localName=="t":
                pos+=len(child.firstChild.nodeValue if child.firstChild else "")
            elif child.namespaceURI==W and child.localName=="br":
                if any(start<pos<end for start,end,_ in matches):
                    node.removeChild(child)
            else:
                walk(child)
    walk(p)
    for node,value in zip(texts,parts):
        if (node.firstChild.nodeValue if node.firstChild else "")!=value:
            _set_text(node,value)
    return len(matches)

def _set_section_breaks(doc,indices,count):
    sections=_tags(doc,"sectPr")
    if len(sections)!=count:
        raise LayoutBlocked("MASTER_SECTION_COUNT_MISMATCH")
    for i in indices:
        if type(i) is not int or i<1 or i>=len(sections)-1:
            raise LayoutBlocked("UNSAFE_BREAK_INDEX")
        current,previous=sections[i],sections[i-1]
        a=_tags(previous,"pgSz");b=_tags(current,"pgSz")
        if len(a)!=1 or len(b)!=1 or any(a[0].getAttributeNS(W,k)!=b[0].getAttributeNS(W,k)
                     for k in ("w","h","orient")):
            raise LayoutBlocked("CROSS_ORIENTATION_BREAK")
        types=_tags(current,"type")
        if len(types)>1:
            raise LayoutBlocked("MALFORMED_SECTION")
        if types:
            types[0].setAttributeNS(W,"w:val","continuous")
        else:
            tag=doc.createElementNS(W,"w:type")
            tag.setAttributeNS(W,"w:val","continuous")
            current.insertBefore(tag,current.firstChild)
    return len(indices)

def _rebalance_verification_table(doc,widths):
    if len(widths)!=3 or sum(widths) not in (10560,10562,10563):
        raise LayoutBlocked("UNSAFE_TABLE_WIDTHS")
    matches=[]
    for table in _tags(doc,"tbl"):
        rows=_tags(table,"tr")
        if not rows:
            continue
        cells=[c for c in rows[0].childNodes if c.nodeType==c.ELEMENT_NODE and
               c.namespaceURI==W and c.localName=="tc"]
        header=" | ".join(_text(c).strip() for c in cells).casefold()
        if all(term in header for term in ("verifica","elementi documentali pertinenti","esito del tecnico")):
            matches.append(table)
    if len(matches)!=1:
        raise LayoutBlocked("VERIFICATION_TABLE_NOT_UNIQUE")
    table=matches[0]
    grids=_tags(table,"tblGrid")
    if len(grids)!=1:
        raise LayoutBlocked("TABLE_GRID_MISSING")
    cols=[x for x in grids[0].childNodes if x.nodeType==x.ELEMENT_NODE and
          x.namespaceURI==W and x.localName=="gridCol"]
    if len(cols)!=3:
        raise LayoutBlocked("TABLE_GRID_NOT_THREE_COLUMNS")
    for col,width in zip(cols,widths):
        col.setAttributeNS(W,"w:w",str(width))
    for row in _tags(table,"tr"):
        cells=[n for n in row.childNodes if n.nodeType==n.ELEMENT_NODE and
               n.namespaceURI==W and n.localName=="tc"]
        if len(cells)!=3:
            raise LayoutBlocked("NON_STANDARD_TABLE_ROW")
        for cell,width in zip(cells,widths):
            tcW=_tags(cell,"tcW")
            if len(tcW)!=1:
                raise LayoutBlocked("TABLE_WIDTH_MISSING")
            tcW[0].setAttributeNS(W,"w:w",str(width))
            tcW[0].setAttributeNS(W,"w:type","dxa")
    return 1

def _profile(p):
    if not isinstance(p,dict) or set(p)!={
        "schema_version","synthetic_only","sources","section_count",
        "compact_section_breaks","verification_table_widths_twips"}:
        raise LayoutBlocked("PROFILE_SCHEMA_INVALID")
    if p["schema_version"]!=SCHEMA or p["synthetic_only"] is not True or p["section_count"]!=19:
        raise LayoutBlocked("PROFILE_NOT_APPROVED_SYNTHETIC")
    raw=p["sources"]
    if not isinstance(raw,list) or not 1<=len(raw)<=12:
        raise LayoutBlocked("SOURCE_LIST_INVALID")
    entries=[]
    for x in raw:
        if not isinstance(x,dict) or set(x)!={"id","filename"}:
            raise LayoutBlocked("SOURCE_ENTRY_INVALID")
        ident,name=x["id"],x["filename"]
        if not isinstance(ident,str) or not SOURCE_ID.fullmatch(ident) or not isinstance(name,str) or not FILE_NAME.fullmatch(name):
            raise LayoutBlocked("SOURCE_ENTRY_UNSAFE")
        entries.append((ident,name))
    if len(set(entries))!=len(entries) or len(set(i for i,_ in entries))!=len(entries) or len(set(n for _,n in entries))!=len(entries):
        raise LayoutBlocked("DUPLICATE_SOURCE_ENTRY")
    indices=p["compact_section_breaks"]
    if not isinstance(indices,list) or any(type(i) is not int for i in indices) or len(indices)!=len(set(indices)):
        raise LayoutBlocked("BREAK_LIST_INVALID")
    widths=p["verification_table_widths_twips"]
    if not isinstance(widths,list) or any(type(w) is not int for w in widths):
        raise LayoutBlocked("TABLE_WIDTH_PROFILE_INVALID")
    return entries,indices,widths

def _read_zip(path):
    if path.is_symlink() or path.stat().st_size>MAX_DOCX:
        raise LayoutBlocked("UNSAFE_SOURCE_FILE")
    with zipfile.ZipFile(path) as zin:
        members=zin.infolist()
        names=[x.filename for x in members]
        if len(members)>1600 or len(names)!=len(set(names)) or "word/document.xml" not in names:
            raise LayoutBlocked("DOCX_ARCHIVE_INVALID")
        if sum(i.file_size for i in members)>MAX_DOCX*4:
            raise LayoutBlocked("DOCX_UNCOMPRESSED_TOO_LARGE")
        if any(i.flag_bits&1 or i.file_size>MAX_XML or i.filename.startswith("/") or ".." in i.filename.split("/") for i in members):
            raise LayoutBlocked("UNSAFE_ARCHIVE_ENTRY")
        if any(i.filename.lower().endswith("vbaproject.bin") for i in members):
            raise LayoutBlocked("MACRO_PACKAGE")
        return [(item,zin.read(item)) for item in members]

def transform(input_path:Path,output_path:Path,profile:dict):
    entries,section_indices,widths=_profile(profile)
    if input_path.resolve()==output_path.resolve() or output_path.exists() or output_path.is_symlink():
        raise LayoutBlocked("OUTPUT_EXISTS_OR_SAME_AS_INPUT")
    members=_read_zip(input_path)
    original={item.filename:data for item,data in members}
    xml=original["word/document.xml"]
    if len(xml)>MAX_XML or b"<!DOCTYPE" in xml.upper():
        raise LayoutBlocked("UNSAFE_WORD_XML")
    try:
        doc=minidom.parseString(xml)
    except Exception as exc:
        raise LayoutBlocked("BROKEN_DOCUMENT_XML") from exc
    paragraphs=_tags(doc,"p")
    combined=" ".join(_text(p) for p in paragraphs).upper()
    if "NON EMETTIBILE" not in combined or "SIMULAZIONE" not in combined:
        raise LayoutBlocked("SYNTHETIC_DRAFT_ONLY")
    for sid,name in entries:
        if not any(re.search(r"(?<![A-Za-z0-9])"+re.escape(sid)+r"\s*[\-—–]\s*"+re.escape(name),_text(p))
                   for p in paragraphs):
            raise LayoutBlocked("SOURCE_REGISTRY_MISSING")
    replacements=sum(_replace_in_paragraph(p,entries) for p in paragraphs)
    if not replacements:
        raise LayoutBlocked("NOTHING_TO_OPTIMIZE")
    tables=_rebalance_verification_table(doc,widths)
    breaks=_set_section_breaks(doc,section_indices,profile["section_count"])
    patched=doc.toxml(encoding="utf-8")
    if b"NON EMETTIBILE" not in patched.upper():
        raise LayoutBlocked("DRAFT_LABEL_LOST")
    output_path.parent.mkdir(parents=True,exist_ok=True)
    with zipfile.ZipFile(output_path,"x") as dst:
        for info,data in members:
            dst.writestr(info,patched if info.filename=="word/document.xml" else data)
    with zipfile.ZipFile(output_path) as check:
        if any(check.read(name)!=data for name,data in original.items() if name!="word/document.xml"):
            output_path.unlink(missing_ok=True)
            raise LayoutBlocked("NON_DOCUMENT_PART_CHANGED")
    return {
        "schema_version":SCHEMA,"state":"synthetic_layout_postprocessed_not_issuable",
        "replacement_count":replacements,"table_profiles_applied":tables,
        "compact_section_breaks_applied":breaks,
        "original_document_sha256":hashlib.sha256(input_path.read_bytes()).hexdigest(),
        "output_document_sha256":hashlib.sha256(output_path.read_bytes()).hexdigest(),
        "master_margins_modified":False,"comments_removed":0,"issuance_allowed":False
    }

def main():
    import argparse
    parser=argparse.ArgumentParser()
    parser.add_argument("--docx",required=True,type=Path)
    parser.add_argument("--profile",required=True,type=Path)
    parser.add_argument("--out",required=True,type=Path)
    args=parser.parse_args()
    try:
        result=transform(args.docx,args.out,json.loads(args.profile.read_text("utf-8")))
        print(json.dumps(result,sort_keys=True))
        return 0
    except (OSError,ValueError,zipfile.BadZipFile,LayoutBlocked):
        print(json.dumps({"schema_version":SCHEMA,"state":"blocked",
                          "issuance_allowed":False,
                          "blocker_codes":["PROFILE_OR_DOCUMENT_REJECTED"]},sort_keys=True))
        return 2

if __name__=="__main__":
    raise SystemExit(main())
