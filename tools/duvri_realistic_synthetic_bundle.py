#!/usr/bin/env python3
"""Generate REAL synthetic DOCX/PDF/XLSX/PNG DOSSIER INPUTS; no master and no DUVRI approval.

Python standard library only. Public test fixtures are entirely fictional.
Each case ZIP contains a client-like checklist DOCX, PDF evidence, optional
schedule XLSX and a schematic PNG plus a cryptographic manifest. The
APP's PRIVATE generator, not this script, must create the draft DUVRI.
"""
from __future__ import annotations
import argparse, hashlib, json, re, struct, zlib, zipfile
from pathlib import Path
from xml.sax.saxutils import escape

ROOT = Path(__file__).resolve().parents[1]
SPEC = ROOT / "fixtures" / "duvri-realistic-synthetic-cases.v1.json"
MIME_DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
MIME_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'


def zipwrite(path: Path, files: dict[str, bytes]) -> None:
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as out:
        for name in sorted(files):
            out.writestr(name, files[name])


def p(text: str, *, title=False) -> str:
    tag = '<w:pPr><w:pStyle w:val="Heading1"/></w:pPr>' if title else ""
    return '<w:p>' + tag + '<w:r><w:t xml:space="preserve">' + escape(text) + '</w:t></w:r></w:p>'


def make_docx(data: dict) -> bytes:
    from io import BytesIO
    body = [p("CHECKLIST CLIENTE - TEST SINTETICO - NON REALE", title=True),
            p("Fascicolo: " + data["id"]), p("Scenario: " + data["title"]),
            p("Questo documento e' fittizio. Non approva o emette un DUVRI."),
            p("DATI GENERALI", title=True),
            p("Committente: " + data["committente"]),
            p("Imprese appaltatrici: " + "; ".join(data["appaltatori"])),
            p("Oggetto: " + data["intervention"]),
            p("Area: " + data["location"]),
            p("Orari: " + data["schedule"]),
            p("CHECKLIST WORD COMPILATA", title=True)]
    for i, (question, answer) in enumerate(data["checklist"], start=1):
        body.append(p(f"{i:02d}. {question}: {answer}"))
    body.extend([p("Nota: campi incompleti e affermazioni non dimostrate richiedono riscontro tecnico."),
                 p("FIRME DI APPROVAZIONE: NON PRESENTI")])
    document = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<w:document xmlns:w="'+W+'"><w:body>'+''.join(body)+
        '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1100" w:right="1100" w:bottom="1100" w:left="1100"/></w:sectPr>'
        '</w:body></w:document>').encode('utf-8')
    files = {
      '[Content_Types].xml': ('''<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>''').encode(),
      '_rels/.rels': ('''<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>''').encode(),
      'word/document.xml': document,
    }
    out = BytesIO()
    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
        for name in sorted(files):
            z.writestr(name, files[name])
    return out.getvalue()


def ascii_pdf(text: str) -> str:
    import unicodedata
    clean = unicodedata.normalize('NFKD', text).encode('ascii','ignore').decode('ascii')
    return clean.replace('\\','\\\\').replace('(','\\(').replace(')','\\)')


def make_pdf(data: dict) -> bytes:
    # Portable, extractable, single-page PDF without network dependencies.
    lines = ['FASCICOLO SINTETICO - CAPITOLATO - NON REALE',
        data["id"],data["title"]]+data["pdf_lines"]
    commands = ['BT','/F1 11 Tf','52 788 Td','15 TL']
    for line in lines:
        # Keep lines below page width; split long source facts deterministically.
        import textwrap
        for item in textwrap.wrap(ascii_pdf(line), width=91,break_long_words=False):
            commands.append('('+item+') Tj')
            commands.append('T*')
    commands.append('ET')
    stream = '\n'.join(commands).encode('ascii')
    objects = [
      b'<< /Type /Catalog /Pages 2 0 R >>',
      b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
      b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
      b'<< /Length %d >>\nstream\n'%len(stream)+stream+b'\nendstream'
    ]
    b=bytearray(b'%PDF-1.4\n')
    offsets=[0]
    for i,o in enumerate(objects, start=1):
        offsets.append(len(b));b+=f'{i} 0 obj\n'.encode()+o+b'\nendobj\n'
    xref=len(b);b+=f'xref\n0 {len(offsets)}\n'.encode()+b'0000000000 65535 f \n'
    for off in offsets[1:]:b+=f'{off:010d} 00000 n \n'.encode()
    b+=f'trailer\n<< /Size {len(offsets)} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF'.encode()
    return bytes(b)


def col(index: int) -> str:
    value=''
    while index:
        index,r=divmod(index-1,26);value=chr(65+r)+value
    return value


def make_xlsx(data: dict) -> bytes:
    from io import BytesIO
    schedule=data["xlsx"]
    rows=[schedule['columns']]+schedule['rows']
    cells=[]
    for i, values in enumerate(rows,1):
        cells.append('<row r="%d">'%i+''.join(
            f'<c r="{col(j)}{i}" t="inlineStr"><is><t>{escape(str(x))}</t></is></c>'
            for j,x in enumerate(values,1))+'</row>')
    sheet=('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
      '<sheetData>'+''.join(cells)+'</sheetData></worksheet>').encode()
    content_types=('''<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>''').encode()
    files={
      '[Content_Types].xml':content_types,
      '_rels/.rels':('''<?xml version="1.0" encoding="utf-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>''').encode(),
      'xl/workbook.xml':('''<?xml version="1.0" encoding="utf-8"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="Cronoprogramma" sheetId="1" r:id="rId1"/></sheets></workbook>''').encode(),
      'xl/_rels/workbook.xml.rels':('''<?xml version="1.0" encoding="utf-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>''').encode(),
      'xl/worksheets/sheet1.xml':sheet,
    }
    out=BytesIO()
    with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED) as z:
        for name in sorted(files):
            z.writestr(name,files[name])
    return out.getvalue()


