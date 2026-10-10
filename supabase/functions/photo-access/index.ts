/** Private photo gateway. The Storage service key exists only in server secrets. */
const project = Deno.env.get('FIREBASE_PROJECT_ID') || '';
const apiKey = Deno.env.get('FIREBASE_API_KEY') || '';
const storageUrl = Deno.env.get('SUPABASE_URL') || '';
const storageKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const authEmulator = Deno.env.get('FIREBASE_AUTH_EMULATOR_HOST');
const firestoreEmulator = Deno.env.get('FIRESTORE_EMULATOR_HOST');
if (!project || !apiKey || !storageUrl || !storageKey) throw new Error('Photo backend configuration missing');
if ((authEmulator || firestoreEmulator) && !project.startsWith('demo-')) throw new Error('Emulators require a demo project');
const authUrl = authEmulator ? `http://${authEmulator}/identitytoolkit.googleapis.com/v1` : 'https://identitytoolkit.googleapis.com/v1';
const firestoreUrl = `${firestoreEmulator ? `http://${firestoreEmulator}` : 'https://firestore.googleapis.com'}/v1/projects/${project}/databases/(default)/documents`;
const bucket = 'foto-sopralluoghi';
const maxBytes = 8 * 1024 * 1024;
const origins = new Set((Deno.env.get('PHOTO_ALLOWED_ORIGINS') || 'https://leo12testa-jpg.github.io').split(','));
function fail(status: number, message: string): never { throw Object.assign(new Error(message), { status }); }
function headers(req: Request) {
  const origin = req.headers.get('origin');
  return { ...(origin && origins.has(origin) ? { 'access-control-allow-origin': origin } : {}),
    'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'POST, GET, DELETE, OPTIONS',
    'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff', vary: 'Origin' };
}
function json(req: Request, data: unknown, status = 200) { return new Response(JSON.stringify(data), { status, headers: { ...headers(req), 'content-type': 'application/json' } }); }
async function remote(url: string, options: RequestInit = {}) { return await fetch(url, { ...options, signal: AbortSignal.timeout(20000) }); }
function decode(v: any): any {
  if (!v) return null;
  if ('mapValue' in v) return Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k,x]) => [k,decode(x)]));
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(decode);
  return v.stringValue ?? v.booleanValue ?? v.integerValue ?? v.timestampValue ?? null;
}
async function document(collection: string, id: string, token: string) {
  const r = await remote(`${firestoreUrl}/${collection}/${encodeURIComponent(id)}`, { headers: { authorization: `Bearer ${token}` } });
  if ([401,403,404].includes(r.status)) return null;
  if (!r.ok) fail(503,'Authorization service unavailable');
  return decode({ mapValue: { fields: (await r.json()).fields } });
}
function identifier(value: string | null, label: string) {
  if (!value || !/^[a-zA-Z0-9_-]{1,160}$/.test(value)) fail(400,`Invalid ${label}`);
  return value;
}
function pathOf(value: string | null, inspectionId: string) {
  // Keep old names (including timestamped names); reject path traversal and URL injection.
  if (!value || !value.startsWith(inspectionId + '/') || value.length > 500 || value.split('/').length !== 2 || /[\\%\x00-\x1f?#]/.test(value) || value.includes('..')) fail(400,'Invalid photo path');
  return value;
}
function objectUrl(path: string, read = false) { return `${storageUrl}/storage/v1/object/${read ? 'authenticated/' : ''}${bucket}/${path.split('/').map(encodeURIComponent).join('/')}`; }
const serviceHeaders = () => ({ authorization: `Bearer ${storageKey}`, apikey: storageKey });
async function actor(req: Request) {
  const authorization = req.headers.get('authorization') || '';
  if (!authorization.startsWith('Bearer ') || authorization.length > 10000) fail(401,'Authentication required');
  const token = authorization.slice(7);
  const r = await remote(`${authUrl}/accounts:lookup?key=${encodeURIComponent(apiKey)}`, { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({idToken:token}) });
  if (!r.ok) fail(r.status >= 500 ? 503 : 401,'Invalid session');
  const account = (await r.json()).users?.[0];
  if (!account?.localId || account.disabled) fail(401,'Invalid session');
  let claims:any;
  try { claims=JSON.parse(atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))); }
  catch { fail(401,'Invalid session'); }
  if(claims.aud!==project || claims.iss!==`https://securetoken.google.com/${project}` || claims.sub!==account.localId || !Number.isFinite(claims.exp) || claims.exp<=Date.now()/1000 || (account.validSince && claims.iat<Number(account.validSince)))fail(401,'Invalid or revoked session');
  const profile = await document('utenti',account.localId,token);
  if (!profile || profile.uid !== account.localId || profile.attivo !== true || !['admin','tecnico'].includes(profile.ruolo)) fail(403,'Inactive or unauthorized account');
  return { token, uid:account.localId, admin:profile.ruolo === 'admin' };
}
async function bytes(req: Request) {
  if (Number(req.headers.get('content-length') || 0) > maxBytes) fail(413,'Photo too large');
  const reader = req.body?.getReader(); if (!reader) fail(400,'Photo missing');
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) { const {done,value} = await reader.read(); if(done)break; size += value.byteLength; if(size > maxBytes){await reader.cancel();fail(413,'Photo too large');} chunks.push(value); }
  const result = new Uint8Array(size);let position = 0;for(const c of chunks){result.set(c,position);position+=c.length;}
  const jpeg = size > 3 && result[0] === 255 && result[1] === 216 && result[2] === 255;
  const png = size > 8 && [137,80,78,71,13,10,26,10].every((v,i)=>result[i]===v);
  const mime = req.headers.get('content-type')?.split(';')[0];
  if ((!jpeg || mime !== 'image/jpeg') && (!png || mime !== 'image/png')) fail(415,'Only JPEG/PNG photo data accepted');
  return result;
}
Deno.serve({port:Number(Deno.env.get('PORT') || 8000),hostname:Deno.env.get('LISTEN_HOST') || '0.0.0.0'},async req => {
  const origin=req.headers.get('origin');if(origin && !origins.has(origin))return json(req,{error:'Origin not allowed'},403);
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers:headers(req)});
  try {
    if(!['GET','POST','DELETE'].includes(req.method))fail(405,'Method not allowed');
    const user=await actor(req),url=new URL(req.url),inspectionId=identifier(url.searchParams.get('sopralluogo_id'),'inspection');
    // Use the caller's token, not privileged Firebase credentials: Firestore rules are authoritative.
    const inspection=await document('sopralluoghi',inspectionId,user.token);
    if(!inspection)fail(403,'Inspection unavailable or unauthorized');
    if('foto_accesso_uids' in inspection && !user.admin && (!Array.isArray(inspection.foto_accesso_uids) || !inspection.foto_accesso_uids.includes(user.uid)))fail(403,'Inspection unauthorized');
    if(req.method==='POST') {
      if(inspection.eliminato_definitivamente)fail(403,'Inspection deleted');
      const photoId=identifier(url.searchParams.get('foto_id'),'photo');
      const question=url.searchParams.get('domanda_id') || 'altri-aspetti';
      if(!/^(?:altri-aspetti|[a-zA-Z0-9_-]{1,80})$/.test(question))fail(400,'Invalid question');
      const path=pathOf(`${inspectionId}/${question}_${photoId}.jpg`,inspectionId),body=await bytes(req);
      const r=await remote(objectUrl(path),{method:'POST',headers:{...serviceHeaders(),'content-type':req.headers.get('content-type')!,'x-upsert':'false'},body});
      if(!r.ok){
        const error=await r.json().catch(()=>({}));
        if(r.status!==409 && String(error.statusCode)!=='409' && !/duplicate|already exists/i.test(String(error.error || error.message || '')))fail(503,'Storage unavailable');
        const old=await remote(objectUrl(path,true),{headers:serviceHeaders()});if(!old.ok)fail(503,'Storage unavailable');
        const oldBytes=new Uint8Array(await old.arrayBuffer());
        if(oldBytes.length!==body.length || !oldBytes.every((v,i)=>v===body[i]))fail(409,'Existing photo cannot be replaced');
      }
      // No public/signed URL: every read is re-authorized and deactivation takes effect immediately.
      return json(req,{path,url:null});
    }
    const path=pathOf(url.searchParams.get('path'),inspectionId);
    if(!Object.values(inspection.foto_url || {}).some((v:any)=>v?.path===path))fail(403,'Photo is not referenced by this inspection');
    if(req.method==='GET'){
      const r=await remote(objectUrl(path,true),{headers:serviceHeaders()});if(!r.ok)fail(r.status===404?404:503,'Photo unavailable');
      return new Response(r.body,{headers:{...headers(req),'content-type':r.headers.get('content-type') || 'image/jpeg'}});
    }
    const r=await remote(`${storageUrl}/storage/v1/object/${bucket}`,{method:'DELETE',headers:{...serviceHeaders(),'content-type':'application/json'},body:JSON.stringify({prefixes:[path]})});
    if(!r.ok)fail(503,'Photo deletion unavailable');return json(req,{deleted:true});
  } catch(error:any){return json(req,{error: error.status ? error.message : 'Photo service unavailable'},Number(error.status)||503);}
});
