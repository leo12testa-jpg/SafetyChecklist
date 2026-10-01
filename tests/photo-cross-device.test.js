const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function caricaFotoSync({ fotoLocale = null, blobRemoto = new Blob(['foto-remota']) } = {}) {
  const download = [];
  const db = {
    leggiFoto: async () => fotoLocale,
    salvaFotoRemota: async foto => { fotoLocale = foto; return foto; },
    elencaFotoSenzaUrl: async () => [],
    impostaUrlFoto: async () => {},
    impostaUrlFotoSopralluogo: async () => {}
  };
  const storage = {
    download: async (percorso) => {
      download.push(percorso);
      return { data: blobRemoto, error: null };
    },
    upload: async () => ({ error: null }),
    getPublicUrl: () => ({ data: { publicUrl: 'https://example.test/foto' } }),
    remove: async () => ({ error: null })
  };
  const context = {
    console,
    Blob,
    navigator: { onLine: true },
    window: { addEventListener() {} },
    db,
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_ANON_KEY: 'anon',
    SUPABASE_BUCKET: 'foto-sopralluoghi',
    supabase: { createClient: () => ({ storage: { from: () => storage } }) }
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/foto-sync.js'), 'utf8'), context);
  return { fotoSync: vm.runInContext('fotoSync', context), download, blobRemoto };
}

test('foto cross-device: se manca in IndexedDB viene scaricata dal path Supabase sincronizzato', async () => {
  const { fotoSync, download, blobRemoto } = caricaFotoSync();
  const sopralluogo = {
    id: 'sop-1',
    foto_url: { 'foto-123': { path: 'sop-1/17_123_foto-123.jpg' } }
  };
  const foto = await fotoSync.risolviFoto('foto-123', sopralluogo);
  assert.equal(foto.id, 'foto-123');
  assert.equal(foto.sopralluogo_id, 'sop-1');
  assert.equal(foto.blob, blobRemoto);
  assert.deepEqual(download, ['sop-1/17_123_foto-123.jpg']);
});

test('foto cross-device: il blob locale viene preferito senza download remoto', async () => {
  const locale = { id: 'foto-123', blob: new Blob(['locale']) };
  const { fotoSync, download } = caricaFotoSync({ fotoLocale: locale });
  const foto = await fotoSync.risolviFoto('foto-123', {
    id: 'sop-1',
    foto_url: { 'foto-123': { path: 'remoto.jpg' } }
  });
  assert.equal(foto, locale);
  assert.deepEqual(download, []);
});

test('import PDF: ogni immagine importata avvia upload Supabase con la domanda collegata', () => {
  const source = fs.readFileSync(path.join(__dirname, '../js/app.js'), 'utf8');
  assert.match(source, /caricamentiFotoImportate\.push\([\s\S]*fotoSync\.caricaFoto\(\{ fotoId: id, sopralluogo_id: sopralluogo\.id, domanda_id: domandaFoto, blob: foto\.blob \}\)/);
  assert.match(source, /const domandaFoto = voceDomanda \? domandaId : null/);
  assert.match(source, /await Promise\.all\(caricamentiFotoImportate\)/);
});

test('UI foto comune: Compilazione e Altri aspetti mostrano miniature risolte anche da remoto', () => {
  const source = fs.readFileSync(path.join(__dirname, '../js/app.js'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '../css/style.css'), 'utf8');
  assert.match(source, /function aggiungiMiniaturaFoto\(/);
  assert.match(source, /fotoSync\.risolviFoto\(fotoId, sopralluogo\)/);
  const occorrenze = (source.match(/aggiungiMiniaturaFoto\(voce, fotoId, checklistEngine\.sopralluogoCorrente\(\)\)/g) || []).length;
  assert.equal(occorrenze, 2, 'miniatura richiesta sia per foto domanda sia per Altri aspetti');
  assert.match(css, /\.foto-miniatura\s*\{/);
});


test('PDF cross-device: prima di aprire sincronizza e non riusa alla cieca un PDF locale senza firma foto', () => {
  const source = fs.readFileSync(path.join(__dirname, '../js/app.js'), 'utf8');
  assert.match(source, /async function preparaDatiPdfCrossDevice\(\)/);
  assert.match(source, /await sync\.sincronizzaTutto\(\)/);
  assert.match(source, /function firmaFotoSopralluogo\(sopralluogo\)/);
  assert.match(source, /return salvato\.firma_foto === firmaAttuale/);
  assert.match(source, /await preparaDatiPdfCrossDevice\(\);[\s\S]*db\.leggiPdfReport\(sopralluogoId\)[\s\S]*db\.leggiSopralluogo\(sopralluogoId\)/);
});

test('PDF cross-device: un PDF rigenerato sul telefono viene salvato con la firma delle foto correnti', () => {
  const source = fs.readFileSync(path.join(__dirname, '../js/app.js'), 'utf8');
  assert.match(source, /await db\.salvaPdfReport\(\{[\s\S]*firma_foto: firmaFotoSopralluogo\(sopralluogo\)[\s\S]*\}\)/);
  const dbSource = fs.readFileSync(path.join(__dirname, '../js/db.js'), 'utf8');
  assert.match(dbSource, /async function salvaPdfReport\(\{ sopralluogo_id, blob, filename, firma_foto = '', foto_incomplete = false, versione_layout = '' \}\)/);
  assert.match(source, /versione_layout: pdf\.versioneLayout/);
});

test('nuove foto: online si attende il tentativo di upload remoto prima di proseguire', () => {
  const source = fs.readFileSync(path.join(__dirname, '../js/camera.js'), 'utf8');
  assert.match(source, /await fotoSync\.caricaFoto\(\{ fotoId, sopralluogo_id, domanda_id, blob \}\)/);
});


test('foto UX: annullare il selettore non genera errore e la miniatura apre anteprima grande', () => {
  const cameraSource = fs.readFileSync(path.join(__dirname, '../js/camera.js'), 'utf8');
  const appSource = fs.readFileSync(path.join(__dirname, '../js/app.js'), 'utf8');
  const cssSource = fs.readFileSync(path.join(__dirname, '../css/style.css'), 'utf8');
  assert.match(cameraSource, /resolve\(file \|\| null\)/);
  assert.match(cameraSource, /if \(!file\) return null/);
  assert.match(appSource, /function apriAnteprimaFoto\(src\)/);
  assert.match(appSource, /img\.addEventListener\('click', \(\) => apriAnteprimaFoto\(img\.src\)\)/);
  assert.match(cssSource, /\.foto-lightbox\s*\{/);
  assert.match(cssSource, /\.foto-stato-upload\.is-locale/);
});


test('foto pending: gli upload vengono ritentati automaticamente in parallelo limitato', async () => {
  let active = 0;
  let maxActive = 0;
  const pending = Array.from({ length: 6 }, (_, i) => ({
    id: 'p-' + i, sopralluogo_id: 's-1', domanda_id: i + 1, blob: new Blob(['foto-' + i])
  }));
  const db = {
    leggiFoto: async () => null,
    salvaFotoRemota: async foto => foto,
    elencaFotoSenzaUrl: async () => pending,
    impostaUrlFoto: async () => {},
    impostaUrlFotoSopralluogo: async () => {},
    elencaTuttiSopralluoghi: async () => []
  };
  const storage = {
    upload: async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise(resolve => setTimeout(resolve, 15));
      active -= 1;
      return { error: null };
    },
    getPublicUrl: () => ({ data: { publicUrl: 'https://example.test/foto' } }),
    download: async () => ({ data: new Blob(['x']), error: null }),
    remove: async () => ({ error: null })
  };
  const context = {
    console, Blob, AbortController, setTimeout, clearTimeout,
    navigator:{onLine:true}, window:{addEventListener(){}}, db,
    SUPABASE_URL:'https://example.supabase.co', SUPABASE_ANON_KEY:'anon', SUPABASE_BUCKET:'foto-sopralluoghi',
    supabase:{createClient:()=>({storage:{from:()=>storage}})}
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/foto-sync.js'),'utf8'), context);
  const api = vm.runInContext('fotoSync', context);
  await api.riprovaInSospeso();
  assert.ok(maxActive >= 2, 'gli upload non devono restare strettamente seriali');
  assert.ok(maxActive <= 3, 'la concorrenza resta limitata');
});

test('foto pending: il DB considera solo foto ancora referenziate e ignora gli orfani', () => {
  const context = { console, crypto:{randomUUID:()=> 'x'} };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/db.js'),'utf8'), context);
  const api = vm.runInContext('db', context);
  const ids = api._idFotoReferenziati([
    { risposte:[{domanda_id:1,foto:['keep-1']}], altri_aspetti_foto:['keep-2'] },
    { eliminato_definitivamente:true, risposte:[{domanda_id:2,foto:['orphan']}], altri_aspetti_foto:[] }
  ]);
  assert.deepEqual(Array.from(ids).sort(), ['keep-1','keep-2']);
});

test('sync indicator has no manual retry click behavior', () => {
  const source = fs.readFileSync(path.join(__dirname, '../js/app.js'),'utf8');
  assert.doesNotMatch(source, /Clicca per ritentare la sincronizzazione/);
  assert.doesNotMatch(source, /contenitore\.addEventListener\('click', ritenta\)/);
});