def chunk(kind:bytes,data:bytes)->bytes:
    return struct.pack('!I',len(data))+kind+data+struct.pack('!I',zlib.crc32(kind+data)&0xffffffff)


def make_png(data:dict)->bytes:
    # Clearly synthetic colored schematic, never a real photograph.
    w,h=480,240;lines=[]
    for y in range(h):
        row=bytearray([0])
        for x in range(w):
            if y<50:r,g,b=50,70,95
            elif x<w//2:r,g,b=219,226,230
            elif y<140:r,g,b=239,211,128
            else:r,g,b=187,206,198
            # Black visual divider with yellow lane indicator.
            if abs(x-w//2)<3:r,g,b=30,40,47
            if 180<y<189:r,g,b=255,190,66
            row.extend([r,g,b])
        lines.append(bytes(row))
    raw=b''.join(lines)
    return b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('!2I5B',w,h,8,2,0,0,0))+chunk(b'IDAT',zlib.compress(raw,8))+chunk(b'IEND',b'')


def create_corpus(out_dir:Path)->dict:
    spec=json.loads(SPEC.read_text('utf8'))
    if spec.get('synthetic_only') is not True or len(spec['cases'])!=4:
        raise ValueError('Only the four approved synthetic fixture scenarios are allowed')
    out_dir.mkdir(parents=True, exist_ok=True)
    summary={'schema_version':'colligo-duvri-synthetic-test-bundle/1.0',
             'synthetic_only':True,'cases':[],'issuance_allowed':False}
    for case in spec['cases']:
        case_dir=out_dir/case['id']
        case_dir.mkdir(parents=True,exist_ok=True)
        artifacts={
            '01_CHECKLIST_CLIENTE_COMPILATA.docx':(make_docx(case),MIME_DOCX,'client_checklist'),
            '02_CAPITOLATO.pdf':(make_pdf(case),'application/pdf','supporting_document')
        }
        if case['xlsx']:
            artifacts['03_CRONOPROGRAMMA.xlsx']=(make_xlsx(case),MIME_XLSX,'supporting_document')
        if case['image_note']:
            artifacts['04_PIANTA_FITTIZIA.png']=(make_png(case),'image/png','drawing')
        documents=[]
        for i,(name,(content,mime,role)) in enumerate(artifacts.items(),start=1):
            (case_dir/name).write_bytes(content)
            documents.append({'file_id':f'FILE_{case["id"].replace("-","_")}_{i:02d}',
                'job_id':case['id'].replace('-','_'),'role':role,'mime_type':mime,
                'size_bytes':len(content),'sha256':hashlib.sha256(content).hexdigest(),
                'parse_status':'pending','filename':name})
        manifest={'synthetic_only':True,'case_id':case['id'],
          'generation_mode':'synthetic_test_only','files':documents,
          'expected_result':case['expected_result'],
          'must_consider':case['acceptance']['must_consider'],
          'mandatory_questions':case['acceptance']['mandatory_questions'],
          'unknown_must_not_be_asserted':case['acceptance']['unknown_must_not_be_asserted'],
          'source_provenance_required':True,
          'human_hse_review_required':True,'d1_approved':False,'d2_approved':False,
          'word_visual_qa_approved':False,'issuance_allowed':False}
        (case_dir/'00_FASCICOLO_MANIFEST.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n','utf8')
        (case_dir/'LEGGIMI.txt').write_text(
          f'{case["id"]}: {case["title"]}\n'+
          'I NOMI, I DOCUMENTI E LE LAVORAZIONI SONO FINTIZI.\n'+
          'Usare SOLO nel generatore DUVRI privato isolato, non nella PWA Checklist.\n'+
          'Estrarre i dati, confermare le fonti, valutare interferenze, produrre una bozza\n'+
          'con il master Colligo PRIVATO e con dicitura NON EMETTIBILE.\n'+
          'Non determinare indici di rischio D1 non approvati; aprire i chiarimenti mancanti.\n'+
          'Nessuna autorizzazione a emissione, firma o approvazione automatica.\n','utf8')
        summary['cases'].append({'id':case['id'],'files':len(documents),
          'expected_result':case['expected_result']})
    archive=out_dir/'FASCICOLI_DUVRI_REALISTICI_SINTETICI_V1.zip'
    with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED) as z:
        for f in sorted(out_dir.rglob('*')):
            if f.is_file() and f!=archive:
                z.write(f,f.relative_to(out_dir))
    summary['archive_name']=archive.name
    summary['archive_sha256']=hashlib.sha256(archive.read_bytes()).hexdigest()
    (out_dir/'RIEPILOGO_SICUREZZA.json').write_text(json.dumps(summary,indent=2)+'\n','utf8')
    return summary


def main()->None:
    parser=argparse.ArgumentParser()
    parser.add_argument('--out',type=Path,required=True)
    args=parser.parse_args()
    print(json.dumps(create_corpus(args.out),indent=2))


if __name__=='__main__':
    main()
