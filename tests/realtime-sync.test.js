const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function setup(initial = []) {
  const local = new Map(initial.map(r => [r.id, structuredClone(r)]));
  const remote = new Map();
  const listeners = [];
  let writes = 0, gets = 0, hook, fail = false;
  const copy = r => r && structuredClone(r);
  const doc = id => ({id, exists:remote.has(id), data:()=>copy(remote.get(id))});
  let pendingMeta = false;
  const snapshot = () => ({metadata:{fromCache:false,hasPendingWrites:pendingMeta},forEach:fn=>[...remote.keys()].forEach(id=>fn(doc(id))),docChanges:()=>[...remote.keys()].map(id=>({type:'added',doc:doc(id)}))});
  const fdb = {
    collection:()=>({doc:id=>({id}),get:async()=>{gets++;if(fail)throw Error('cloud down');return snapshot();},onSnapshot:(_,fn)=>{listeners.push(fn);fn(snapshot());return ()=>{};}}),
    runTransaction:async fn=>{
      if(fail)throw Error('cloud down');
      return fn({get:async ref=>doc(ref.id),set:(ref,patch,options)=>{
        const invalid=v=>v===undefined||(Array.isArray(v)?v.some(x=>Array.isArray(x)||invalid(x)):v&&typeof v==='object'&&!(v instanceof Date)&&Object.values(v).some(invalid));
        if(invalid(patch))throw Error('Function Transaction.set() called with invalid data. Unsupported field value: undefined');
        writes++;
        const record=copy(remote.get(ref.id))||{};
        for(const field of options.mergeFields) {
          const keys=field.keys;
          if(keys.length===1)record[keys[0]]=copy(patch[keys[0]]);
          else (record[keys[0]]||={})[keys[1]]=copy(patch[keys[0]][keys[1]]);
        }
        remote.set(ref.id,record);
        queueMicrotask(()=>listeners.forEach(fn=>fn(snapshot())));
      }});
    }
  };
  const firestore=()=>fdb;
  firestore.FieldPath=class {constructor(...keys){this.keys=keys;}};
  const context={console:{warn(){},error(){}},navigator:{onLine:true},window:{addEventListener(){}},document:{visibilityState:'visible',addEventListener(){}},
    setTimeout:(fn,ms)=>{const t=setTimeout(fn,ms);t.unref();return t;},clearTimeout,
    firebase:{apps:[{}],firestore},firebaseConfig:{},
    db:{onCambiamento:fn=>hook=fn,elencaTuttiSopralluoghi:async()=>[...local.values()].map(copy),
      leggiSopralluogo:async id=>copy(local.get(id)),elencaFotoSenzaUrl:async()=>[],
      unisciSopralluogoRemoto:async(r,merge)=>{
        const prev=local.get(r.id), next=merge(copy(prev),copy(r));delete next._sync_rev;
        if(prev?._sync_rev)next._sync_rev=prev._sync_rev;
        local.set(r.id,next);return {record:copy(next),cambiato:JSON.stringify(prev)!==JSON.stringify(next)};
      },confermaSincronizzato:async(id,rev)=>{const r=local.get(id);if(r._sync_rev===rev)delete r._sync_rev;}}
  };
  vm.createContext(context);vm.runInContext(fs.readFileSync('js/sync.js','utf8')+';globalThis.api=sync;',context);
  return {api:context.api,local,remote,context,emit:()=>listeners.forEach(fn=>fn(snapshot())),setPendingMeta:v=>pendingMeta=v,counts:()=>({writes,gets}),setFail:v=>fail=v,edit:r=>{local.set(r.id,r);hook({sopralluogo:r});}};
}
const legacy={id:'MISDO',punto_vendita:'San Donato',checklist_id:'interparking_sopralluogo',aggiornato_il:'2025-01-01T00:00:00.000Z',risposte:[{domanda_id:12,risposta:'C',note:'solo locale'}]};
test('legacy local-only MISDO is uploaded, never removed; duplicate snapshots do not echo writes',async()=>{
  const s=setup([legacy]);await s.api.init();
  assert.equal(s.remote.get('MISDO').risposte['12'].note,'solo locale');
  assert.ok(s.local.has('MISDO'));
  const before=s.counts().writes;
  s.emit();s.emit();await new Promise(r=>setImmediate(r));
  assert.equal(s.counts().writes,before);
});
test('single-flight full sync returns the exact same promise and makes one server read',async()=>{
  const s=setup();const a=s.api.sincronizzaTutto(),b=s.api.sincronizzaTutto();
  assert.equal(a,b);await a;assert.equal(s.counts().gets,1);
});
test('server missing document and deleted/trash local legacy both remain recoverable',async()=>{
  const s=setup([{...legacy,eliminato_il:'2025-01-02T00:00:00Z'}]);await s.api.init();
  assert.equal(s.remote.get('MISDO').eliminato_il,'2025-01-02T00:00:00Z');
  s.remote.clear();await s.api.sincronizzaTutto();assert.ok(s.remote.has('MISDO'));assert.ok(s.local.has('MISDO'));
});
test('cloud failure retains local edits and cannot report synchronized',async()=>{
  const s=setup([legacy]);s.setFail(true);assert.equal(await s.api.init(),false);
  assert.equal(s.local.get('MISDO').risposte[0].note,'solo locale');assert.notEqual(s.api.statoAttuale(),'sincronizzato');
  s.setFail(false);assert.equal(await s.api.sincronizzaCompleto(),true);assert.ok(s.remote.has('MISDO'));
});
test('three devices different questions converge without whole-map overwrite',()=>{
  const {unisciDocumenti:merge}=setup().api._test;
  const a={...legacy,risposte:[{domanda_id:1,note:'A',aggiornato_il:'2026-01-01'}]};
  const b={...legacy,risposte:[{domanda_id:2,note:'B',aggiornato_il:'2026-01-02'}]};
  const c={...legacy,risposte:[{domanda_id:3,note:'C',aggiornato_il:'2026-01-03'}]};
  const merged=merge(merge(a,b),c);
  assert.deepEqual(Array.from(merged.risposte,r=>r.note).sort(),['A','B','C']);
});
test('newer answer timestamp does not overwrite unrelated newer metadata',()=>{
  const {unisciDocumenti:merge}=setup().api._test;
  const a={...legacy,aggiornato_il:'2026-01-03',punto_vendita:'Old',campi_aggiornati:{punto_vendita:'2025-01-01'}};
  const b={...legacy,aggiornato_il:'2026-01-02',punto_vendita:'New',campi_aggiornati:{punto_vendita:'2026-01-02'}};
  assert.equal(merge(a,b).punto_vendita,'New');
});
test('equal-timestamp conflicts converge independently of merge direction',()=>{
  const {unisciDocumenti:merge,stabile}=setup().api._test;
  const a={...legacy,risposte:[{domanda_id:1,note:'A'}]},b={...legacy,risposte:[{domanda_id:1,note:'B'}]};
  assert.equal(stabile(merge(a,b)),stabile(merge(b,a)));
});

