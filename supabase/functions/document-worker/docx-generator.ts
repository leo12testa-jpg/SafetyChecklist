import JSZip from 'npm:jszip@3.10.1';
import { DOMParser, XMLSerializer } from 'npm:@xmldom/xmldom@0.8.10';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';
const VML = 'urn:schemas-microsoft-com:vml';
const OFFICE = 'urn:schemas-microsoft-com:office:office';
const XML = 'http://www.w3.org/XML/1998/namespace';

export type TemplateRiskRow = {
  tableIndex: number;
  rowIndex: number;
  factor: string;
  continuationOf: string;
  description: string;
  measures: string;
  templateIndex: string;
};

export type DuvriRiskUpdate = {
  tableIndex: number;
  rowIndex: number;
  description: string;
  measures: string;
  irIndex: number | null;
  rationale: string;
};

export type DuvriDraft = {
  title: string;
  documentDate: string;
  clientName: string;
  siteDescription: string;
  siteCharacteristics: string;
  accessDescription: string;
  emergencyDescription: string;
  clientActivities: { summary: string; items: string[] };
  contractorSummary: string;
  contractors: Array<{
    legalName: string;
    role: string;
    activityDescription: string;
    equipment: string[];
    ppe: string[];
    prepostoName?: string;
    prepostoRole?: string;
  }>;
  equipmentSummary: string;
  ppeItems: string[];
  interferenceSummary: string;
  interferenceMeasures: string;
  riskRows: DuvriRiskUpdate[];
  missingInformation: string[];
  conflicts: string[];
  normativeReferencesToCheck: string[];
  humanReviewItems: string[];
};

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}
function parseXml(xml: string, part: string): any {
  const errors: string[] = [];
  const parser = new DOMParser({
    errorHandler: {
      warning: (message: string) => { errors.push(message); },
      error: (message: string) => { errors.push(message); },
      fatalError: (message: string) => { errors.push(message); }
    }
  } as any);
  const doc = parser.parseFromString(xml, 'application/xml');
  if (errors.length || !doc?.documentElement) {
    throw new Error('Part XML non valido nel template: ' + part);
  }
  return doc;
}
function serializeXml(doc: any): string {
  return new XMLSerializer().serializeToString(doc);
}
function directElements(parent: any, ns: string, localName: string): any[] {
  const result: any[] = [];
  for (let node = parent?.firstChild; node; node = node.nextSibling) {
    if (node.nodeType === 1 && node.namespaceURI === ns && node.localName === localName) result.push(node);
  }
  return result;
}
function descendants(node: any, ns: string, localName: string): any[] {
  const list = node?.getElementsByTagNameNS?.(ns, localName);
  const result: any[] = [];
  if (!list) return result;
  for (let i = 0; i < list.length; i += 1) result.push(list.item(i));
  return result;
}
function textOf(node: any): string {
  return descendants(node, W, 't').map((item) => item.textContent || '').join('');
}
function normalized(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}
function bodyOf(doc: any): any {
  const body = descendants(doc, W, 'body')[0];
  if (!body) throw new Error('Il template Word non contiene w:body.');
  return body;
}
function bodyTables(body: any): any[] {
  return directElements(body, W, 'tbl');
}
function rowsOf(table: any): any[] {
  return directElements(table, W, 'tr');
}
function cellsOf(row: any): any[] {
  return directElements(row, W, 'tc');
}
function firstParagraph(node: any): any | null {
  return descendants(node, W, 'p')[0] || null;
}
function clearYellowHighlight(paragraph: any) {
  for (const highlight of descendants(paragraph, W, 'highlight')) {
    const value = highlight.getAttributeNS(W, 'val') || highlight.getAttribute('w:val') || '';
    if (String(value).toLowerCase() === 'yellow') highlight.parentNode?.removeChild(highlight);
  }
}
function setParagraphText(paragraph: any, value: string, clearYellow = true) {
  const runs = descendants(paragraph, W, 't');
  if (!runs.length) {
    const doc = paragraph.ownerDocument;
    let run = directElements(paragraph, W, 'r')[0];
    if (!run) {
      run = doc.createElementNS(W, 'w:r');
      paragraph.appendChild(run);
    }
    const node = doc.createElementNS(W, 'w:t');
    run.appendChild(node);
    node.textContent = value;
    if (/^\s|\s$/.test(value)) node.setAttributeNS(XML, 'xml:space', 'preserve');
  } else {
    runs[0].textContent = value;
    if (/^\s|\s$/.test(value)) runs[0].setAttributeNS(XML, 'xml:space', 'preserve');
    else runs[0].removeAttributeNS(XML, 'space');
    for (let i = 1; i < runs.length; i += 1) runs[i].textContent = '';
  }
  if (clearYellow) clearYellowHighlight(paragraph);
}
function replaceParagraphSubstring(paragraph: any, needle: string, replacement: string): boolean {
  const textNodes = descendants(paragraph, W, 't');
  const values = textNodes.map((node) => node.textContent || '');
  const full = values.join('');
  const start = full.indexOf(needle);
  if (start < 0) return false;
  const end = start + needle.length;
  let cursor = 0;
  let startIndex = -1, endIndex = -1, startOffset = 0, endOffset = 0;
  const ranges: Array<{ start: number; end: number }> = [];
  for (let i = 0; i < values.length; i += 1) {
    const from = cursor;
    const to = from + values[i].length;
    ranges.push({ start: from, end: to });
    if (startIndex < 0 && start >= from && start < to) {
      startIndex = i;
      startOffset = start - from;
    }
    if (endIndex < 0 && end > from && end <= to) {
      endIndex = i;
      endOffset = end - from;
    }
    cursor = to;
  }
  if (startIndex < 0 || endIndex < 0) return false;
  if (startIndex === endIndex) {
    textNodes[startIndex].textContent = values[startIndex].slice(0, startOffset) + replacement + values[startIndex].slice(endOffset);
  } else {
    textNodes[startIndex].textContent = values[startIndex].slice(0, startOffset) + replacement + values[endIndex].slice(endOffset);
    for (let i = startIndex + 1; i <= endIndex; i += 1) {
      if (i !== startIndex) textNodes[i].textContent = '';
    }
  }
  clearYellowHighlight(paragraph);
  return true;
}
function findBodyParagraph(body: any, predicate: (text: string) => boolean, startAt = 0, endAt = Number.POSITIVE_INFINITY): { paragraph: any; index: number } | null {
  const children = directElements(body, W, 'p');
  for (let i = startAt; i < Math.min(children.length, endAt); i += 1) {
    if (predicate(normalized(textOf(children[i])))) return { paragraph: children[i], index: i };
  }
  return null;
}
function findBodyHeading(body: any, needle: string): { paragraph: any; index: number } | null {
  return findBodyParagraph(body, (text) => text.toLowerCase().includes(needle.toLowerCase()));
}
function findBodyTablesRoot(doc: any): any[] {
  return bodyTables(bodyOf(doc));
}
function setCellText(cell: any, value: string) {
  const paragraphs = directElements(cell, W, 'p');
  if (!paragraphs.length) return;
  setParagraphText(paragraphs[0], value, true);
  for (let i = 1; i < paragraphs.length; i += 1) {
    for (const node of descendants(paragraphs[i], W, 't')) node.textContent = '';
  }
}
function setCellFill(cell: any, fill: string) {
  const doc = cell.ownerDocument;
  let tcPr = directElements(cell, W, 'tcPr')[0];
  if (!tcPr) {
    tcPr = doc.createElementNS(W, 'w:tcPr');
    cell.insertBefore(tcPr, cell.firstChild);
  }
  let shading = directElements(tcPr, W, 'shd')[0];
  if (!shading) {
    shading = doc.createElementNS(W, 'w:shd');
    tcPr.appendChild(shading);
  }
  shading.setAttributeNS(W, 'w:val', 'clear');
  shading.setAttributeNS(W, 'w:color', 'auto');
  shading.setAttributeNS(W, 'w:fill', fill);
}
function setCellScore(cell: any, score: number) {
  setCellText(cell, String(score));
  setCellFill(cell, score === 3 ? 'FFFF66' : '00CC00');
}
function tableCellText(row: any, column: number): string {
  return textOf(cellsOf(row)[column] || {});
}
function walk(node: any, visit: (element: any) => void) {
  if (!node) return;
  if (node.nodeType === 1) visit(node);
  for (let child = node.firstChild; child; child = child.nextSibling) walk(child, visit);
}
function uniqueCloneIds(node: any, seed: string) {
  let count = 0;
  walk(node, (element) => {
    if (element.hasAttributeNS?.(W14, 'paraId')) {
      element.setAttributeNS(W14, 'w14:paraId', (seed + (count++).toString(16).padStart(8, '0')).slice(-8).toUpperCase());
    }
    if (element.hasAttributeNS?.(W14, 'textId')) {
      element.setAttributeNS(W14, 'w14:textId', (seed + (count++).toString(16).padStart(8, '0')).slice(-8).toUpperCase());
    }
    if (element.namespaceURI === VML && element.hasAttribute('id')) {
      element.setAttribute('id', 'duvriSign' + seed.slice(-6) + '_' + count++);
    }
    if (element.namespaceURI === OFFICE && element.hasAttribute('spid')) {
      element.setAttribute('spid', '_x0000_s' + String(10000 + Math.floor(Math.random() * 80000)));
    }
  });
}
function signatureTable(doc: any): any | null {
  return findBodyTablesRoot(doc).find((table) => {
    const text = textOf(table);
    return text.includes('(Committente)') && text.includes('(Appaltatore)');
  }) || null;
}
function dateTable(doc: any): any | null {
  return findBodyTablesRoot(doc).find((table) => textOf(table).includes('DATA') && /\d{2}\/\d{2}\/\d{4}/.test(textOf(table))) || null;
}
function fillSignatureTable(doc: any, clientName: string, contractors: DuvriDraft['contractors']) {
  const table = signatureTable(doc);
  if (!table) throw new Error('Tabella firme non trovata nel template.');
  const rows = rowsOf(table);
  const clientRow = rows.find((row) => textOf(row).includes('(Committente)'));
  const appRow = rows.find((row) => textOf(row).includes('(Appaltatore)'));
  const subRow = rows.find((row) => textOf(row).includes('(Subappaltatore)'));
  if (!clientRow || !appRow || !subRow) throw new Error('Righe firma del template non riconosciute.');
  const clientCopy = clientRow.cloneNode(true);
  const appTemplate = appRow.cloneNode(true);
  const subTemplate = subRow.cloneNode(true);
  const allApp = contractors.filter((c) => !/subappalt/i.test(String(c.role || '')));
  const allSub = contractors.filter((c) => /subappalt/i.test(String(c.role || '')));
  if (!allApp.length) throw new Error('È necessaria almeno una impresa appaltatrice confermata.');
  // Keep the signature table's name/signature fields blank. Companies sign the
  // document after delivery; intake data must never be written into signature rows.
  setCellText(cellsOf(clientCopy)[0], '');
  const rowToKeep = directElements(table, W, 'tr');
  for (const row of rowToKeep) table.removeChild(row);
  table.appendChild(clientCopy);
  let seedNumber = 0;
  for (const _company of allApp) {
    const row = appTemplate.cloneNode(true);
    setCellText(cellsOf(row)[0], '');
    uniqueCloneIds(row, (++seedNumber).toString(16).padStart(2, '0'));
    table.appendChild(row);
  }
  for (const _company of allSub) {
    const row = subTemplate.cloneNode(true);
    setCellText(cellsOf(row)[0], '');
    const labelP = descendants(row, W, 'p').find((p) => textOf(p).includes('(Subappaltatore)'));
    if (labelP) clearYellowHighlight(labelP);
    uniqueCloneIds(row, (++seedNumber).toString(16).padStart(2, '0'));
    table.appendChild(row);
  }
}
function fillRiskTables(doc: any, updates: DuvriRiskUpdate[]) {
  const tables = findBodyTablesRoot(doc).filter((table) =>
    textOf(table).includes('Fattori di rischio') && textOf(table).includes('Indice di rischio da interf.')
  );
  const expected: Array<{ tableIndex: number; rowIndex: number; factor: string; cells: any[] }> = [];
  tables.forEach((table, tableIndex) => {
    const rows = rowsOf(table);
    for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
      const cells = cellsOf(rows[rowIndex]);
      if (cells.length < 4) throw new Error('Tabella dei rischi con un numero di colonne inatteso.');
      expected.push({ tableIndex, rowIndex, factor: normalized(textOf(cells[0])), cells });
    }
  });
  if (updates.length !== expected.length) {
    throw new Error(`Numero aggiornamenti rischi non corrispondente al template: attesi ${expected.length}, ricevuti ${updates.length}.`);
  }
  const keyed = new Map<string,DuvriRiskUpdate>();
  for (const update of updates) {
    if (!Number.isInteger(update.tableIndex) || !Number.isInteger(update.rowIndex)) throw new Error('Indice tabella/riga non valido.');
    const expectedRow = expected.find((row) => row.tableIndex === update.tableIndex && row.rowIndex === update.rowIndex);
    if (!expectedRow) throw new Error('La riga rischio non esiste nel modello ufficiale.');
    if (expectedRow.factor && ![1,2,3].includes(Number(update.irIndex))) throw new Error('Indice di rischio fuori dalla scala Colligo 1–3.');
    if (!expectedRow.factor && update.irIndex !== null) throw new Error('Le righe di continuazione del modello devono mantenere l’indice di rischio vuoto.');
    const key = update.tableIndex + ':' + update.rowIndex;
    if (keyed.has(key)) throw new Error('Riga di rischio duplicata nell’output del redattore.');
    keyed.set(key, update);
  }
  for (const row of expected) {
    const update = keyed.get(row.tableIndex + ':' + row.rowIndex);
    if (!update) throw new Error('Manca una riga nella valutazione dei rischi: ' + row.tableIndex + ':' + row.rowIndex);
    setCellText(row.cells[1], update.description);
    setCellText(row.cells[2], update.measures);
    if (update.irIndex === null) setCellText(row.cells[3], '');
    else setCellScore(row.cells[3], Number(update.irIndex));
  }
}
function updateHeaderPart(doc: any, titleHeader: string) {
  for (const paragraph of descendants(doc, W, 'p')) {
    const text = normalized(textOf(paragraph));
    if (text.includes('DUVRI_NOME DEL DUVRI_2026') || text.includes('DUVRI_NOME DEL DUVRI')) {
      setParagraphText(paragraph, titleHeader, true);
    }
  }
}
function dateIt(dateIso: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateIso);
  if (!match) throw new Error('La data del DUVRI deve essere confermata nel formato YYYY-MM-DD.');
  return match[3] + '/' + match[2] + '/' + match[1];
}
function titleSlug(title: string) {
  const slug = title.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 70);
  if (!slug) throw new Error('Titolo del DUVRI vuoto o non valido.');
  return slug;
}
function directBodyParagraphsBetween(body: any, startText: string, endText: string): any[] {
  const children = directElements(body, W, 'p');
  const start = children.findIndex((p) => normalized(textOf(p)).toLowerCase().includes(startText.toLowerCase()));
  if (start < 0) return [];
  let end = children.length;
  for (let i = start + 1; i < children.length; i += 1) {
    if (normalized(textOf(children[i])).toLowerCase().includes(endText.toLowerCase())) { end = i; break; }
  }
  return children.slice(start + 1, end);
}
function replaceSectionParagraph(body: any, startHeading: string, endHeading: string, predicate: (text: string) => boolean, replacement: string) {
  const paragraphs = directBodyParagraphsBetween(body, startHeading, endHeading);
  const target = paragraphs.find((p) => predicate(normalized(textOf(p))));
  if (!target) return false;
  setParagraphText(target, replacement, true);
  return true;
}
function fillClientActivityList(body: any, draft: DuvriDraft) {
  const paragraphs = directBodyParagraphsBetween(body, 'DESCRIZIONE ATTIVITÀ SVOLTE DA PARTE DEL COMMITTENTE', 'DESCRIZIONE ATTIVITÀ SVOLTE DA PARTE DELLE AZIENDE APPALTATRICI');
  if (!paragraphs.length) throw new Error('Sezione delle attività del committente non trovata.');
  const placeholder = paragraphs.find((p) => /^[.…\s]+$/.test(normalized(textOf(p))));
  if (placeholder) setParagraphText(placeholder, draft.clientActivities.summary, true);
  const defaultSummary = paragraphs.find((p) => normalized(textOf(p)).startsWith('L’attività lavorativa ordinaria del punto vendita'));
  if (defaultSummary) setParagraphText(defaultSummary, 'Le attività della Committente rilevanti ai fini delle interferenze comprendono:', true);
  const intro = paragraphs.find((p) => normalized(textOf(p)).startsWith('Di seguito si riporta la divisione degli ambienti'));
  if (intro) {
    if (draft.clientActivities.items.length) setParagraphText(intro, 'Aree e attività pertinenti:', true);
    else setParagraphText(intro, '', true);
  }
  const listIntro = paragraphs.find((p) => normalized(textOf(p)).startsWith('I dipendenti sono impiegati nelle seguenti attività'));
  if (listIntro) {
    if (draft.clientActivities.items.length) setParagraphText(listIntro, 'Attività indicate dalla Committente o ricavate dai documenti ricevuti:', true);
    else setParagraphText(listIntro, '', true);
  }
  const sampleStarts = [
    'Area vendita, zone di lavorazione-preconfezione merci',
    'Riserve, scorte merci, ricevimento merci',
    'Servizi e spogliatoi',
    'Ricevimento merci con pesatura a campione',
    'Rifornimento degli scaffali in area vendita',
    'Pulizia, taglio e preparazione prodotti freschi',
    'Confezionamento di prodotti freschi',
    'Servizio alle casse',
    'Lavori vari'
  ];
  const listParas = paragraphs.filter((p) => sampleStarts.some((start) => normalized(textOf(p)).startsWith(start)));
  const actualItems = draft.clientActivities.items.slice(0, 16);
  if (listParas.length) {
    const template = listParas[0];
    const parent = template.parentNode;
    const insertBefore = paragraphs.find((p) => normalized(textOf(p)).startsWith('Lavori vari'))?.nextSibling || null;
    for (const item of listParas) parent.removeChild(item);
    let cursor = insertBefore && insertBefore.parentNode === parent ? insertBefore : null;
    actualItems.forEach((item, index) => {
      const paragraph = template.cloneNode(true);
      setParagraphText(paragraph, item, true);
      uniqueCloneIds(paragraph, (index + 10).toString(16).padStart(2, '0'));
      if (cursor) parent.insertBefore(paragraph, cursor); else parent.appendChild(paragraph);
    });
  }
}
function fillPpeList(body: any, draft: DuvriDraft) {
  const paragraphs = directBodyParagraphsBetween(body, '4.2 Dispositivi di protezione individuale', 'COOPERAZIONE E COORDINAMENTO');
  if (!paragraphs.length) return;
  const anchor = paragraphs.find((p) => normalized(textOf(p)).startsWith('Il Datore di lavoro di ciascuna impresa Appaltatrice comunque:'));
  const candidates = paragraphs.filter((p) => {
    const text = normalized(textOf(p));
    return text.startsWith('scarpe antinfortunistiche') || text.startsWith('gilet ad alta visibilità') ||
      text.startsWith('giubbotto termico') || text.startsWith('guanti di protezione') ||
      text.startsWith('elmetto') || text.startsWith('imbracatura') || text.startsWith('facciale filtrante');
  });
  if (!candidates.length) return;
  const template = candidates[0];
  const parent = template.parentNode;
  const insertionAnchor = anchor && anchor.parentNode === parent ? anchor : null;
  for (const item of candidates) parent.removeChild(item);
  const entries = draft.ppeItems.length
    ? draft.ppeItems.slice(0, 16)
    : ['DPI specifici da acquisire/confermare sulla base del DVR e della documentazione dell’impresa.'];
  entries.forEach((item, index) => {
    const paragraph = template.cloneNode(true);
    setParagraphText(paragraph, item, true);
    uniqueCloneIds(paragraph, (index + 30).toString(16).padStart(2, '0'));
    if (insertionAnchor) parent.insertBefore(paragraph, insertionAnchor); else parent.appendChild(paragraph);
  });
}
function fillEquipmentSection(body: any, draft: DuvriDraft) {
  const paragraphs = directBodyParagraphsBetween(body, 'Elenco delle attrezzature utilizzate', '4.2 Dispositivi di protezione individuale');
  if (!paragraphs.length) return;
  const templateParagraph = paragraphs.find((p) => normalized(textOf(p)).startsWith('Come previsto dai rispettivi contratti di appalto'));
  if (templateParagraph) {
    const equipmentText = draft.contractors.flatMap((company) => company.equipment.map((entry) => company.legalName + ': ' + entry));
    setParagraphText(templateParagraph, equipmentText.length
      ? 'Mezzi, macchinari e attrezzature, con utilizzatore e proprietà: ' + equipmentText.join('; ')
      : (draft.equipmentSummary || 'Elenco dei mezzi/attrezzature da acquisire e verificare prima dell’avvio dei lavori.'), true);
  }
  for (const paragraph of paragraphs) {
    const text = normalized(textOf(paragraph));
    if (text.includes('PAM PANORAMA')) {
      setParagraphText(paragraph, 'L’eventuale concessione in uso di attrezzature di proprietà della Committente deve essere preventivamente autorizzata e formalizzata per iscritto.', true);
    } else if (text.startsWith('Come previsto dai rispettivi contratti di appalto') && paragraph !== templateParagraph) {
      setParagraphText(paragraph, '', true);
    }
  }
}
function updateSettings(zip: JSZip) {
  return zip.file('word/settings.xml')!.async('string').then((xml) => {
    const doc = parseXml(xml, 'word/settings.xml');
    const root = doc.documentElement;
    let update = directElements(root, W, 'updateFields')[0];
    if (!update) {
      update = doc.createElementNS(W, 'w:updateFields');
      root.insertBefore(update, root.firstChild);
    }
    update.setAttributeNS(W, 'w:val', 'true');
    zip.file('word/settings.xml', serializeXml(doc));
  });
}

