"""Redact only test copies; replace real notes/status/images with synthetic QA content."""
import argparse, json, re
from pathlib import Path
import pymupdf as fitz
from PIL import Image
import io

p = argparse.ArgumentParser()
p.add_argument('--input-dir', required=True)
p.add_argument('--output-dir', required=True)
a = p.parse_args()
source = Path(a.input_dir).resolve()
target = Path(a.output_dir).resolve()
if source == target:
    raise RuntimeError('Source and output must be different')
target.mkdir(parents=True, exist_ok=True)
mapping = {'esempio_formato_storico_coin.pdf': 'coin-storico-anonimo.pdf', 'restage_reale.pdf.pdf': 'restage-storico-anonimo.pdf'}
ledger = []
for name, output in mapping.items():
    doc = fitz.open(source / name)
    source_hash = __import__('hashlib').sha256((source / name).read_bytes()).hexdigest()
    fixture = {'file': output, 'pages': len(doc), 'rows': [], 'source_unchanged': True}
    note_x = None
    columns = None
    replaced = set()
    for page_index, page in enumerate(doc):
        words = page.get_text('words')
        note_headers = [w for w in words if w[4].upper() == 'NOTE']
        if note_headers:
            header = note_headers[0]
            note_x = header[0] - 3
            near = [w for w in words if abs(w[1] - header[1]) < 7]
            columns = {}
            for w in near:
                label = w[4].upper().replace('.', '')
                if label in ('C', 'PC', 'NC', 'NA', 'NP'):
                    columns['NA' if label == 'NP' else label] = w[0]
            if len(columns) != 4:
                raise RuntimeError(f'Cannot safely anonymize state columns: {output} page {page_index+1}')
            if page_index == 0:
                page.add_redact_annot(fitz.Rect(0, 0, page.rect.width, max(0, header[1] - 24)), fill=(1,1,1))
        if note_x is None or columns is None:
            raise RuntimeError(f'Cannot safely identify historical table: {output}')
        table_top = note_headers[0][3] + 2 if note_headers else 24
        # Coin legacy anchors are explicitly "N)"; bare numbers in legal text
        # (e.g. Art. 17) are not question numbers and must never become oracle rows.
        number_pattern = r'\d+\)' if name.startswith('esempio_') else r'\d+'
        rows = [w for w in words if re.fullmatch(number_pattern, w[4]) and w[0] < 50 and table_top < w[1] < page.rect.height-35]
        page.add_redact_annot(fitz.Rect(note_x, table_top, page.rect.width, page.rect.height-28), fill=(1,1,1))
        page.add_redact_annot(fitz.Rect(min(columns.values())-3, table_top, note_x-1, page.rect.height-28), fill=(1,1,1))
        page.add_redact_annot(fitz.Rect(0, page.rect.height-28, page.rect.width, page.rect.height), fill=(1,1,1))
        # On photograph-only pages keep only safe caption tokens (Foto/number and question caption).
        if not rows and not note_headers:
            for w in words:
                if w[0] < note_x:
                    page.add_redact_annot(fitz.Rect(w[:4]), fill=(1,1,1))
        for annot in list(page.annots() or []):
            if annot.type[0] != fitz.PDF_ANNOT_REDACT:
                page.delete_annot(annot)
        for link in page.get_links():
            page.delete_link(link)
        page.apply_redactions(images=0, graphics=0)
        for w in rows:
            number = int(re.sub(r'\D','', w[4]))
            note = f'QA-P{page_index+1}-R{number}'
            state = ['C','PC','NC','NA'][(number-1) % 4]
            page.insert_text((note_x+5, w[3]-1), note, fontsize=8)
            page.insert_text((columns[state]+1, w[3]-1), 'X', fontsize=8)
            fixture['rows'].append({'page':page_index+1,'number':number,'note':note,'state':state})
        # Replace every source raster, including masks/logos, so no real photo can survive.
        for image in page.get_images(full=True):
            xref=image[0]
            if xref in replaced:
                continue
            rects=page.get_image_rects(xref)
            if rects and all(r.y1 < 100 for r in rects):
                # Reuse only public bundled logos, never source header raster data.
                logo='logo_colligo.webp' if rects[0].x0 < page.rect.width/2 else 'logo_restage.png'
                public_image=Image.open(Path(__file__).resolve().parent.parent/'assets'/logo).convert('RGB')
                data=io.BytesIO();public_image.save(data,format='PNG');page.replace_image(xref,stream=data.getvalue())
            else:
                pix=fitz.Pixmap(fitz.csRGB, fitz.IRect(0,0,max(8,min(240,image[2])),max(8,min(240,image[3]))),False)
                pix.clear_with(160)
                page.replace_image(xref,pixmap=pix)
            replaced.add(xref)
    doc.set_metadata({'title':'QA storico anonimizzato','author':'QA Fittizio'})
    if doc.get_xml_metadata():
        doc.del_xml_metadata()
    for attachment in list(doc.embfile_names()):
        doc.embfile_del(attachment)
    doc.save(target/output,garbage=4,deflate=True)
    doc.close()
    assert __import__('hashlib').sha256((source/name).read_bytes()).hexdigest() == source_hash
    ledger.append(fixture)
(target/'oracle.json').write_text(json.dumps(ledger,indent=2),encoding='utf8')
print(json.dumps([{'file':f['file'],'pages':f['pages'],'synthetic_rows':len(f['rows'])} for f in ledger]))