test('new edit arriving during cloud acknowledgement remains queued until acknowledged',async()=>{
  const s=setup([legacy]);await s.api.init();
  s.context.navigator.onLine=false;
  s.edit({...s.local.get('MISDO'),_sync_rev:'pending',risposte:[{domanda_id:12,note:'offline',aggiornato_il:'2026-09-24'}]});
  assert.notEqual(s.api.statoAttuale(),'sincronizzato');
  s.context.navigator.onLine=true;
  await s.api.sincronizzaCompleto();
  assert.equal(s.remote.get('MISDO').risposte['12'].note,'offline');
  assert.equal(s.local.get('MISDO')._sync_rev,undefined);
});

test('restore from trash propagates explicit null rather than absent deleted field',()=>{
  const {unisciDocumenti:merge}=setup().api._test;
  const trash={...legacy,eliminato_il:'2026-01-01',aggiornato_il:'2026-01-01'};
  const restored={...trash,eliminato_il:null,aggiornato_il:'2026-02-01',campi_aggiornati:{eliminato_il:'2026-02-01'}};
  assert.equal(merge(trash,restored).eliminato_il,null);
  assert.equal(merge(restored,trash).eliminato_il,null);
});

test('build equality keeps update banner hidden; a genuinely newer server build reveals it',async()=>{
  const source=fs.readFileSync('js/aggiornamento.js','utf8');
  const current=source.match(/const BUILD_ID = '([^']+)'/)[1];
  let server=current;
  const banner={hidden:true}, handlers={};
  const context={console,document:{getElementById:id=>id==='banner-aggiornamento'?banner:null,addEventListener(){},querySelector:()=>null},
    navigator:{serviceWorker:{addEventListener:(event,fn)=>handlers[event]=fn}},window:{addEventListener(){}},
    fetch:async()=>({ok:true,json:async()=>({buildId:server})})};
  vm.createContext(context);vm.runInContext(source+';aggiornamentoApp.init();',context);
  await handlers.controllerchange();assert.equal(banner.hidden,true);
  server='next';await handlers.controllerchange();assert.equal(banner.hidden,false);
  server=current;await handlers.controllerchange();assert.equal(banner.hidden,true);
  assert.match(fs.readFileSync('css/style.css','utf8'),/\.banner-aggiornamento\[hidden\]\s*\{\s*display: none/);
});


