// Classification of browser page errors in the isolated QA (tests/qa-browser.cjs).
// Pure module, no Playwright: covered by tests/qa-transport-filter.test.js.
const EMULATOR='http://127.0.0.1:18085';
// Existing rule (since 07503df): WebKit transport noise on the Firestore streaming channels.
const STREAM_CHANNEL=/127\.0\.0\.1:18085\/google\.firestore\.v1\.Firestore\//;
// WebKit reports requests aborted by context.route as "<url> due to access control checks".
// Only the Firestore REST calls used by sync transactions, on the emulator and demo project.
const WEBKIT_ABORTED_REST=/^\/127\.0\.0\.1:18085(\/v1\/projects\/demo-safety-qa-v1\/databases\/\(default\)\/documents:(?:batchGet|commit)) due to access control checks\.$/;
const OUTSIDE_BLOCK='fuori dal blocco volontario';

function stripQuery(url){return String(url).replace(/\?.*$/,'');}

// Records a request aborted by the device's voluntary emulator block.
function recordAbort(device,url,step,now=Date.now()){device.aborted.push({url:stripQuery(url),step,at:now});}

// Returns {kind:'transport'|'page', entry}. 'page' entries make the QA test fail.
// A REST transaction error is accepted only if it matches a request actually aborted by this
// device's voluntary block (each abort accepted once); everything else stays an application error.
function classifyPageError(message,device,context={},now=Date.now()){
  const entry={user:device.user?.username,message,...context};
  if(STREAM_CHANNEL.test(message)&&/due to access control checks/.test(message))return {kind:'transport',entry};
  const rest=WEBKIT_ABORTED_REST.exec(message);
  if(rest&&device.engine==='webkit'){
    const i=device.aborted.findIndex(x=>x.url===EMULATOR+rest[1]);
    if(i>=0){const [abort]=device.aborted.splice(i,1);return {kind:'transport',entry:{...entry,voluntaryBlock:true,abortedInStep:abort.step,msSinceAbort:now-abort.at}};}
    return {kind:'page',entry:{...entry,reason:OUTSIDE_BLOCK}};
  }
  // Any other engine (Chromium included), host, project or message: application error.
  return {kind:'page',entry};
}

module.exports={EMULATOR,OUTSIDE_BLOCK,recordAbort,classifyPageError};
