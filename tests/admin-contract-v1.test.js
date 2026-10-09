const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function setup({paged=false,profileFailure=false}={}) {
  let handler;const requests=[];
  const user=(uid,role='tecnico',active=true)=>({name:'projects/qa/databases/(default)/documents/utenti/'+uid,fields:{uid:{stringValue:uid},username:{stringValue:uid},nome:{stringValue:'QA'},cognome:{stringValue:uid},ruolo:{stringValue:role},attivo:{booleanValue:active}}});
  const source=process.env.QA_BASELINE_REF?require('node:child_process').execFileSync('git',['show',process.env.QA_BASELINE_REF+':supabase/functions/manage-users/index.ts'],{encoding:'utf8'}):fs.readFileSync('supabase/functions/manage-users/index.ts','utf8');
  const fetch=async(input,options={})=>{
    const u=new URL(String(input));const body=JSON.parse(options.body||'{}');requests.push({pathname:u.pathname,query:u.search,method:options.method||'GET',body});
    const json=(data,status=200)=>new Response(JSON.stringify(data),{status});
    if(u.pathname.endsWith('/accounts:lookup'))return json({users:[{localId:body.idToken,email:body.idToken+'@qa.local'}]});
    if(u.pathname.endsWith('/accounts:signUp'))return json({localId:'new-user',idToken:'new-only-token'});
    if(u.pathname.endsWith('/accounts:delete'))return json({});
    if(u.pathname.endsWith('/documents:commit'))return json({writeResults:[{}]});
    if(u.pathname.endsWith('/utenti'))return u.searchParams.has('pageToken')?json({documents:[user('qa-101')]}):json({documents:paged?Array.from({length:100},(_,i)=>user('qa-'+i)): [user('admin','admin'),user('tech')],...(paged?{nextPageToken:'next-only'}:{})});
    if(u.pathname.endsWith('/utilizzo_app'))return json({documents:[]});
    const uid=u.pathname.split('/').pop();
    if(options.method==='PATCH')return json(profileFailure?{error:'QA write failure'}:user(uid),profileFailure?503:200);
    return json(user(uid,uid==='admin'?'admin':'tecnico',uid!=='inactive'));
  };
  vm.runInNewContext(require('node:module').stripTypeScriptTypes(source),{Deno:{serve:h=>{handler=h;}},fetch,Request,Response,URL,URLSearchParams,console});
  return {requests,call:(action,token='admin',body={})=>handler(new Request('http://qa.local/',{method:'POST',headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},body:JSON.stringify({action,...body})}))};
}
test('account listing follows Firestore pagination and includes user 101',async()=>{
  const h=setup({paged:true}),r=await h.call('list');assert.equal(r.status,200);assert.equal((await r.json()).users.length,101);
  assert.ok(h.requests.some(r=>r.query.includes('pageToken=next-only')));
});
test('admin actions reject anonymous, technician and inactive callers',async()=>{
  const h=setup();assert.equal((await h.call('list',null)).status,401);assert.equal((await h.call('list','tech')).status,403);assert.equal((await h.call('list','inactive')).status,403);
});
test('usage heartbeat uses verified uid and server timestamp, ignores inspection payload',async()=>{
  const h=setup(),r=await h.call('usagePing','tech',{uid:'admin',event:'access',syncState:'sincronizzato',pendingData:2,note:'never-store'});assert.equal(r.status,200);
  const write=h.requests.find(r=>r.pathname.endsWith('/documents:commit')).body.writes[0];
  assert.ok(write.update.name.endsWith('/utilizzo_app/tech'));assert.equal(write.update.fields.uid.stringValue,'tech');assert.equal(write.update.fields.note,undefined);
  assert.ok(write.updateTransforms.some(t=>t.fieldPath==='last_access'&&t.setToServerValue==='REQUEST_TIME'));
});
test('self role/deactivation blocked and usage list limited to admin',async()=>{
  const h=setup();assert.equal((await h.call('setRole','admin',{uid:'admin',role:'tecnico'})).status,400);assert.equal((await h.call('setActive','admin',{uid:'admin',active:false})).status,400);
  assert.equal((await h.call('usage','tech')).status,403);assert.equal((await h.call('usage')).status,200);
});
test('profile creation failure compensates only the account just created',async()=>{
  const h=setup({profileFailure:true}),r=await h.call('create','admin',{username:'qa.created',nome:'QA',cognome:'Fittizio',ruolo:'tecnico',password:'QA-only!Fittizio2026'});assert.equal(r.status,503);
  const deletes=h.requests.filter(r=>r.pathname.endsWith('/accounts:delete'));assert.equal(deletes.length,1);assert.equal(deletes[0].body.idToken,'new-only-token');
});
