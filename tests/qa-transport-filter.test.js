const test=require('node:test');
const assert=require('node:assert/strict');
const {EMULATOR,OUTSIDE_BLOCK,NOT_RECOVERED,UNRESOLVED,recordAbort,classifyPageError,resolvePending,unresolved}=require('./qa-transport-filter.cjs');

// Messages exactly as WebKit reported them in the isolated QA (run 40731337703).
const REST='/v1/projects/demo-safety-qa-v1/databases/(default)/documents:';
const msg=(path,host='127.0.0.1:18085')=>`/${host}${path} due to access control checks.`;
const device=(engine='webkit')=>({engine,user:{username:'qa.alpha.test'},aborted:[]});

test('WebKit: batchGet interrotto dal blocco volontario è errore di trasporto registrato',()=>{
  const d=device();recordAbort(d,EMULATOR+REST+'batchGet?alt=json','offline recovery',1000);
  const r=classifyPageError(msg(REST+'batchGet'),d,{step:'offline recovery',action:'reload'},1250);
  assert.equal(r.kind,'transport');
  assert.equal(r.entry.voluntaryBlock,true);assert.equal(r.entry.abortedInStep,'offline recovery');assert.equal(r.entry.msSinceAbort,250);
  assert.equal(r.entry.step,'offline recovery');assert.equal(r.entry.action,'reload');
  assert.equal(d.aborted.length,0,'each abort is consumed once');
});

test('WebKit: commit interrotto dal blocco volontario è errore di trasporto',()=>{
  const d=device();recordAbort(d,EMULATOR+REST+'commit','Firestore interrotto');
  assert.equal(classifyPageError(msg(REST+'commit'),d).kind,'transport');
});

for(const action of ['reload','logout','sync']){
  test(`WebKit: stesso errore senza richiesta interrotta (${action}) fa fallire con motivo esplicito`,()=>{
    const d=device();
    const r=classifyPageError(msg(REST+'batchGet'),d,{step:'cambio ruolo',action});
    assert.equal(r.kind,'page');assert.equal(r.entry.reason,OUTSIDE_BLOCK);assert.equal(r.entry.action,action);
  });
}

test('WebKit: un solo abort non copre due errori',()=>{
  const d=device();recordAbort(d,EMULATOR+REST+'batchGet','offline recovery');
  assert.equal(classifyPageError(msg(REST+'batchGet'),d).kind,'transport');
  const second=classifyPageError(msg(REST+'batchGet'),d);
  assert.equal(second.kind,'page');assert.equal(second.entry.reason,OUTSIDE_BLOCK);
});

test('WebKit: abort di un endpoint diverso non giustifica l errore',()=>{
  const d=device();recordAbort(d,EMULATOR+REST+'commit','offline recovery');
  const r=classifyPageError(msg(REST+'batchGet'),d);
  assert.equal(r.kind,'page');assert.equal(d.aborted.length,1);
});

for(const engine of ['chromium','firefox']){
  test(`${engine}: stesso errore fa fallire anche con richiesta interrotta dal blocco`,()=>{
    const d=device(engine);recordAbort(d,EMULATOR+REST+'batchGet','offline recovery');
    const r=classifyPageError(msg(REST+'batchGet'),d);
    assert.equal(r.kind,'page');assert.equal(r.entry.reason,undefined);
  });
}

test('host o progetto diversi dall emulatore demo fanno fallire',()=>{
  const d=device();recordAbort(d,EMULATOR+REST+'batchGet','offline recovery');
  for(const m of [
    msg(REST+'batchGet','firestore.googleapis.com'),
    msg(REST+'batchGet','127.0.0.1:8080'),
    msg('/v1/projects/safety-checklist-colligo/databases/(default)/documents:batchGet'),
    msg(REST+'runQuery'),
    msg(REST+'batchGet').replace('due to access control checks','failed')
  ])assert.equal(classifyPageError(m,d).kind,'page',m);
  assert.equal(d.aborted.length,1,'no abort consumed by non-matching errors');
});