export async function inspectDuvriTemplate(bytes: Uint8Array): Promise<{ riskRows: TemplateRiskRow[]; tableCount: number; hasSignageDiagram: boolean }> {
  const zip = await JSZip.loadAsync(toArrayBuffer(bytes));
  const file = zip.file('word/document.xml');
  if (!file) throw new Error('Template non contiene word/document.xml.');
  const doc = parseXml(await file.async('string'), 'word/document.xml');
  const tables = findBodyTablesRoot(doc);
  const riskTables = tables.filter((table) => textOf(table).includes('Fattori di rischio') && textOf(table).includes('Indice di rischio da interf.'));
  const riskRows: TemplateRiskRow[] = [];
  // The official template carries some long mitigation text over into the next risk table/page.
  // Keep the last known factor across the full sequence of risk tables so continuation rows
  // are not mistaken for new, unclassified risks.
  let lastFactor = '';
  riskTables.forEach((table, tableIndex) => {
    const rows = rowsOf(table);
    for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
      const cells = cellsOf(rows[rowIndex]);
      if (cells.length < 4) throw new Error('Tabella dei rischi non compatibile con il modello.');
      const factor = normalized(textOf(cells[0]));
      if (factor) lastFactor = factor;
      riskRows.push({
        tableIndex,
        rowIndex,
        factor,
        continuationOf: factor ? '' : lastFactor,
        description: normalized(textOf(cells[1])),
        measures: normalized(textOf(cells[2])),
        templateIndex: normalized(textOf(cells[3]))
      });
    }
  });
  if (!riskRows.length) throw new Error('Le tabelle di valutazione dei rischi non sono state riconosciute.');
  const hasSignageDiagram = Object.keys(zip.files).some((name) => /^word\/media\//.test(name));
  return { riskRows, tableCount: tables.length, hasSignageDiagram };
}

