const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function modules() {
  const c = vm.createContext({ console });
  for (const file of ['pdf-import', 'import-matching']) vm.runInContext(fs.readFileSync(`js/${file}.js`, 'utf8'), c);
  return vm.runInContext('({ parser: pdfImport._test, matching: importMatching })', c);
}
const item = (testo, x, y) => ({ testo, x, y, w: testo.length * 4 });
function page(rows, section = 'SICUREZZA') {
  const p = [item(section,20,215), item('n.',20,200), item('Descrizione attività',40,200),
    item('C',300,200),item('P.C',315,200),item('N.C',330,200),item('N.P',345,200),item('Note',400,200)];
  p.bordi = [210,190].map(y => ({ x1:15,x2:500,y }));
  let top = 190;
  for (const r of rows) {
    const bottom = top - (r.height || 60);
    if (r.id != null) p.push(item(String(r.id),20,(top+bottom)/2),item('X',330,(top+bottom)/2));
    (r.text || []).forEach((t,i) => p.push(item(t,40,top-12-i*9)));
    (r.note || []).forEach((t,i) => p.push(item(t,400,top-12-i*9)));
    p.bordi.push({x1:15,x2:500,y:bottom}); top=bottom;
  }
  return p;
}
function parse(pages) { return modules().parser.provaFormatoNostro(pages).righe; }
for (const [name, first, second] of [
  ['nota semplice', ['Nota N'], []],
  ['nota multilinea', ['Nota N prima','Nota N seconda','Nota N terza'], []],
  ['due domande consecutive entrambe con note', ['Nota N'], ['Nota N+1']],
  ['prima con nota seconda senza', ['Solo N'], []],
  ['prima senza seconda con nota', [], ['Solo N+1']],
  ['nessuna nota', [], []]
]) test(`${name}: nessuna nota sulla domanda precedente o successiva`, () => {
  const rows=parse([page([{id:17,text:['Estintori'],note:first},{id:18,text:['Uscite'],note:second}])]);
  assert.equal(rows[0].nota_originale,first.join(' ') || null);
  assert.equal(rows[1].nota_originale,second.join(' ') || null);
});
test('regressione: nota della domanda N importata erroneamente sulla domanda N+1', () => {
  const note=Array.from({length:25},(_,i)=>`Riga nota ${i}`);
  const rows=parse([page([{id:17,text:['Domanda N'],note,height:260},{id:18,text:['Domanda N+1'],note:['Solo N+1']}])]);
  assert.equal(rows[0].nota_originale,note.join(' '));
  assert.equal(rows[1].nota_originale,'Solo N+1');
});
test('nota dopo domanda con testo multilinea resta nella stessa cella', () => {
  const rows=parse([page([{id:17,text:['Domanda prima riga','continua testo','ultima riga'],note:['Nota corretta']},{id:18,text:['Successiva']}])]);
  assert.equal(rows[0].testo_originale,'Domanda prima riga continua testo ultima riga');
  assert.equal(rows[0].nota_originale,'Nota corretta'); assert.equal(rows[1].nota_originale,null);
});
test('nota prima del cambio pagina e continuazione senza numero sulla nuova pagina', () => {
  const rows=parse([page([{id:17,text:['Estintori'],note:['Inizio nota']}]),page([{note:['Continua nota']},{id:18,text:['Uscite'],note:['Nota 18']}])]);
  assert.equal(rows.length,2); assert.equal(rows[0].nota_originale,'Inizio nota Continua nota');
  assert.equal(rows[1].nota_originale,'Nota 18');
});
test('Interparking: id sovrapposti nella stessa cella producono una sola riga logica e seguono la sequenza', () => {
  const p=page([{id:15,text:['Piano emergenza'],note:['Nota 15']},{id:16,text:['Registro antincendio'],note:['Nota 16']},{id:17,text:['Porte'],note:['Nota 17']}]);
  // Sulla seconda e terza riga simuliamo un secondo livello testo con gli id stabili 18 e 19.
  const y16=100, y17=40;
  p.push(item('18',20.4,y16+1.2), item('19',20.4,y17+1.2));
  const rows=parse([p]);
  assert.deepEqual(Array.from(rows, r => r.numero_originale), [15,16,17]);
  assert.deepEqual(Array.from(rows, r => r.nota_originale), ['Nota 15','Nota 16','Nota 17']);
  assert.deepEqual(Array.from(rows, r => r.stato_originale), ['NC','NC','NC']);
});

test('Interparking: numero a due cifre spezzato non genera righe fantasma', () => {
  const p=page([{id:51,text:['Domanda cinquantuno'],note:['Nota 51']}]);
  const originale=p.findIndex(x => x.testo==='51' && x.x===20);
  const y=p[originale].y;
  p.splice(originale,1,item('5',20,y),item('1',24,y));
  const rows=parse([p]);
  assert.equal(rows.length,1);
  assert.equal(rows[0].numero_originale,51);
  assert.equal(rows[0].testo_originale,'Domanda cinquantuno');
  assert.equal(rows[0].nota_originale,'Nota 51');
});

