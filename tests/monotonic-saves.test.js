const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=(process.env.QA_BASELINE_REF?require('node:child_process').execFileSync('git',['-c','safe.directory='+process.cwd(),'show',process.env.QA_BASELINE_REF+':js/db.js'],{encoding:'utf8'}):fs.readFileSync('js/db.js','utf8')).replace(/\r/g,'');
function extract(name){const start=source.search(new RegExp('  (?:async )?function '+name+'\\('));return start<0?'':source.slice(start,source.indexOf('\n  }\n',start)+5);}
test('close followed by reopen at the same browser clock retains the last operator action',async()=>{
  let record={id:'qa',stato_chiusura:'aperto',risposte:[],aggiornato_il:'2026-10-12T10:00:00.000Z'};
  const snapshots=[];
  class FrozenDate extends Date{constructor(...args){super(...(args.length?args:['2026-10-12T10:00:00.000Z']));}static now(){return Date.parse('2026-10-12T10:00:00.000Z');}}
  const c=vm.createContext({Date:FrozenDate,generaId:()=>String(snapshots.length),normalizzaRisposte:r=>r||[],
    transazioneConHandle:async()=>({tx:{},store:{get:()=>structuredClone(record),put:r=>{record=structuredClone(r);}}}),
    richiesta:async r=>r,transazioneCompletata:async()=>{},notificaCambiamento:()=>snapshots.push(structuredClone(record)),registraAudit(){},
  });
  vm.runInContext(['stabilizzaTempi','prossimoTimestamp','marcaModifica','aggiornaSopralluogo'].map(extract).join('\n')+';globalThis.update=aggiornaSopralluogo;',c);
  await c.update('qa',{stato_chiusura:'chiuso'});await c.update('qa',{stato_chiusura:'aperto'});
  const s=vm.createContext({console,navigator:{onLine:false},setTimeout,clearTimeout});
  vm.runInContext(fs.readFileSync('js/sync.js','utf8')+';globalThis.merge=sync._test.unisciDocumenti;',s);
  assert.equal(s.merge(snapshots[1],snapshots[0]).stato_chiusura,'aperto','a stale closed snapshot must not undo the subsequent reopen');
  assert.ok(Date.parse(snapshots[1].campi_aggiornati.stato_chiusura)>Date.parse(snapshots[0].campi_aggiornati.stato_chiusura));
});