// --- Regressione caso reale MISDO (Interparking San Donato, Edge, record mai arrivato su Firestore) ---
test('MISDO legacy record with undefined fields (rejected by Firestore) is still uploaded and kept locally',async()=>{
  const misdo={...legacy,id:'MISDO-undef',indirizzo_punto_vendita:undefined,numero_dipendenti:undefined,
    risposte:[{domanda_id:3,risposta:'NC',note:undefined,foto:[]},{domanda_id:12,risposta:'C',note:'solo locale'}]};
  const s=setup([misdo]);await s.api.init();
  const remoto=s.remote.get('MISDO-undef');
  assert.ok(remoto,'MISDO must reach Firestore');
  assert.equal(remoto.punto_vendita,'San Donato');
  assert.equal(remoto.risposte['3'].risposta,'NC');
  assert.equal(remoto.risposte['12'].note,'solo locale');
  assert.ok(s.local.has('MISDO-undef'),'local copy is never removed');
  assert.equal(s.api.statoAttuale(),'sincronizzato');
});

test('one record that cannot be compared never blocks the upload of the others',async()=>{
  const s=setup([{id:'BROKEN',aggiornato_il:'2025-01-01',risposte:[]},{...legacy,id:'MISDO-2'}]);
  const leggi=s.context.db.leggiSopralluogo;
  s.context.db.leggiSopralluogo=async id=>{if(id==='BROKEN')throw Error('corrupt record');return leggi(id);};
  await s.api.init();
  assert.ok(s.remote.has('MISDO-2'));
  assert.notEqual(s.api.statoAttuale(),'sincronizzato','an unsynced record must never show "Sincronizzato"');
});

test('realtime snapshot flagged hasPendingWrites still delivers remote changes (no lost docChanges)',async()=>{
  const s=setup([legacy]);await s.api.init();
  s.remote.set('REMOTE-NEW',{punto_vendita:'Creato su Chrome',aggiornato_il:'2026-09-24T10:00:00Z',risposte:{1:{domanda_id:1,risposta:'C'}}});
  s.setPendingMeta(true);s.emit();s.setPendingMeta(false);
  await new Promise(r=>setTimeout(r,20));
  assert.equal(s.local.get('REMOTE-NEW')?.punto_vendita,'Creato su Chrome');
});

test('remote realtime change is applied locally without echoing a write back',async()=>{
  const s=setup([legacy]);await s.api.init();
  const before=s.counts().writes;
  const r=s.remote.get('MISDO');
  r.risposte['40']={domanda_id:40,risposta:'NC',note:'da Edge',aggiornato_il:'2026-09-24T11:00:00Z'};
  r.aggiornato_il='2026-09-24T11:00:00Z';
  s.emit();await new Promise(r=>setTimeout(r,20));
  assert.equal(s.local.get('MISDO').risposte.find(x=>x.domanda_id===40).note,'da Edge');
  assert.equal(s.counts().writes,before);
});

test('explicit sync re-verifies the server even while the realtime listener is aligned',async()=>{
  const s=setup([legacy]);await s.api.init();
  const gets=s.counts().gets;
  await s.api.sincronizzaTutto();
  assert.equal(s.counts().gets,gets+1);
});
