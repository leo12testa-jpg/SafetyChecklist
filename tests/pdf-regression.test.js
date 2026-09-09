/**
 * Test di regressione su PDF REALI (jsPDF/autoTable veri, non mock), uno per ciascun cliente
 * (Coin/Interparking/Restage/Melluso), con dati di prova volutamente pesanti: tutte le domande
 * risposte, una nota molto lunga, una didascalia molto lunga, foto portrait e landscape, due
 * tecnici - abbastanza contenuto da generare piu' pagine, come richiesto per verificare che il
 * motore PDF centralizzato (js/pdf.js) non perda contenuti ne' rompa l'impaginazione su nessun
 * cliente.
 *
 * Nessuna dipendenza esterna: jsPDF genera per default PDF NON compressi (compress:false), quindi
 * il content stream di ogni pagina e' testo leggibile in chiaro - questo file legge direttamente
 * gli operatori Tj/TJ e le dictionary /Subtype /Image dal PDF grezzo, senza bisogno di un parser
 * PDF vero (pdf.js/Mozilla richiederebbe un Worker, non disponibile in puro Node).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const zlib = require('node:zlib');

const PROJECT_ROOT = path.join(__dirname, '..');

// ---------------------------------------------------------------------------------------------
// Encoder PNG minimale (tinta unita), per generare foto di prova con dimensioni pixel esatte
// (per verificare portrait/landscape) senza dipendere da file immagine esterni nel repo.
// ---------------------------------------------------------------------------------------------
function crc32(buf) {
  const tabella = crc32.tabella || (crc32.tabella = (() => {
    const t = [];
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c;
    }
    return t;
  })());
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) crc = tabella[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunkPng(tipo, dati) {
  const lunghezza = Buffer.alloc(4);
  lunghezza.writeUInt32BE(dati.length, 0);
  const tipoBuf = Buffer.from(tipo, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([tipoBuf, dati])), 0);
  return Buffer.concat([lunghezza, tipoBuf, dati, crcBuf]);
}

function pngTintaUnita(larghezza, altezza, [r, g, b]) {
  const firma = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(larghezza, 0);
  ihdr.writeUInt32BE(altezza, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type RGB
  const grezzo = Buffer.alloc((larghezza * 3 + 1) * altezza);
  for (let y = 0; y < altezza; y += 1) {
    const inizioRiga = y * (larghezza * 3 + 1);
    grezzo[inizioRiga] = 0; // nessun filtro
    for (let x = 0; x < larghezza; x += 1) {
      const off = inizioRiga + 1 + x * 3;
      grezzo[off] = r; grezzo[off + 1] = g; grezzo[off + 2] = b;
    }
  }
  return Buffer.concat([firma, chunkPng('IHDR', ihdr), chunkPng('IDAT', zlib.deflateSync(grezzo)), chunkPng('IEND', Buffer.alloc(0))]);
}

// ---------------------------------------------------------------------------------------------
// Estrazione testo/immagini da un PDF jsPDF non compresso.
// ---------------------------------------------------------------------------------------------
// jsPDF disegna il testo con WinAnsiEncoding (cp1252), non Latin-1: nell'intervallo 0x80-0x9F le
// due codifiche divergono (Latin-1 li' ha solo caratteri di controllo C1) - caratteri comuni nei
// testi italiani come il trattino medio (byte 0x96) o le virgolette tipografiche andrebbero persi
// leggendo il buffer come puro latin1. Rimappa quell'intervallo ai codepoint Unicode corretti
// (valori scritti come \uXXXX per evitare qualunque ambiguita' di codifica del file sorgente).
const CP1252_ALTI = {
  0x80: '€', 0x82: '‚', 0x83: 'ƒ', 0x84: '„', 0x85: '…',
  0x86: '†', 0x87: '‡', 0x88: 'ˆ', 0x89: '‰', 0x8A: 'Š',
  0x8B: '‹', 0x8C: 'Œ', 0x8E: 'Ž', 0x91: '‘', 0x92: '’',
  0x93: '“', 0x94: '”', 0x95: '•', 0x96: '–', 0x97: '—',
  0x98: '˜', 0x99: '™', 0x9A: 'š', 0x9B: '›', 0x9C: 'œ',
  0x9E: 'ž', 0x9F: 'Ÿ'
};
function correggiWinAnsi(s) {
  let risultato = '';
  for (let i = 0; i < s.length; i += 1) {
    const codice = s.charCodeAt(i);
    risultato += (codice >= 0x80 && codice <= 0x9f) ? (CP1252_ALTI[codice] || s[i]) : s[i];
  }
  return risultato;
}

function decodificaStringaPdf(s) {
  const decodificata = s.replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (m, g) => {
    if (g === 'n') return '\n';
    if (g === 'r') return '\r';
    if (g === 't') return '\t';
    if (g === 'b') return '\b';
    if (g === 'f') return '\f';
    if (g === '(' || g === ')' || g === '\\') return g;
    return String.fromCharCode(parseInt(g, 8));
  });
  return correggiWinAnsi(decodificata);
}

function estraiTestoPdf(buffer) {
  const testo = buffer.toString('latin1');
  const pezzi = [];
  const reTj = /\(((?:[^()\\]|\\.)*)\)\s*Tj/g;
  let m;
  while ((m = reTj.exec(testo))) pezzi.push(decodificaStringaPdf(m[1]));
  const reTJ = /\[((?:[^[\]]|\\.)*)\]\s*TJ/g;
  while ((m = reTJ.exec(testo))) {
    const reStr = /\(((?:[^()\\]|\\.)*)\)/g;
    let ms; let riga = '';
    while ((ms = reStr.exec(m[1]))) riga += decodificaStringaPdf(ms[1]);
    pezzi.push(riga);
  }
  return pezzi;
}

function normalizza(s) {
  return String(s).replace(/\s+/g, ' ').trim();
}

function testoNormalizzato(buffer) {
  return normalizza(estraiTestoPdf(buffer).join(' '));
}

function contaPagine(buffer) {
  const testo = buffer.toString('latin1');
  return (testo.match(/\/Type\s*\/Page[^s]/g) || []).length;
}

function elencoImmagini(buffer) {
  const testo = buffer.toString('latin1');
  const re = /\/Subtype\s*\/Image[\s\S]{0,300}?\/Width\s+(\d+)[\s\S]{0,150}?\/Height\s+(\d+)/g;
  const risultato = [];
  let m;
  while ((m = re.exec(testo))) {
    risultato.push({ width: Number(m[1]), height: Number(m[2]) });
  }
  return risultato;
}

/** Confronta un array eventualmente creato in un altro vm.Context con un array normale: i valori
 * sono primitivi (numeri), quindi Array.from() li riporta a un array del realm corrente prima del
 * confronto - deepStrictEqual fallirebbe altrimenti per prototipi Array diversi tra i due realm. */
