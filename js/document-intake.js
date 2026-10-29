/**
 * Motore locale di acquisizione documentale (Generazione documenti). Legge i file ricevuti dal
 * committente, li classifica, estrae dati etichettati conservandone la fonte e segnala soltanto
 * conflitti, anomalie e dati indispensabili mancanti. Nessuna rete, nessuna AI: i contenuti dei
 * file sono dati e non vengono mai interpretati come istruzioni o inseriti come HTML.
 * Le dipendenze (JSZip, pdfjsLib, crypto) sono passate dal chiamante per poterlo testare in Node.
 */
const documentIntake = (() => {
  'use strict';

  const MAX_FILE_BYTES = 50 * 1024 * 1024;
  const MAX_TEXT_CHARS = 2000000;
  const MAX_PDF_PAGES = 300;
  const CLASSIFY_TEXT_CHARS = 20000;

  const CATEGORIES = {
    'contratto-capitolato': 'Contratto / capitolato',
    'dvr-specifico': 'DVR specifico dell’intervento',
    'cronoprogrammi': 'Cronoprogramma e programma lavori',
    'planimetrie-layout': 'Planimetrie, layout e disegni',
    'mezzi-attrezzature': 'Documenti di macchinari e attrezzature',
    'procedure-operative': 'Procedure operative',
    'emergenze': 'Emergenze e vie di esodo',
    'sds': 'SDS e prodotti chimici',
    'permessi': 'Permessi e autorizzazioni',
    'foto-sito': 'Foto del luogo di lavoro e degli accessi',
    'altri-allegati': 'Altri allegati'
  };

  // Parole chiave su testo normalizzato (minuscolo, senza accenti). Nel nome del file pesano di più.
  const CATEGORY_KEYWORDS = {
    'contratto-capitolato': ['contratto', 'capitolato', 'ordine di lavoro', 'ordine d acquisto', 'offerta', 'preventivo', 'lettera d incarico', 'condizioni generali'],
    'dvr-specifico': ['dvr', 'documento di valutazione dei rischi', 'valutazione dei rischi', 'piano operativo di sicurezza', 'pos'],
    'cronoprogrammi': ['cronoprogramma', 'programma lavori', 'programma dei lavori', 'gantt', 'planning', 'calendario lavori'],
    'planimetrie-layout': ['planimetria', 'planimetrie', 'layout', 'pianta', 'tavola', 'prospetto', 'sezione architettonica'],
    'mezzi-attrezzature': ['libretto', 'manuale d uso', 'manuale uso e manutenzione', 'attrezzature', 'macchine', 'piattaforma', 'ple', 'carrello elevatore', 'gru', 'verifica periodica', 'marcatura ce', 'dichiarazione di conformita'],
    'procedure-operative': ['procedura', 'istruzione operativa', 'istruzioni operative', 'metodo di lavoro', 'sequenza operativa'],
    'emergenze': ['emergenza', 'evacuazione', 'esodo', 'primo soccorso', 'antincendio', 'punto di raccolta', 'piano di emergenza'],
    'sds': ['scheda di sicurezza', 'scheda dati di sicurezza', 'sds', 'msds', '1907/2006', 'reach', 'identificazione della sostanza'],
    'permessi': ['permesso di lavoro', 'permessi', 'autorizzazione', 'nulla osta', 'lavori a caldo', 'permesso'],
    'foto-sito': []
  };

  const FIELDS = {
    committente: { label: 'Committente', re: /^(?:azienda |societa )?committente$/ },
    appaltatore: { label: 'Impresa appaltatrice', multi: true, re: /^(?:impresa |ditta )?(?:appaltatrice|appaltatore|esecutrice)$|^ragione sociale(?: (?:impresa|appaltatore|ditta))?$/ },
    subappaltatore: { label: 'Subappaltatore', multi: true, re: /^(?:impresa )?subappaltatric[ei]$|^subappaltator[ei]$/ },
    preposto: { label: 'Preposto', multi: true, re: /^preposto(?: (?:di cantiere|dell impresa|appaltatore))?$|^nominativo (?:del )?preposto$/ },
    datore_lavoro: { label: 'Datore di lavoro', multi: true, re: /^datore di lavoro$/ },
    sede: { label: 'Luogo dei lavori', re: /^(?:luogo|sede|indirizzo|ubicazione) (?:dei lavori|del cantiere|di lavoro|di esecuzione(?: dei lavori)?|dell intervento)$|^cantiere$/ },
    oggetto_appalto: { label: 'Oggetto dell’appalto', re: /^oggetto (?:dell appalto|dei lavori|del contratto|dell intervento)$/ },
    data_inizio: { label: 'Data di inizio lavori', date: true, re: /^(?:data (?:di )?)?inizio(?: (?:dei )?lavori| attivita)?$/ },
    data_fine: { label: 'Data di fine lavori', date: true, re: /^(?:data (?:di )?)?(?:fine|termine)(?: (?:dei )?lavori| attivita)?$/ },
    partita_iva: { label: 'Partita IVA', multi: true },
    punto_vendita: { label: 'Punto vendita', re: /^(?:punto vendita|negozio|pv)$/ }
  };

  // Registro dei tipi. I campi indispensabili e i blocchi riprendono le fonti Colligo
  // (campi_obbligatori.json, blocchi.json): un tipo genera solo senza blocchi aperti.
  const DOCUMENT_TYPES = {
    duvri: {
      label: 'DUVRI',
      required: ['committente', 'appaltatore', 'preposto', 'sede', 'oggetto_appalto', 'data_inizio', 'data_fine', 'titolo'],
      manualOnly: { titolo: 'Titolo del DUVRI: va stabilito da Colligo, non si ricava dai file.' },
      template: {
        name: 'DUVRI_BASE_GENERALE_2026.docx',
        sha256: '69b2f63c5363ebd1af59a847b9d1ee8a29b04a4d588bd2e49a2b7bd9a3c4386f',
        baseline: { paragraphs: 809, tables: 13, sections: 19, images: 17 }
      },
      blocks: [{ id: 'DUVRI-SCALA', message: 'Scala del rischio non decisa: il modello usa una matrice 1-9, le istruzioni citano indici 1-3. Serve una decisione Colligo prima di valutare o generare.' }]
    },
    'informativa-coin': {
      label: 'Informativa COIN',
      required: ['committente', 'punto_vendita', 'sede', 'data_documento'],
      manualOnly: { data_documento: 'Data del documento: va stabilita da Colligo al momento dell’emissione.' },
      template: null,
      blocks: [{ id: 'INFO-MODELLO', message: 'Il modello “Inf. Rischi art.26_COIN - base.docx” non è ancora stato letto e verificato.' }]
    }
  };

  function normalize(text) {
    return String(text || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
      .replace(/[’'`]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function comparable(value) {
    return normalize(value).replace(/\b(s)\.?\s?(r|p)\.?\s?(l|a)\.?(?=\s|$)/g, '$1$2$3').replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function extension(name) {
    const match = /\.([a-z0-9]+)$/i.exec(String(name || ''));
    return match ? match[1].toLowerCase() : '';
  }

  function decodeXml(text) {
    return text.replace(/&(lt|gt|amp|quot|apos|#(\d+)|#x([0-9a-f]+));/gi, (m, name, dec, hex) =>
      dec ? String.fromCodePoint(Number(dec)) : hex ? String.fromCodePoint(parseInt(hex, 16))
        : { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }[name.toLowerCase()]);
  }

  async function sha256(bytes, cryptoImpl) {
    const digest = await cryptoImpl.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  }

  function detectFormat(name, bytes) {
    const ext = extension(name);
    const head = String.fromCharCode(...bytes.subarray(0, 5));
    const isZip = head.startsWith('PK');
    const expected = { pdf: '%PDF', docx: 'PK', xlsx: 'PK' }[ext];
    if (expected && !head.startsWith(expected)) return { format: ext, mismatch: true };
    if (['pdf', 'docx', 'xlsx'].includes(ext)) return { format: ext };
    if (['txt', 'csv', 'md', 'eml', 'json', 'xml'].includes(ext) && !isZip) return { format: 'text' };
    if (['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif', 'gif', 'tif', 'tiff', 'bmp'].includes(ext)) return { format: 'image' };
    return { format: 'unsupported' };
  }

  async function zipText(zip, path) {
    const entry = zip.file(path);
    if (!entry) return null;
    // Protezione da archivi compressi anomali: dimensione dichiarata prima di decomprimere.
    if (entry._data && entry._data.uncompressedSize > MAX_FILE_BYTES) throw new Error('parte interna troppo grande (' + path + ')');
    return entry.async('string');
  }

  async function readDocx(bytes, JSZip) {
    const zip = await JSZip.loadAsync(bytes);
    const xml = await zipText(zip, 'word/document.xml');
    if (xml == null) throw new Error('word/document.xml assente');
    const body = xml.replace(/<mc:Fallback>[\s\S]*?<\/mc:Fallback>/g, '');
    const units = [];
    body.split(/<\/w:p>/).forEach((chunk) => {
      // Solo il testo visibile (w:t): i codici di campo in w:instrText restano esclusi.
      const text = decodeXml((chunk.match(/<w:t(?:\s[^>]*)?>[^<]*<\/w:t>|<w:tab\/>|<w:br\/>/g) || [])
        .map((part) => part === '<w:tab/>' ? '\t' : part === '<w:br/>' ? '\n' : part.replace(/<[^>]+>/g, '')).join('')
      ).trim();
      if (text) units.push({ location: 'paragrafo ' + (units.length + 1), text });
    });
    return units;
  }

  async function readXlsx(bytes, JSZip) {
    const zip = await JSZip.loadAsync(bytes);
    const shared = [];
    const sharedXml = await zipText(zip, 'xl/sharedStrings.xml');
    if (sharedXml) for (const si of sharedXml.match(/<si>[\s\S]*?<\/si>/g) || []) {
      shared.push(decodeXml((si.match(/<t(?:\s[^>]*)?>([^<]*)<\/t>/g) || []).map((t) => t.replace(/<[^>]+>/g, '')).join('')));
    }
    const workbook = (await zipText(zip, 'xl/workbook.xml')) || '';
    const rels = (await zipText(zip, 'xl/_rels/workbook.xml.rels')) || '';
    const targets = Object.fromEntries([...rels.matchAll(/<Relationship\b[^>]*>/g)].map(([tag]) =>
      [(/Id="([^"]+)"/.exec(tag) || [])[1], (/Target="([^"]+)"/.exec(tag) || [])[1]]));
    const units = [];
    for (const [tag] of workbook.matchAll(/<sheet\b[^>]*>/g)) {
      const sheetName = decodeXml((/name="([^"]*)"/.exec(tag) || [])[1] || 'Foglio');
      const target = targets[(/r:id="([^"]+)"/.exec(tag) || [])[1]];
      if (!target) continue;
      const xml = await zipText(zip, target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\//, ''));
      if (!xml) continue;
      for (const row of xml.match(/<row\b(?:[^>]*?\/>|[^>]*>[\s\S]*?<\/row>)/g) || []) {
        const rowNumber = (/\br="(\d+)"/.exec(row) || [])[1];
        const cells = [];
        for (const cell of row.match(/<c\b(?:[^>]*?\/>|[^>]*>[\s\S]*?<\/c>)/g) || []) {
          const type = (/\bt="([^"]+)"/.exec(cell) || [])[1];
          const raw = type === 'inlineStr'
            ? (cell.match(/<t(?:\s[^>]*)?>([^<]*)<\/t>/g) || []).map((t) => t.replace(/<[^>]+>/g, '')).join('')
            : (/<v>([^<]*)<\/v>/.exec(cell) || [])[1];
          if (raw == null || raw === '') continue;
          cells.push(type === 's' ? (shared[Number(raw)] || '') : decodeXml(raw));
        }
        if (cells.length) units.push({ location: 'foglio “' + sheetName + '”, riga ' + rowNumber, text: cells.join(' | ') });
      }
    }
    return units;
  }

  async function readPdf(bytes, pdfjsLib) {
    // isEvalSupported:false come in pdf-import.js (avviso GHSA-wgrm-67xf-hhpq).
    // pdf.js trasferisce il buffer ricevuto: gli si passa una copia.
    const pdf = await pdfjsLib.getDocument({ data: bytes.slice(), isEvalSupported: false }).promise;
    const units = [];
    const pages = Math.min(pdf.numPages, MAX_PDF_PAGES);
    for (let n = 1; n <= pages; n++) {
      const content = await (await pdf.getPage(n)).getTextContent();
      let line = '';
      const flush = () => { if (line.trim()) units.push({ location: 'pagina ' + n, text: line.trim() }); line = ''; };
      for (const item of content.items) {
        line += item.str;
        if (item.hasEOL) flush();
      }
      flush();
    }
    return { units, truncated: pdf.numPages > MAX_PDF_PAGES };
  }

  function classify(name, units, format) {
    if (format === 'image') {
      const byName = classify(name, [], 'name');
      return byName.confidence === 'alta' ? byName : { category: 'foto-sito', confidence: 'media', evidence: ['immagine'] };
    }
    const fileName = normalize(name.replace(/[_\-.]+/g, ' '));
    const text = normalize(units.map((u) => u.text).join('\n').slice(0, CLASSIFY_TEXT_CHARS));
    let best = { category: 'altri-allegati', score: 0, evidence: [] };
    let second = 0;
    for (const [category, words] of Object.entries(CATEGORY_KEYWORDS)) {
      let score = 0;
      const evidence = [];
      for (const word of words) {
        const re = new RegExp('(^|[^a-z0-9])' + word.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&') + '([^a-z0-9]|$)');
        if (re.test(fileName)) { score += 3; evidence.push('nome: ' + word); } else if (re.test(text)) { score += 1; evidence.push('testo: ' + word); }
      }
      if (score > best.score) { second = best.score; best = { category, score, evidence }; } else if (score > second) second = score;
    }
    const confidence = best.score >= 3 && best.score - second >= 2 ? 'alta' : best.score >= 2 && best.score > second ? 'media' : 'bassa';
    return { category: best.score ? best.category : 'altri-allegati', confidence, evidence: best.evidence };
  }

  function parseDate(value) {
    const m = /\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})\b/.exec(value);
    if (!m) return null;
    const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    const date = new Date(Date.UTC(year, Number(m[2]) - 1, Number(m[1])));
    if (date.getUTCDate() !== Number(m[1]) || date.getUTCMonth() !== Number(m[2]) - 1) return null;
    return date.toISOString().slice(0, 10);
  }

  function validPartitaIva(digits) {
    let sum = 0;
    for (let i = 0; i < 10; i++) {
      let d = Number(digits[i]);
      if (i % 2) { d *= 2; if (d > 9) d -= 9; }
      sum += d;
    }
    return (10 - (sum % 10)) % 10 === Number(digits[10]);
  }

  function matchField(label) {
    const key = normalize(label).replace(/[.]/g, '').replace(/\s+/g, ' ');
    return Object.keys(FIELDS).find((field) => FIELDS[field].re && FIELDS[field].re.test(key));
  }

  function extractFacts(file, units) {
    const facts = [];
    const issues = [];
    const add = (field, rawValue, unit) => {
      // Il valore finisce dove iniziano altri dati sulla stessa riga (P.IVA, C.F., contatti).
      let value = rawValue.split(/\s{3,}|\s+(?:p\.?\s?iva|partita iva|c\.f\.|cod\.? fisc\w*|tel\.?|e-?mail|pec)(?=[\s:.]|$)/i)[0]
        .replace(/\s+/g, ' ').replace(/[;,\s]+$/, '').trim().slice(0, 160);
      if (!value) return;
      const source = { fileId: file.id, file: file.name, location: unit.location, snippet: unit.text.slice(0, 200) };
      if (FIELDS[field].date) {
        const iso = parseDate(value);
        if (!iso) { issues.push({ type: 'anomaly', field, message: FIELDS[field].label + ': data non interpretabile (“' + value + '”).', sources: [source] }); return; }
        value = iso;
      }
      facts.push({ field, value, source });
    };
    const LABELED = /^\s*([A-Za-zÀ-ÿ'’. ]{2,60}?)\s*(?::|\||–)\s*(.*)$/;
    const isLabel = (text) => {
      const m = LABELED.exec(text);
      return Boolean(matchField(m ? m[1] : text));
    };
    units.forEach((unit, index) => {
      const labeled = LABELED.exec(unit.text);
      const field = matchField(labeled ? labeled[1] : unit.text);
      if (field && labeled && labeled[2]) add(field, labeled[2].split(/\s+\|\s+/)[0], unit);
      // Etichetta e valore in celle o righe separate (tabelle DOCX/PDF): valore nell'unità seguente.
      else if (field && units[index + 1] && !isLabel(units[index + 1].text)) add(field, units[index + 1].text, units[index + 1]);
      for (const m of unit.text.matchAll(/\b(?:p\.?\s?iva|partita\s+iva|vat)\b[^0-9A-Za-z]{0,12}(?:IT\s?)?(\d{11})\b/gi)) {
        const source = { fileId: file.id, file: file.name, location: unit.location, snippet: unit.text.slice(0, 200) };
        facts.push({ field: 'partita_iva', value: m[1], source });
        if (!validPartitaIva(m[1])) issues.push({ type: 'anomaly', field: 'partita_iva', message: 'Partita IVA ' + m[1] + ' con cifra di controllo non valida.', sources: [source] });
      }
    });
    return { facts, issues };
  }

  async function analyzeFile(input, deps) {
    const bytes = new Uint8Array(input.bytes);
    // Per i file troppo grandi il chiamante passa solo l'intestazione e la dimensione reale.
    const size = input.size != null ? input.size : bytes.byteLength;
    const file = { id: input.id, name: input.name, size, sha256: size === bytes.byteLength ? await sha256(bytes, deps.crypto) : null };
    const issues = [];
    const anomaly = (message) => issues.push({ type: 'anomaly', message: file.name + ': ' + message, sources: [{ fileId: file.id, file: file.name }] });
    const detected = detectFormat(file.name, bytes);
    file.format = detected.format;
    let units = [];
    if (detected.mismatch) {
      anomaly('l’estensione non corrisponde al contenuto; file non letto.');
      file.readStatus = 'non_letto';
    } else if (size > MAX_FILE_BYTES) {
      anomaly('supera 50 MB; file non letto, verificare manualmente.');
      file.readStatus = 'non_letto';
    } else {
      try {
        if (file.format === 'pdf') {
          const pdf = await readPdf(bytes, deps.pdfjsLib);
          units = pdf.units;
          if (pdf.truncated) anomaly('letto solo nelle prime ' + MAX_PDF_PAGES + ' pagine.');
          if (!units.length) anomaly('PDF senza testo leggibile (probabile scansione): contenuto da verificare manualmente.');
        } else if (file.format === 'docx') units = await readDocx(bytes, deps.JSZip);
        else if (file.format === 'xlsx') units = await readXlsx(bytes, deps.JSZip);
        else if (file.format === 'text') units = new TextDecoder('utf-8').decode(bytes).split(/\r?\n/).map((text, i) => ({ location: 'riga ' + (i + 1), text: text.trim() })).filter((u) => u.text);
        file.readStatus = file.format === 'image' ? 'immagine' : file.format === 'unsupported' ? 'non_supportato' : 'letto';
        if (file.format === 'unsupported') anomaly('formato non leggibile automaticamente (.' + (extension(file.name) || '?') + '): verificare manualmente.');
      } catch (error) {
        file.readStatus = 'errore';
        anomaly('lettura non riuscita (' + (error && error.message ? error.message : 'errore') + '); verificare manualmente.');
        units = [];
      }
    }
    let total = 0;
    const allUnits = units.length;
    units = units.filter((u) => (total += u.text.length) <= MAX_TEXT_CHARS);
    if (units.length < allUnits) anomaly('testo molto lungo: analizzati solo i primi ' + MAX_TEXT_CHARS + ' caratteri.');
    const classification = classify(file.name, units, file.format);
    Object.assign(file, { category: classification.category, categoryLabel: CATEGORIES[classification.category], confidence: classification.confidence, classificationEvidence: classification.evidence, textUnits: units.length });
    const extracted = extractFacts(file, units);
    return { file, facts: extracted.facts, issues: issues.concat(extracted.issues) };
  }

  function consolidate(typeId, results) {
    const type = DOCUMENT_TYPES[typeId];
    const issues = results.flatMap((r) => r.issues);
    const files = results.map((r) => r.file);
    const fields = {};
    for (const fact of results.flatMap((r) => r.facts)) {
      const field = fields[fact.field] || (fields[fact.field] = { key: fact.field, label: FIELDS[fact.field].label, values: [] });
      const key = comparable(fact.value);
      const existing = field.values.find((v) => comparable(v.value) === key);
      if (existing) existing.sources.push(fact.source); else field.values.push({ value: fact.value, sources: [fact.source] });
    }
    for (const field of Object.values(fields)) {
      field.status = !FIELDS[field.key].multi && field.values.length > 1 ? 'conflicting' : 'extracted_unconfirmed';
      if (field.status === 'conflicting') issues.push({ type: 'conflict', field: field.key, message: field.label + ': valori diversi nei file (' + field.values.map((v) => '“' + v.value + '”').join(' / ') + '). Scegliere la fonte corretta.', sources: field.values.flatMap((v) => v.sources) });
    }
    for (const key of type.required) {
      if (fields[key]) continue;
      issues.push({ type: 'missing', field: key, message: (type.manualOnly && type.manualOnly[key]) || (FIELDS[key] ? FIELDS[key].label : key) + ': non trovato nei file caricati.' });
    }
    const start = fields.data_inizio, end = fields.data_fine;
    if (start && end && start.values.length === 1 && end.values.length === 1 && end.values[0].value < start.values[0].value) {
      issues.push({ type: 'anomaly', field: 'data_fine', message: 'La data di fine lavori precede la data di inizio.', sources: [...start.values[0].sources, ...end.values[0].sources] });
    }
    const seen = {};
    for (const file of files) {
      if (!file.sha256) continue;
      if (seen[file.sha256]) issues.push({ type: 'anomaly', message: file.name + ': contenuto identico a ' + seen[file.sha256] + '.', sources: [{ fileId: file.id, file: file.name }] });
      else seen[file.sha256] = file.name;
    }
    const uncertain = files.filter((f) => f.confidence === 'bassa' && f.readStatus === 'letto');
    if (uncertain.length) issues.push({ type: 'anomaly', message: 'Classificazione incerta, verificare la categoria: ' + uncertain.map((f) => f.name).join(', ') + '.', sources: uncertain.map((f) => ({ fileId: f.id, file: f.name })) });
    const images = files.filter((f) => f.readStatus === 'immagine');
    if (images.length) issues.push({ type: 'anomaly', message: images.length + ' immagini: il contenuto non viene letto automaticamente (nessun OCR locale); verificarle a vista.', sources: images.map((f) => ({ fileId: f.id, file: f.name })) });
    return { documentType: typeId, files, fields, issues };
  }

  function countMatches(text, re) { return (text.match(re) || []).length; }

  async function inspectTemplate(bytes, typeId, deps) {
    const type = DOCUMENT_TYPES[typeId];
    const data = new Uint8Array(bytes);
    const digest = await sha256(data, deps.crypto);
    const report = { sha256: digest, controlled: false, differences: [] };
    if (!type.template) { report.differences.push('Nessun modello ufficiale registrato per ' + type.label + '.'); return report; }
    try {
      const zip = await deps.JSZip.loadAsync(data);
      const xml = ((await zipText(zip, 'word/document.xml')) || '').replace(/<mc:Fallback>[\s\S]*?<\/mc:Fallback>/g, '');
      report.counts = {
        paragraphs: countMatches(xml, /<w:p[ >]/g),
        tables: countMatches(xml, /<w:tbl>/g),
        sections: countMatches(xml, /<w:sectPr[ >]/g),
        images: countMatches(xml, /<a:blip /g),
        headers: Object.keys(zip.files).filter((n) => /^word\/header\d+\.xml$/.test(n)).length,
        footers: Object.keys(zip.files).filter((n) => /^word\/footer\d+\.xml$/.test(n)).length,
        yellowHighlights: countMatches(xml, /<w:highlight w:val="yellow"\/>/g)
      };
    } catch (error) {
      report.differences.push('Il file non è un DOCX leggibile.');
      return report;
    }
    if (digest !== type.template.sha256) report.differences.push('L’impronta SHA-256 non corrisponde alla copia controllata di ' + type.template.name + '.');
    for (const [key, expected] of Object.entries(type.template.baseline)) {
      if (report.counts[key] !== expected) report.differences.push(key + ': ' + report.counts[key] + ' invece di ' + expected + '.');
    }
    report.controlled = report.differences.length === 0;
    return report;
  }

  function generationGate(typeId, templateReport, analysis) {
    const type = DOCUMENT_TYPES[typeId];
    const reasons = type.blocks.map((b) => b.id + ': ' + b.message);
    if (!type.template) reasons.push('Modello ufficiale non registrato.');
    else if (!templateReport) reasons.push('Caricare il modello ufficiale ' + type.template.name + ' per verificarlo.');
    else if (!templateReport.controlled) reasons.push('Il modello caricato non è la copia controllata: ' + templateReport.differences.join(' '));
    const open = analysis ? analysis.issues.filter((i) => i.type !== 'anomaly').length : 0;
    if (!analysis || !analysis.files.length) reasons.push('Nessun file del committente analizzato.');
    else if (open) reasons.push(open + ' conflitti o dati indispensabili da risolvere.');
    return { allowed: reasons.length === 0, reasons };
  }

  function safeArchiveName(name) {
    let leaf = String(name || '').split(/[\\/]/).pop();
    leaf = leaf.normalize('NFKD').replace(/[̀-ͯ]/g, '');
    leaf = leaf.replace(/[<>:"/\\|?*\x00-\x1f]+/g, '_').replace(/[^a-zA-Z0-9._() -]+/g, '_');
    leaf = leaf.replace(/^\.+/, '').replace(/[. ]+$/g, '').trim().slice(0, 120);
    if (!leaf || /^\.+$/.test(leaf)) leaf = 'allegato';
    if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/.test(leaf.split('.')[0].toUpperCase())) leaf = '_' + leaf;
    return leaf;
  }

  return { MAX_FILE_BYTES, CATEGORIES, FIELDS, DOCUMENT_TYPES, analyzeFile, consolidate, inspectTemplate, generationGate, safeArchiveName, classify, extractFacts, validPartitaIva, parseDate };
})();
