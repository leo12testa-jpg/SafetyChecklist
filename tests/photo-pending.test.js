const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function setup(foto, sopralluoghi) {
  const context = {
    console,
    navigator:{onLine:true},
    setTimeout, clearTimeout,
    db:{
      elencaFotoSenzaUrl: async()=>structuredClone(foto),
      elencaTuttiSopralluoghi: async()=>structuredClone(sopralluoghi)
    }
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('js/foto-sync.js','utf8')+';globalThis.api=fotoSync;',context);
  return context.api;
}

test('foto pending: conta solo blob ancora referenziati', async()=>{
  const api=setup(
    [{id:'usata'},{id:'orfana-1'},{id:'orfana-2'}],
    [{id:'s1',risposte:[{domanda_id:1,foto:['usata']}],altri_aspetti_foto:[]}]
  );
  assert.equal(await api.contaFotoInSospeso(),1);
  const pending=await api._test.elencaFotoInSospesoReferenziate();
  assert.deepEqual(Array.from(pending,x=>x.id),['usata']);
});

test('foto pending: include altri aspetti e ignora record eliminati definitivamente', async()=>{
  const api=setup(
    [{id:'allegato'},{id:'eliminata'}],
    [
      {id:'s1',risposte:[],altri_aspetti_foto:['allegato']},
      {id:'s2',eliminato_definitivamente:true,risposte:[{foto:['eliminata']}],altri_aspetti_foto:[]}
    ]
  );
  assert.equal(await api.contaFotoInSospeso(),1);
});