function comeArrayLocale(valore) {
  return Array.from(valore);
}

// ---------------------------------------------------------------------------------------------
// Harness: carica jsPDF + autoTable + js/pdf.js REALI in un vm.Context Node, con fetch/FileReader/
// fotoSync stub che leggono/producono byte reali (loghi veri da assets/, foto di prova generate),
// cosi' il PDF prodotto e' indistinguibile da uno generato in browser.
// ---------------------------------------------------------------------------------------------
class FileReaderFinto {
  readAsDataURL(blob) {
    blob.arrayBuffer()
      .then((buf) => {
        this.result = `data:${blob.type || 'application/octet-stream'};base64,${Buffer.from(buf).toString('base64')}`;
        this.onload();
      })
      .catch((errore) => { if (this.onerror) this.onerror(errore); });
  }
}

function creaMotorePdf(fotoFixture) {
  const context = {
    console,
    Uint8Array, ArrayBuffer, Blob,
    setTimeout, clearTimeout, queueMicrotask,
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    navigator: { userAgent: 'node' },
    FileReader: FileReaderFinto,
    // Nessuna checklist di test usa etichette personalizzate: mappa vuota, come da fallback
    // documentato in js/pdf.js (etichetteDatiGenerali) per checklist non elencate.
    ETICHETTE_PERSONALIZZATE_PER_CHECKLIST: {},
    fetch: async (url) => {
      try {
        const buf = fs.readFileSync(path.join(PROJECT_ROOT, url));
        const ext = path.extname(url).toLowerCase();
        const mime = { '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' }[ext] || 'application/octet-stream';
        return { ok: true, status: 200, blob: async () => new Blob([buf], { type: mime }) };
      } catch (errore) {
        return { ok: false, status: 404 };
      }
    },
    fotoSync: {
      risolviFoto: async (id) => (fotoFixture[id] ? { id, blob: new Blob([fotoFixture[id]], { type: 'image/png' }) } : null)
    }
  };
  context.window = context;
  context.self = context;
  context.globalThis = context;
  vm.createContext(context);

  const carica = (relativo) => vm.runInContext(fs.readFileSync(path.join(PROJECT_ROOT, relativo), 'utf8'), context);
  carica('js/vendor/jspdf.umd.min.js');
  carica('js/vendor/jspdf.plugin.autotable.min.js');
  // js/pdf.js dichiara "const pdf = ..." a livello di script: un binding lessicale, non una
  // proprieta' del contesto vm (a differenza di "var"/assegnazioni esplicite come fa l'UMD di
  // jsPDF sopra) - va riesposto esplicitamente sul contesto per poterlo leggere da fuori, stesso
  // pattern gia' usato in tests/pdf-references.test.js.
  vm.runInContext(`${fs.readFileSync(path.join(PROJECT_ROOT, 'js/pdf.js'), 'utf8')}\nglobalThis.pdf = pdf;`, context);

  return {
    _test: context.pdf._test,
    async generaPdfBuffer(checklist, sopralluogo) {
      context.__checklist = checklist;
      context.__sopralluogo = sopralluogo;
      vm.runInContext('globalThis.__risultato = pdf.generaReport(__checklist, __sopralluogo);', context);
      const blob = await context.__risultato;
      return Buffer.from(await blob.arrayBuffer());
    }
  };
}