test('nota molto lunga continua su una pagina senza nuove domande', () => {
  const rows=parse([page([{id:17,text:['Estintori'],note:['Inizio']}]),page([{note:['Segue']}]),page([{note:['Fine']},{id:18,text:['Uscite']}])]);
  assert.equal(rows[0].nota_originale,'Inizio Segue Fine'); assert.equal(rows[1].nota_originale,null);
});

test('banner gruppo ripetuto sulla continuazione non interrompe la nota multipagina', () => {
  const pages=[page([{id:17,text:['Estintori'],note:['INIZIO']}]),page([{note:['CONTINUA']},{id:18,text:['Uscite'],note:['SOLO 18']}])];
  for(const p of pages){p.push(item('ANALISI DOCUMENTALE',20,250));p.bordi.push({x1:15,x2:500,y:260},{x1:15,x2:500,y:240});}
  const rows=parse(pages);
  assert.equal(rows.length,2);assert.equal(rows[0].nota_originale,'INIZIO CONTINUA');assert.equal(rows[1].nota_originale,'SOLO 18');
});
test('cambio sezione non sposta la nota nella sezione successiva', () => {
  const rows=parse([page([{id:17,text:['Estintori'],note:['Nota 17']}]),page([{id:18,text:['Uscite'],note:['Nota 18']}],'ALTRA SEZIONE')]);
  assert.equal(rows[0].nota_originale,'Nota 17'); assert.equal(rows[1].nota_originale,'Nota 18');
  assert.equal(rows[1].sezione_originale,'ALTRA SEZIONE');
});
const checklist={sezioni:[{titolo:'Nuova sezione',domande:[{id:31,testo:'Gli estintori sono segnalati correttamente?'},{id:32,testo:'Le uscite sono libere?'}]}]};
function source(text=checklist.sezioni[0].domande[0].testo) {
  return {formato:'storico',numero_originale:27,id_originale:null,sezione_originale:'Vecchia',testo_originale:text,stato_originale:'NC',nota_originale:'Estintore non segnalato. Vedi Foto 1, Foto 2'};
}
test('domanda spostata e rinumerata: stato nota e più foto seguono la stessa riga NC', () => {
  const {matching:m}=modules(); const original=source(); const {righe}=m.abbinaRighe([original],checklist);
  const photos=m.collegaImmaginiAlleDomande([{didascalia:'Foto 1'},{didascalia:'Foto 2'}],righe,checklist);
  assert.equal(righe[0].domanda_id,31); assert.equal(righe[0].note,original.nota_originale);
  assert.equal(righe[0].risposta,'NC'); assert.ok(photos.every(p=>p.domanda_id_collegata===31 && p.riga_sorgente_indice===0));
  assert.equal(JSON.stringify(righe[0].originale),JSON.stringify({numero_originale:27,sezione_originale:'Vecchia',testo_originale:original.testo_originale,stato_originale:'NC',nota_originale:original.nota_originale,id_originale:null}));
});
test('cambio manuale in anteprima: stato nota e foto si spostano insieme', () => {
  const {matching:m}=modules(); const {righe}=m.abbinaRighe([source()],checklist);
  const photos=m.collegaImmaginiAlleDomande([{didascalia:'Foto 1'},{didascalia:'Foto 2'}],righe,checklist);
  m.cambiaDomandaRiga(righe[0],32,photos); m.applicaVincoloUnoAUno(righe);
  assert.equal(righe[0].risposta,'NC'); assert.equal(righe[0].note,source().nota_originale);
  assert.ok(photos.every(p=>p.domanda_id_collegata===32)); assert.equal(m.rigaImportabile(righe[0]),true);
  m.cambiaDomandaRiga(righe[0],null,photos); assert.ok(photos.every(p=>p.domanda_id_collegata===null));
});
test('matching fuzzy: nota originale in verifica, nessuna assegnazione cieca', () => {
  const {matching:m}=modules(); const {righe}=m.abbinaRighe([source('Estintori segnalati?')],checklist);
  assert.equal(righe[0].automatico,false); assert.equal(m.rigaImportabile(righe[0]),false);
  assert.equal(righe[0].note,source().nota_originale);
  const photos=m.collegaImmaginiAlleDomande([{didascalia:'Foto 1'},{didascalia:'Foto 2'}],righe,checklist);
  assert.ok(photos.every(p => p.domanda_id_collegata === null && p.riga_sorgente_indice === 0));
  m.cambiaDomandaRiga(righe[0],32,photos);
  assert.ok(photos.every(p => p.domanda_id_collegata === 32));
});
test('due testi simili e domanda eliminata: note restano sorgenti senza importazione automatica', () => {
  const {matching:m}=modules();
  const target={sezioni:[{titolo:'S',domande:[{id:31,testo:source().testo_originale},{id:32,testo:source().testo_originale}]}]};
  for(const row of [source(),source('Domanda eliminata sui sistemi di ventilazione')]) {
    const {righe}=m.abbinaRighe([row],target);
    assert.equal(m.rigaImportabile(righe[0]),false); assert.equal(righe[0].note,row.nota_originale);
  }
});