test('regola esistente: canali streaming Firestore dell emulatore restano errori di trasporto',()=>{
  const d=device();
  const r=classifyPageError('/127.0.0.1:18085/google.firestore.v1.Firestore/Listen/channel?VER=8 due to access control checks.',d,{step:'reload',action:'reload'});
  assert.equal(r.kind,'transport');assert.equal(r.entry.action,'reload');
});

test('errori JavaScript applicativi restano errori di pagina',()=>{
  assert.equal(classifyPageError('TypeError: undefined is not an object',device()).kind,'page');
});

// Policy (b): reload/navigation started by the test, in a step that verifies data recovery.
const testReload={step:'offline, foto e nota',action:'reload',navigating:true,stepVerifiesRecovery:true};

test('WebKit: reload del test in un passo con verifiche di recupero resta in attesa dell esito',()=>{
  const r=classifyPageError(msg(REST+'batchGet'),device(),testReload);
  assert.equal(r.kind,'pending');assert.equal(r.entry.step,testReload.step);
});

test('WebKit: reload del test e dati recuperati nel passo → errore di trasporto registrato',()=>{
  const r=resolvePending(classifyPageError(msg(REST+'commit'),device(),testReload).entry,true);
  assert.equal(r.kind,'transport');assert.equal(r.entry.recoveryVerified,true);assert.equal(r.entry.testNavigation,true);
  assert.equal(r.entry.action,'reload');
});

test('WebKit: reload del test ma dati non recuperati → il test fallisce',()=>{
  const r=resolvePending(classifyPageError(msg(REST+'batchGet'),device(),testReload).entry,false);
  assert.equal(r.kind,'page');assert.equal(r.entry.reason,NOT_RECOVERED);
});

test('WebKit: navigazione del test con dati recuperati è ammessa come il reload',()=>{
  const r=classifyPageError(msg(REST+'batchGet'),device(),{...testReload,action:'navigazione'});
  assert.equal(r.kind,'pending');assert.equal(resolvePending(r.entry,true).kind,'transport');
});

test('WebKit: azione reload ma navigazione già conclusa → fallisce (condizione a)',()=>{
  const r=classifyPageError(msg(REST+'batchGet'),device(),{...testReload,navigating:false});
  assert.equal(r.kind,'page');assert.equal(r.entry.reason,OUTSIDE_BLOCK);
});

for(const action of ['logout','sync','login','ripresa-online']){
  test(`WebKit: ${action} in un passo con verifiche di recupero non è ammesso (condizione a)`,()=>{
    const r=classifyPageError(msg(REST+'batchGet'),device(),{...testReload,action});
    assert.equal(r.kind,'page');assert.equal(r.entry.reason,OUTSIDE_BLOCK);
  });
}

test('WebKit: reload del test in un passo senza verifiche di recupero → fallisce (condizione b)',()=>{
  const r=classifyPageError(msg(REST+'batchGet'),device(),{...testReload,step:'cambio ruolo',stepVerifiesRecovery:false});
  assert.equal(r.kind,'page');assert.equal(r.entry.reason,OUTSIDE_BLOCK);
});

test('Chromium: reload del test con dati recuperati fa comunque fallire',()=>{
  assert.equal(classifyPageError(msg(REST+'batchGet'),device('chromium'),testReload).kind,'page');
});

test('host o progetto diversi durante il reload del test fanno fallire',()=>{
  assert.equal(classifyPageError(msg(REST+'batchGet','firestore.googleapis.com'),device(),testReload).kind,'page');
  assert.equal(classifyPageError(msg('/v1/projects/altro/databases/(default)/documents:commit'),device(),testReload).kind,'page');
});

test('errore in attesa senza esito del passo a fine collaudo → fallisce',()=>{
  const r=unresolved(classifyPageError(msg(REST+'batchGet'),device(),testReload).entry);
  assert.equal(r.kind,'page');assert.equal(r.entry.reason,UNRESOLVED);
});