function caricaChecklist(nomeFile) {
  return JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'checklists', nomeFile), 'utf8'));
}

// Foto di prova condivise: una portrait e due landscape per le domande, una landscape per
// l'allegato di "Altri aspetti da evidenziare" (con didascalia lunga scritta a mano).
const FOTO_FIXTURE = {
  'foto-portrait': pngTintaUnita(400, 600, [200, 50, 50]),
  'foto-landscape-1': pngTintaUnita(700, 350, [50, 150, 50]),
  'foto-landscape-2': pngTintaUnita(900, 300, [50, 50, 200]),
  'foto-extra': pngTintaUnita(600, 400, [10, 10, 10])
};

const NOTA_LUNGA = 'Nota molto lunga di verifica sul campo: '
  + 'verificato quanto rilevato durante il sopralluogo odierno, con particolare '
  + 'attenzione ai presidi antincendio, alle vie di esodo e alla cartellonistica di sicurezza. '.repeat(15)
  + 'FINE-NOTA-LUNGA-MARKER';

const NOTA_ALTRI_ASPETTI = 'Nota finale molto lunga da monitorare nei prossimi sopralluoghi periodici. '.repeat(45)
  + 'FINE-ALTRI-ASPETTI-MARKER';

const DIDASCALIA_LUNGA = 'Didascalia molto lunga scritta a mano dal tecnico per documentare con precisione '
  + 'un dettaglio specifico riscontrato durante il sopralluogo odierno presso il punto vendita, comprensiva '
  + 'di riferimenti normativi e indicazioni operative per la risoluzione della non conformita\' riscontrata.';

/** Costruisce un sopralluogo di prova completo (tutte le domande risposte) da una checklist reale. */
function costruisciSopralluogoDiProva(checklist, puntoVendita) {
  const domandeFlat = [];
  checklist.sezioni.forEach((sezione) => sezione.domande.forEach((domanda) => domandeFlat.push(domanda)));
  const totale = domandeFlat.length;
  const indicePortrait = Math.floor(totale * 0.15);
  const indiceLandscape1 = Math.floor(totale * 0.5);
  const indiceLandscape2 = Math.min(Math.floor(totale * 0.8), totale - 1);
  const indiceNotaLunga = Math.min(3, totale - 1);

  const risposte = domandeFlat.map((domanda, idx) => {
    const foto = [];
    if (idx === indicePortrait) foto.push('foto-portrait');
    if (idx === indiceLandscape1) foto.push('foto-landscape-1');
    if (idx === indiceLandscape2) foto.push('foto-landscape-2');
    return {
      domanda_id: domanda.id,
      risposta: ['C', 'PC', 'NC', 'NA'][idx % 4],
      note: idx === indiceNotaLunga ? NOTA_LUNGA : (idx % 5 === 0 ? 'Nota breve di verifica sul campo.' : ''),
      foto: foto.length ? foto : undefined
    };
  });

  const sopralluogo = {
    punto_vendita: puntoVendita,
    indirizzo_punto_vendita: 'Via di Prova 1, Milano',
    numero_dipendenti: 42,
    tecnico: 'Mario Rossi',
    tecnico_2: 'Anna Verdi',
    data_sopralluogo: '2026-09-08',
    responsabile_punto_vendita: 'Luca Bianchi',
    presenza_responsabile: 'Si',
    presenza_rls: 'No',
    risposte,
    altri_aspetti: NOTA_ALTRI_ASPETTI,
    altri_aspetti_foto: ['foto-extra'],
    altri_aspetti_foto_didascalie: { 'foto-extra': DIDASCALIA_LUNGA }
  };

  return { sopralluogo, domandeFlat };
}

