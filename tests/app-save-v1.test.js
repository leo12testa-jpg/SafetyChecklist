const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=(process.env.QA_BASELINE_REF?require('node:child_process').execFileSync('git',['show',process.env.QA_BASELINE_REF+':js/app.js'],{encoding:'utf8'}):fs.readFileSync('js/app.js','utf8')).replace(/\r/g,'');
function extract(name) {const start=source.indexOf(`  async function ${name}(`);assert.ok(start>=0);return source.slice(start,source.indexOf('\n  }\n',start)+5);}
test('queued saves retain original inspection/question and captured notes after navigation',async()=>{
  const saved=[];let release;const gate=new Promise(r=>release=r);
  const c=vm.createContext({ultimoSalvataggio:Promise.resolve(true),salvataggiPendenti:0,
    notaTesto:{value:'prima nota'},fotoDomandaCorrente:['photo-first'],
    record:'qa-first',question:1,
    db:{salvaRisposta:async(id,response)=>{await gate;saved.push({id,...response});}},
    renderIndicatori(){},nascondiErrore(){},mostraErrore(){throw new Error('unexpected save error');}
  });
  c.checklistEngine={domandaCorrente:()=>({domanda:{id:c.question},sezione:'QA',totale:10,indice:0}),sopralluogoCorrente:()=>({id:c.record}),ricaricaSopralluogoCorrente:async()=>{},rispondi:async({valore,note,foto})=>c.db.salvaRisposta(c.record,{domanda_id:c.question,risposta:valore,note,foto})};
  vm.runInContext(extract('salvaRispostaCorrente')+';globalThis.save=salvaRispostaCorrente;',c);
  const first=c.save('PC');c.notaTesto.value='seconda nota';const second=c.save('NC');
  c.record='qa-other';c.question=99;c.notaTesto.value='unrelated note';c.fotoDomandaCorrente=[];release();
  await Promise.all([first,second]);assert.deepEqual(saved.map(r=>[r.id,r.domanda_id,r.note,r.risposta]),[['qa-first',1,'prima nota','PC'],['qa-first',1,'seconda nota','NC']]);
  assert.equal(c.salvataggiPendenti,0);
});
test('realtime notification during pending save does not overwrite the active controls',async()=>{
  let reads=0;const c=vm.createContext({screen:{hidden:false},salvataggiPendenti:1,navigazioneInCorso:false,
    checklistEngine:{ricaricaSopralluogoCorrente:async()=>{reads++;},domandaCorrente:()=>null},
  });
  vm.runInContext(extract('alRicevimentoDatiSync')+';globalThis.receive=alRicevimentoDatiSync;',c);
  await c.receive();assert.equal(reads,0);
});
test('history refresh preserves a date changed while IndexedDB is being read',async()=>{
  const start=source.indexOf('  async function render({ reset = true }');const render=source.slice(start,source.indexOf('\n  }\n',start)+5);
  let release;const reading=new Promise(r=>release=r);
  const c=vm.createContext({revisioneRender:0,db:{elencaSopralluoghi:async()=>{await reading;return[];}},
    clienteAttivo:'Coin',checklistAttiva:'coin_sopralluogo',statoChiusuraAttivo:'',tecnicoAttivo:'',dataDaAttiva:'2020-01-01',dataAAttiva:'',ordinamentoAttivo:'data-desc',testoRicerca:'',
    sopralluoghiCache:[],selezionati:new Set(),popolaFiltroTecnico(){},popolaFiltroCliente:async()=>{},popolaFiltroChecklist:async()=>{},applicaFiltri(){},aggiornaContatoreCestino:async()=>{},
    filtroClienteContainer:{},filtroChecklistContainer:{options:[{value:'coin_sopralluogo'}]},filtroTecnicoContainer:{options:[{value:''}]},filtroStatoChiusuraContainer:{},inputDataDa:{},inputDataA:{},filtroOrdinamento:{},inputRicerca:{}
  });
  vm.runInContext(render+';globalThis.renderHistory=render;',c);const pending=c.renderHistory({reset:false});c.dataDaAttiva='2030-01-01';release();await pending;
  assert.equal(c.inputDataDa.value,'2030-01-01');assert.equal(c.dataDaAttiva,'2030-01-01');
});
