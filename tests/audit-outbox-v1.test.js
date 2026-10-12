const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function setup() {
  let queue=[],fail=true;
  const c=vm.createContext({console,crypto:require('node:crypto').webcrypto,navigator:{onLine:true},
    appIdentity:{current:()=>({uid:'qa',username:'qa',nome:'QA',cognome:'Fittizio'}),ready:async()=>null},
    window:{addEventListener(){}},document:{addEventListener(){}},
    firebase:{auth:()=>({currentUser:{uid:'qa'}}),firestore:{FieldValue:{serverTimestamp:()=>0}}},
    firebaseClient:{firestore:()=>({collection:()=>({doc:()=>({set:async()=>{if(fail)throw new Error('temporary outage');}})})})},
    db:{leggiImpostazione:async()=>queue,salvaImpostazione:async(_k,v)=>{queue=v;}}
  });
  vm.runInContext(fs.readFileSync('js/identity.js','utf8')+';globalThis.audit=auditAttivita;',c);
  return {audit:c.audit,queue:()=>queue,recover:()=>{fail=false;}};
}
test('temporary audit write failure persists event then flushes on recovery',async()=>{
  const h=setup();await h.audit.record({sopralluogo_id:'qa-only',tipo:'modifica_nota',domanda_id:1});
  assert.equal(h.queue().length,1);assert.equal(h.queue()[0].domanda_id,1);
  h.recover();await h.audit.flush();assert.equal(h.queue().length,0);
});
