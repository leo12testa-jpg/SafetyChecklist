const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function source(file){return(process.env.QA_BASELINE_REF?require('node:child_process').execFileSync('git',['show',process.env.QA_BASELINE_REF+':'+file],{encoding:'utf8'}):fs.readFileSync(file,'utf8')).replace(/\r/g,'');}
test('camera chooser cancel resolves without blocking the Photo button',async()=>{
  const c=vm.createContext({document:{createElement:()=>{
    const events={};return{addEventListener:(name,fn)=>{events[name]=fn;},click:()=>{queueMicrotask(()=>events.cancel?.());}};
  }}});vm.runInContext(source('js/camera.js')+';globalThis.capture=camera.scattaFoto;',c);
  const result=await Promise.race([c.capture({sopralluogo_id:'qa'}),new Promise(r=>setTimeout(()=>r('timeout'),100))]);assert.equal(result,null);
});
test('photo upload finishing after navigation stays on the original question',async()=>{
  let finish;const gate=new Promise(r=>finish=r),writes=[];
  const c=vm.createContext({q:1,btnFoto:{},fotoDomandaCorrente:[],isStileRaccoltaDati:()=>false,
    camera:{scattaFoto:async()=>{await gate;return'qa-photo';}},mostraErrore:e=>{throw new Error(e);},aggiornaContatoreFoto(){},
    db:{leggiSopralluogo:async()=>({id:'qa',risposte:[{domanda_id:1,risposta:'NC',note:'ORIGINALE',foto:[]}]}),salvaRisposta:async(id,r)=>{writes.push({id,...r});}},
  });
  c.checklistEngine={domandaCorrente:()=>({domanda:{id:c.q},sezione:'QA',risposta:{risposta:'NC',foto:[],note:'ORIGINALE'}}),sopralluogoCorrente:()=>({id:'qa'}),ricaricaSopralluogoCorrente:async()=>{}};
  c.salvaRispostaCorrente=async value=>writes.push({id:'qa',domanda_id:c.q,risposta:value,foto:c.fotoDomandaCorrente});
  const app=source('js/app.js'),start=app.indexOf('  async function onFoto(');vm.runInContext(app.slice(start,app.indexOf('\n  }\n',start)+5)+';globalThis.onPhoto=onFoto;',c);
  const pending=c.onPhoto();c.q=2;c.fotoDomandaCorrente=['photo-other-question'];finish();await pending;
  assert.equal(writes.length,1);assert.equal(writes[0].domanda_id,1);assert.deepEqual(Array.from(writes[0].foto),['qa-photo']);assert.deepEqual(c.fotoDomandaCorrente,['photo-other-question']);
});