const CLIENTI = [
  { chiave: 'coin', file: 'coin_sopralluogo.json', nome: 'Coin Test Store' },
  { chiave: 'interparking', file: 'interparking_sopralluogo.json', nome: 'Interparking Test Store' },
  { chiave: 'restage', file: 'restage_sopralluogo.json', nome: 'Restage Test Store' },
  { chiave: 'melluso', file: 'melluso_sopralluogo.json', nome: 'Melluso Test Store' }
];

for (const cliente of CLIENTI) {
  test(`PDF reale ${cliente.chiave}: nessuna eccezione, pagine/contenuti/foto coerenti, nessuna risposta persa`, async () => {
    const checklist = caricaChecklist(cliente.file);
    const { sopralluogo, domandeFlat } = costruisciSopralluogoDiProva(checklist, cliente.nome);
    if (cliente.chiave === 'melluso') {
      assert.deepEqual(domandeFlat.map(d => d.id), Array.from({ length: 58 }, (_, i) => i + 1).filter(id => id !== 40));
      sopralluogo.risposte.push({ domanda_id: 40, risposta: 'NC', note: 'VECCHIA-DOMANDA-40', foto: [] });
    }
    const motore = creaMotorePdf(FOTO_FIXTURE);

    const buf = await motore.generaPdfBuffer(checklist, sopralluogo);
    assert.equal(buf.slice(0, 4).toString(), '%PDF', 'il file generato non e\' un PDF valido');

    const pagine = contaPagine(buf);
    assert.ok(pagine > 1, `atteso piu' di 1 pagina, trovate ${pagine}`);
    assert.ok(pagine >= 5, `atteso almeno 5 pagine con questo volume di dati di prova, trovate ${pagine}`);

    const testoCompleto = testoNormalizzato(buf);
    assert.equal(testoCompleto.includes(normalizza('Numero di dipendenti in forza al momento del sopralluogo')), cliente.chiave !== 'melluso');
    if (cliente.chiave === 'melluso') {
      assert.ok(!testoCompleto.includes('VECCHIA-DOMANDA-40'));
      assert.equal(sopralluogo.numero_dipendenti, 42);
    }
    assert.ok(testoCompleto.includes('Pag. 1 di'), 'numero pagina 1 non trovato');
    assert.ok(testoCompleto.includes(`Pag. ${pagine} di ${pagine}`), 'numero dell\'ultima pagina non trovato');
    assert.ok(testoCompleto.includes(normalizza(cliente.nome)), 'nome/punto vendita cliente non trovato nel PDF');
    assert.ok(testoCompleto.includes('Mario Rossi'), 'primo tecnico non trovato nel PDF');
    assert.ok(testoCompleto.includes('Anna Verdi'), 'secondo tecnico non trovato nel PDF');

    // Nessuna perdita delle risposte: ogni domanda della checklist deve comparire nel testo
    // estratto (prima riga, per gestire gli a-capo interni al testo della domanda).
    domandeFlat.forEach((domanda) => {
      const primaRiga = normalizza(domanda.testo.split('\n')[0]);
      assert.ok(testoCompleto.includes(primaRiga), `domanda id=${domanda.id} persa/non trovata nel PDF: "${primaRiga}"`);
    });

    // Nota molto lunga: inizio E fine (marker esplicito) presenti, a riprova che la nuova
    // impaginazione automatica (disegnaTestoImpaginato) non perde ne' sovrappone testo quando la
    // nota continua su una pagina successiva.
    assert.ok(testoCompleto.includes(normalizza(NOTA_LUNGA).slice(0, 100)), 'inizio della nota lunga non trovato');
    assert.ok(testoCompleto.includes('FINE-NOTA-LUNGA-MARKER'), 'fine della nota lunga non trovata: probabile perdita di testo su un salto pagina');
    assert.ok(testoCompleto.includes('FINE-ALTRI-ASPETTI-MARKER'), 'fine della nota di "Altri aspetti" non trovata');

    // Didascalia molto lunga della foto "Altri aspetti".
    assert.ok(testoCompleto.includes(normalizza(DIDASCALIA_LUNGA).slice(0, 60)), 'didascalia lunga non trovata nel PDF');

    // Foto: almeno 3 fotografie di domande (1 portrait + 2 landscape) + 1 foto "Altri aspetti" +
    // 2 loghi di intestazione (Colligo + cliente) = almeno 6 immagini incorporate.
    const immagini = elencoImmagini(buf);
    assert.ok(immagini.length >= 6, `attese almeno 6 immagini incorporate (2 loghi + 4 foto), trovate ${immagini.length}`);
    const portrait = immagini.filter((img) => img.height > img.width);
    const landscape = immagini.filter((img) => img.width > img.height);
    assert.ok(portrait.length >= 1, 'nessuna immagine portrait trovata (attesa almeno la foto 400x600)');
    assert.ok(landscape.length >= 2, `attese almeno due immagini landscape, trovate ${landscape.length}`);

    // Logo cliente: la checklist deve risolvere alla configurazione cliente attesa in CONFIG_CLIENTI.
    const configCliente = motore._test.risolviConfigCliente(checklist);
    assert.ok(configCliente, `nessuna configurazione cliente risolta per la checklist ${cliente.file}`);
    assert.equal(configCliente, motore._test.configClienti[cliente.chiave]);
  });
}