export async function populateDuvriTemplate(templateBytes: Uint8Array, draft: DuvriDraft): Promise<{ bytes: Uint8Array; report: Record<string,unknown> }> {
  if (!draft.title?.trim()) throw new Error('Titolo DUVRI mancante.');
  if (!draft.clientName?.trim()) throw new Error('Ragione sociale del committente mancante.');
  const formattedDate = dateIt(draft.documentDate);
  const zip = await JSZip.loadAsync(toArrayBuffer(templateBytes));
  const documentFile = zip.file('word/document.xml');
  if (!documentFile) throw new Error('Template non contiene word/document.xml.');
  const documentXml = await documentFile.async('string');
  const doc = parseXml(documentXml, 'word/document.xml');
  const body = bodyOf(doc);
  const tablesBefore = findBodyTablesRoot(doc).length;
  const riskRowsBefore = (await inspectDuvriTemplate(templateBytes)).riskRows.length;

  const titlePara = findBodyParagraph(body, (text) => text === 'TITOLO DEL DUVRI');
  if (titlePara) setParagraphText(titlePara.paragraph, draft.title.trim(), true);

  const chapter1Paragraph = findBodyParagraph(body, (text) => text.includes('Il Documento Unico di Valutazione dei Rischi derivanti dalle Interferenze'));
  if (chapter1Paragraph) {
    const original = chapter1Paragraph.paragraph;
    if (!replaceParagraphSubstring(original, 'COMMITTENTE S.p.A.', draft.clientName.trim())) {
      replaceParagraphSubstring(original, 'COMMITTENTE', draft.clientName.trim());
    }
    const existing = normalized(textOf(original));
    if (existing.includes('impresa o un prestatore d’opera')) {
      setParagraphText(original, `Il Documento Unico di Valutazione dei Rischi derivanti dalle Interferenze (in seguito denominato DUVRI) tiene conto degli aspetti operativi collegati ai contratti che portano le imprese appaltatrici e gli eventuali subappaltatori (nel seguito denominati Appaltatori) a operare negli ambienti di lavoro di ${draft.clientName.trim()} (nel seguito chiamata la Committente).`, true);
    }
  }

  const bodyText = (needle: string, replacement: string) => {
    const found = findBodyParagraph(body, (text) => text.includes(needle));
    if (found) setParagraphText(found.paragraph, replacement, true);
    return !!found;
  };
  bodyText('Le opere in appalto vengono realizzate in aree interne gestite dalla Committente', draft.siteCharacteristics || draft.siteDescription);
  const s21 = directBodyParagraphsBetween(body, '2.1 Caratteristiche dell’area interessata', '2.2 Modalità di accesso alle aree');
  const placeholder21 = s21.find((p) => /^[.…\s]+$/.test(normalized(textOf(p))));
  if (placeholder21) setParagraphText(placeholder21, draft.siteDescription, true);
  bodyText("L'accesso alle aree interessate dalle attività oggetto dell'appalto", draft.accessDescription);
  bodyText("La gestione delle emergenze all'interno del punto vendita", draft.emergencyDescription);

  fillClientActivityList(body, draft);
  const s4 = directBodyParagraphsBetween(body, 'DESCRIZIONE ATTIVITÀ SVOLTE DA PARTE DELLE AZIENDE APPALTATRICI', 'Elenco delle attrezzature utilizzate');
  const placeholder4 = s4.find((p) => /^[.…\s]+$/.test(normalized(textOf(p))));
  if (placeholder4) setParagraphText(placeholder4, draft.contractorSummary || draft.contractors.map((c) => c.legalName + ': ' + c.activityDescription).join(' '), true);
  const servicesP = findBodyParagraph(body, (text) => text.startsWith('Al personale delle imprese appaltatrici è consentito l’utilizzo dei servizi igienici'));
  if (servicesP) setParagraphText(servicesP.paragraph, 'L’accesso ai servizi e alle aree di supporto è consentito esclusivamente secondo le modalità autorizzate dalla Committente e indicate nelle istruzioni di accesso.', true);
  fillEquipmentSection(body, draft);
  fillPpeList(body, draft);

  const riskSummary1 = findBodyParagraph(body, (text) => text.startsWith('Nella presente valutazione delle interferenze'));
  if (riskSummary1) setParagraphText(riskSummary1.paragraph, draft.interferenceSummary, true);
  const riskSummary2 = findBodyParagraph(body, (text) => text.startsWith('La compresenza del personale della Committente'));
  if (riskSummary2) setParagraphText(riskSummary2.paragraph, draft.interferenceMeasures, true);

  fillRiskTables(doc, draft.riskRows);
  const signatures = draft.contractors.map((c) => ({
    ...c,
    activityDescription: c.activityDescription || '',
    equipment: Array.isArray(c.equipment) ? c.equipment : [],
    ppe: Array.isArray(c.ppe) ? c.ppe : []
  }));
  const contractorRows = signatures.filter((c) => !/subappalt/i.test(c.role));
  const allRowsForCover = [
    ...contractorRows,
    ...signatures.filter((c) => /subappalt/i.test(c.role))
  ];
  fillSignatureTable(doc, draft.clientName.trim(), allRowsForCover);

  const dateTbl = dateTable(doc);
  if (dateTbl) {
    const rows = rowsOf(dateTbl);
    const cells = rows.length ? cellsOf(rows[0]) : [];
    if (cells[1]) setCellText(cells[1], formattedDate);
  }

  zip.file('word/document.xml', serializeXml(doc));
  const headerSlug = 'DUVRI_' + titleSlug(draft.title) + '_' + draft.documentDate.slice(0,4);
  for (const name of Object.keys(zip.files)) {
    if (/^word\/header\d+\.xml$/.test(name)) {
      const part = zip.file(name);
      if (!part) continue;
      const headerDoc = parseXml(await part.async('string'), name);
      updateHeaderPart(headerDoc, headerSlug);
      zip.file(name, serializeXml(headerDoc));
    }
  }
  await updateSettings(zip);
  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  const validation = await inspectDuvriTemplate(bytes);
  const remaining: string[] = [];
  const finalZip = await JSZip.loadAsync(toArrayBuffer(bytes));
  for (const name of Object.keys(finalZip.files).filter((path) => /^word\/(document|header\d+)\.xml$/.test(path))) {
    const xml = await finalZip.file(name)!.async('string');
    for (const marker of ['TITOLO DEL DUVRI', 'COMMITTENTE S.p.A.', 'NOME DEL DUVRI']) {
      if (xml.includes(marker)) remaining.push(name + ': ' + marker);
    }
  }
  return {
    bytes,
    report: {
      tableCountBefore: tablesBefore,
      tableCountAfter: validation.tableCount,
      riskRowsBefore,
      riskRowsAfter: validation.riskRows.length,
      riskRowsRetained: riskRowsBefore === validation.riskRows.length,
      signalingMediaPreserved: validation.hasSignageDiagram,
      remainingKnownPlaceholders: remaining,
      pageFieldsSetToUpdateOnOpen: true,
      humanReviewRequired: true,
      note: 'Indice e campi pagina richiedono apertura/aggiornamento e controllo visivo in Word; il file non è approvato automaticamente.'
    }
  };
}
