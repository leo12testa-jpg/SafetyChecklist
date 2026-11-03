/*
 * Colligo DUVRI AI — Ollama Windows diagnostic, Node only.
 * No PowerShell, installation, configuration changes, model downloads,
 * cloud requests, chat generation or writes. GET 127.0.0.1:11434/api/tags only.
 * Intended for read-only inventory in the user's authorized Windows session.
 */
'use strict';
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const http=require('node:http');
const {spawnSync}=require('node:child_process');

const URL='http://127.0.0.1:11434/api/tags';
function safeModels(payload){
 if(!payload||!Array.isArray(payload.models)||payload.models.length>1000)return null;
 const names=[];
 for(const item of payload.models){
  if(!item||typeof item.name!=='string'||item.name.length>128)continue;
  if(!/^[A-Za-z0-9._:/-]+$/.test(item.name))continue;
  names.push(item.name);
 }
 return {local_models:[...new Set(names.filter(n=>!/cloud/i.test(n)))].sort(),
  rejected_cloud_model_count:names.filter(n=>/cloud/i.test(n)).length};
}
function parseTcpListeners(output){
 if(typeof output!=='string')return {verified:false,addresses:[]};
 const listeners=[];
 for(const line of output.split(/\r?\n/)){
  const parts=line.trim().split(/\s+/);
  if(parts.length<5||parts[0].toUpperCase()!=='TCP'||
     parts[3].toUpperCase()!=='LISTENING')continue;
  const match=parts[1].match(/^(.*):11434$/);
  if(match)listeners.push(match[1]);
 }
 const addresses=[...new Set(listeners)].sort();
 return {
  verified:addresses.length>0&&addresses.every(x=>x==='127.0.0.1'||x==='[::1]'),
  addresses
 };
}
function lastCloudLogStatus(text){
 if(typeof text!=='string')return 'UNKNOWN';
 const matches=[...text.matchAll(/Ollama cloud disabled:\s*(true|false)/gi)];
 return matches.length?matches[matches.length-1][1].toUpperCase():'UNKNOWN';
}
function readTail(file,bytes=65536){
 let fd;
 try{
  const size=fs.statSync(file).size;
  fd=fs.openSync(file,'r');
  const sizeRead=Math.min(size,bytes),buf=Buffer.alloc(sizeRead);
  const got=fs.readSync(fd,buf,0,sizeRead,size-sizeRead);
  return buf.subarray(0,got).toString('utf8');
 }catch(_){return '';}
 finally{if(fd!==undefined)try{fs.closeSync(fd);}catch(_){}}
}
async function fetchLocalTags(){
 return await new Promise(resolve=>{
  let settled=false;
  const done=x=>{if(!settled){settled=true;resolve(x);}};
  let req;
  try{
   req=http.request(URL,{method:'GET',timeout:4000,agent:false,
    headers:{accept:'application/json'}},res=>{
    if(res.statusCode!==200){res.resume();done({ok:false,code:'LOCAL_HTTP_NON_200'});return;}
    let bytes=0,text='';
    res.setEncoding('utf8');
    res.on('data',chunk=>{
     bytes+=Buffer.byteLength(chunk);
     if(bytes>131072){req.destroy();done({ok:false,code:'LOCAL_RESPONSE_TOO_LARGE'});}
     else text+=chunk;
    });
    res.on('end',()=>{
     try{
      const out=safeModels(JSON.parse(text));
      done(out?{ok:true,...out}:{ok:false,code:'LOCAL_RESPONSE_INVALID'});
     }catch(_){done({ok:false,code:'LOCAL_RESPONSE_INVALID'});}
    });
    res.on('error',()=>done({ok:false,code:'LOCAL_HTTP_ERROR'}));
   });
   req.on('timeout',()=>req.destroy());
   req.on('error',()=>done({ok:false,code:'LOCAL_API_UNREACHABLE'}));
   req.end();
  }catch(_){done({ok:false,code:'LOCAL_API_UNREACHABLE'});}
 });
}
async function diagnose(){
 const platform=process.platform;
 const cmd=platform==='win32'
  ?spawnSync('where.exe',['ollama'],{encoding:'utf8',timeout:2000,windowsHide:true})
  :null;
 const cliInPath=cmd?cmd.status===0:null;
 const scan=platform==='win32'
  ?spawnSync('netstat.exe',['-ano','-p','TCP'],{
    encoding:'utf8',timeout:3500,maxBuffer:4*1024*1024,windowsHide:true})
  :null;
 const listener=scan&&scan.status===0
  ?parseTcpListeners(scan.stdout)
  :{verified:false,addresses:[]};
 const configPath=path.join(os.homedir(),'.ollama','server.json');
 let configCloudOff=false,configReadable=true;
 try{
  if(fs.existsSync(configPath)){
   const config=JSON.parse(fs.readFileSync(configPath,'utf8'));
   configCloudOff=config.disable_ollama_cloud===true;
  }
 }catch(_){configReadable=false;}
 const envCloudOff=process.env.OLLAMA_NO_CLOUD==='1';
 const localAppData=process.env.LOCALAPPDATA;
 const logPath=localAppData?path.join(localAppData,'Ollama','server.log'):null;
 const cloudLogStatus=logPath?lastCloudLogStatus(readTail(logPath)):'UNKNOWN';
 const tags=await fetchLocalTags();
 let status='READONLY_CHECK_INCOMPLETE';
 if(!tags.ok)status=tags.code;
 else if(!tags.local_models.length)status='NO_INSTALLED_LOCAL_MODEL';
 else if(!listener.verified)status='LOOPBACK_BINDING_NOT_VERIFIED';
 else if(!(envCloudOff||configCloudOff)||cloudLogStatus!=='TRUE')
  status='CLOUD_DISABLED_RUNTIME_NOT_VERIFIED';
 else status='CONFIGURED_BUT_PROCESS_VERIFICATION_STILL_REQUIRED';
 const report={
  status,read_only:true,
  no_installation:true,no_model_pull:true,no_cloud_request:true,
  ollama_cli_in_path:cliInPath,
  local_api_reachable:tags.ok,
  local_models:tags.ok?tags.local_models:[],
  rejected_cloud_model_count:tags.ok?tags.rejected_cloud_model_count:0,
  listener_loopback_only_observed:listener.verified,
  listener_addresses:listener.addresses,
  client_process_no_cloud_env:envCloudOff,
  user_server_json_cloud_disabled:configCloudOff,
  user_server_json_readable:configReadable,
  last_log_cloud_disabled:cloudLogStatus,
  effective_ollama_process_cloud_disabled_verified:false,
  ram_total_gb:Math.round(os.totalmem()/107374182.4)/10,
  ram_available_gb:Math.round(os.freemem()/107374182.4)/10,
  hardware_gpu_unchecked:true,
  warning:'Only observations; confirm settings and runtime of current Ollama process before synthetic test'
 };
 return report;
}
if(require.main===module){
 diagnose().then(x=>process.stdout.write(JSON.stringify(x,null,2)+'\n'))
  .catch(()=>{process.stdout.write(JSON.stringify({status:'DIAGNOSTIC_FAILED',
   read_only:true,effective_ollama_process_cloud_disabled_verified:false})+'\n');
  process.exitCode=1;});
}
module.exports={safeModels,parseTcpListeners,lastCloudLogStatus,diagnose};