test('Melluso: usa il nuovo logo completo e il colore rosso corretto', () => {
  const motore = creaMotorePdf(FOTO_FIXTURE);
  const config = motore._test.configClienti.melluso;

  assert.equal(config.logo.file, 'assets/logo_melluso.png');
  assert.equal(config.logo.larghezzaMax, 40);
  assert.equal(config.logo.altezzaMax, 28);
  assert.deepEqual(comeArrayLocale(config.coloreBanner.sfondo), [200, 2, 52]);

  const checklistMelluso = caricaChecklist('melluso_sopralluogo.json');
  assert.equal(motore._test.risolviConfigCliente(checklistMelluso), config);
});

test('numero pagina: disegnato vicino al bordo destro reale della pagina (margine dedicato, non hardcoded)', () => {
  const motore = creaMotorePdf({});
  const eventi = [];
  const docFinto = {
    internal: {
      getNumberOfPages: () => 3,
      getCurrentPageInfo: () => ({ pageNumber: 3 }),
      pageSize: { getWidth: () => 210, getHeight: () => 297 }
    },
    setPage(n) { eventi.push({ tipo: 'setPage', n }); },
    setFontSize() {},
    setFont() {},
    text(testo, x, y, opzioni) { eventi.push({ tipo: 'text', testo, x, y, opzioni }); }
  };
  const layout = motore._test.creaLayout(docFinto);
  motore._test.disegnaNumeriPagina(docFinto, layout);

  const ultimoTesto = eventi.filter((e) => e.tipo === 'text').pop();
  assert.equal(ultimoTesto.testo, 'Pag. 3 di 3');
  assert.equal(ultimoTesto.x, 210 - 7, 'il numero pagina deve stare a 7mm dal bordo fisico destro');
  assert.equal(ultimoTesto.opzioni.align, 'right');
});

test('CONFIG_CLIENTI: colore banner corretto per ciascun cliente', () => {
  const motore = creaMotorePdf({});
  assert.deepEqual(comeArrayLocale(motore._test.configClienti.coin.coloreBanner.sfondo), [43, 43, 43]);
  assert.deepEqual(comeArrayLocale(motore._test.configClienti.interparking.coloreBanner.sfondo), [0, 58, 114]);
  assert.deepEqual(comeArrayLocale(motore._test.configClienti.interparking.coloreBanner.accento), [255, 220, 69]);
  assert.deepEqual(comeArrayLocale(motore._test.configClienti.restage.coloreBanner.sfondo), [28, 66, 36]);
  assert.deepEqual(comeArrayLocale(motore._test.configClienti.melluso.coloreBanner.sfondo), [200, 2, 52]);
});

test('creaLayout: margini e dimensioni derivano SEMPRE dalla pagina reale del documento, mai da costanti fisse', () => {
  const motore = creaMotorePdf({});
  const docFintoNonA4 = { internal: { pageSize: { getWidth: () => 100, getHeight: () => 150 } } };
  const layout = motore._test.creaLayout(docFintoNonA4);
  assert.equal(layout.larghezzaPagina, 100);
  assert.equal(layout.altezzaPagina, 150);
  assert.equal(layout.yFooter, 150 - 8);
});
