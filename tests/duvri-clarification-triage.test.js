'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {prepareRouting,VERSION}=require('../js/duvri-clarification-triage.js');

const jobId='FASCICOLO_SYNTH_001',analysis='ANALYSIS_SYNTH_001';
const extraction='EXTRACTION_SYNTH_001',revision='REGISTER_SYNTH_001';
const digest='a'.repeat(64);
const item=(n,blocking=true)=>({
  request_id:'REQ_'+String(n).padStart(4,'0'),
  kind:n===1?'missing_information':'conflicting_sources',
  agent_id:'antincendio',blocking,requires_technical_review:true,
  client_dispatch_allowed:false,
  suggested_question:'Domanda sintetica, non dati di clienti'
});
const sampleRegister=()=>({
  schema_version:'colligo-duvri-clarification-register/1.0',
  job_id:jobId,analysis_revision_id:analysis,extraction_revision_id:extraction,
  state:'needs_technical_triage',items:[item(1),item(2)],
  item_count:2,blocking_count:2,blocks_document_draft:true,
  blockers:[],human_review_required:true,client_dispatch_allowed:false,
  ready_for_technical_preflight:false,issuance_allowed:false
});
const sampleContext=()=>({
  job_id:jobId,analysis_revision_id:analysis,extraction_revision_id:extraction,
  register_revision_id:revision,current_register_revision_id:revision,
  register_sha256:digest,current_register_sha256:digest,
  register_sha256_verified:true,
  reviewer_id:'TECH_SYNTH_001',role:'tecnico',
  authenticated:true,can_triage:true
});
const decisions=()=>[
  {request_id:'REQ_0001',route:'ask_client'},
  {request_id:'REQ_0002',route:'investigate_internally',note:'Controllo sintetico interno'}
];
const run=(patch={})=>prepareRouting({
  register:sampleRegister(),decisions:decisions(),reviewerContext:sampleContext(),
  expectedJobId:jobId,expectedAnalysisRevisionId:analysis,
  expectedExtractionRevisionId:extraction,expectedRegisterRevisionId:revision,
  ...patch
});
const denied=x=>{assert.equal(x.state,'blocked');assert.equal(x.issuance_allowed,false);
  assert.equal(x.client_dispatch_allowed,false);assert.deepEqual(x.routed_to_client_ids,[]);};

test('valid technician routing is only a metadata draft, not client dispatch',()=>{
  const r=run();assert.equal(r.schema_version,VERSION);
  assert.equal(r.state,'routing_reviewed');
  assert.deepEqual(r.routed_to_client_ids,['REQ_0001']);
  assert.deepEqual(r.routed_to_internal_ids,['REQ_0002']);
  assert.deepEqual(r.open_blocking_request_ids,['REQ_0001','REQ_0002']);
  assert.equal(r.client_dispatch_allowed,false);
  assert.equal(r.clarifications_resolved,false);
  assert.equal(r.ready_for_technical_preflight,false);
  assert.equal(r.duvri_approved,false);assert.equal(r.issuance_allowed,false);
});
test('incomplete routing remains open, never silently closes questions',()=>{
  const r=run({decisions:[decisions()[0]]});
  assert.equal(r.state,'awaiting_routing_decisions');
  assert.deepEqual(r.pending_request_ids,['REQ_0002']);
  assert.equal(r.clarifications_resolved,false);
});
test('all routes can be held for reanalysis but not treated as resolved',()=>{
 const r=run({decisions:[
 {request_id:'REQ_0001',route:'hold_for_reanalysis',note:'Nuova fonte attesa'},
 {request_id:'REQ_0002',route:'hold_for_reanalysis',note:'Nuova fonte attesa'}]});
 assert.equal(r.state,'routing_reviewed');
 assert.equal(r.held_for_reanalysis_ids.length,2);assert.equal(r.issuance_allowed,false);
});
test('empty register is not a final approval',()=>{
 const register=sampleRegister();
 Object.assign(register,{state:'no_open_requests',items:[],item_count:0,
  blocking_count:0,blocks_document_draft:false});
 const r=run({register,decisions:[]});
 assert.equal(r.state,'no_open_requests');
 assert.equal(r.ready_for_technical_preflight,false);
 assert.equal(r.issuance_allowed,false);
});
test('server current job cannot be swapped with another fascicolo',()=>{
 denied(run({expectedJobId:'FASCICOLO_OTHER_001'}));
 const c=sampleContext();c.job_id='FASCICOLO_OTHER_001';
 denied(run({reviewerContext:c}));
});
test('stale analysis, extraction or register revision fails closed',()=>{
 for(const key of ['analysis_revision_id','extraction_revision_id',
 'register_revision_id','current_register_revision_id']){
   const c=sampleContext();c[key]='OLD_REVISION_001';
   denied(run({reviewerContext:c}));
 }
 denied(run({expectedAnalysisRevisionId:'OLD_REVISION_001'}));
 denied(run({expectedExtractionRevisionId:'OLD_REVISION_001'}));
 denied(run({expectedRegisterRevisionId:'OLD_REVISION_001'}));
});
test('unverified, missing, invalid and mismatched SHA digests are refused',()=>{
 for(const val of [null,'partial_hash','b'.repeat(64)]){
   const c=sampleContext();c.current_register_sha256=val;
   denied(run({reviewerContext:c}));
 }
 const c=sampleContext();c.register_sha256_verified=false;
 denied(run({reviewerContext:c}));
});
test('unauthenticated, unprivileged, or forbidden roles fail closed',()=>{
 for(const [key,val] of [
 ['authenticated',false],['can_triage',false],['role','client'],
 ['reviewer_id',null]]){
   const c=sampleContext();c[key]=val;denied(run({reviewerContext:c}));
 }
});
test('blocked or fake ready source registers are refused',()=>{
 for(const [key,value] of [
 ['state','blocked'],['issuance_allowed',true],
 ['ready_for_technical_preflight',true],['client_dispatch_allowed',true],
 ['human_review_required',false]]){
  const reg=sampleRegister();reg[key]=value;denied(run({register:reg}));
 }
});
test('blocked original register cannot be bypassed by empty reviewer list',()=>{
 const reg=sampleRegister();reg.blockers=['NEEDS_EXTRACTION'];
 denied(run({register:reg,decisions:[]}));
});
test('duplicates and unknown request IDs fail without exposing routing',()=>{
 for(const decisionsIn of [
  [decisions()[0],decisions()[0]],
  [{request_id:'REQ_0099',route:'ask_client'}],
  [{request_id:'REQ_0001',route:'approve_and_send'}]
 ])denied(run({decisions:decisionsIn}));
});
test('notes required for internal investigation and reanalysis hold',()=>{
 for(const route of ['investigate_internally','hold_for_reanalysis']) {
  denied(run({decisions:[{request_id:'REQ_0001',route}]}));
  denied(run({decisions:[{request_id:'REQ_0001',route,note:'   '}]}));
 }
});
test('only explicit allowed fields in routing choices are accepted',()=>{
 denied(run({decisions:[{request_id:'REQ_0001',route:'ask_client',
   send_email:true}]}));
 denied(run({decisions:[{request_id:'REQ_0001',route:'ask_client',
   note:'x'.repeat(2001)}]}));
});
test('register items and blocker count must be coherent',()=>{
 const a=sampleRegister();a.blocking_count=0;denied(run({register:a}));
 const b=sampleRegister();b.blocks_document_draft=false;denied(run({register:b}));
 const c=sampleRegister();c.items.push(item(1));c.item_count=3;c.blocking_count=3;
 denied(run({register:c}));
 const d=sampleRegister();d.items[0].client_dispatch_allowed=true;
 denied(run({register:d}));
});
test('nonblocking questions can be routed but never become technical approval',()=>{
 const reg=sampleRegister();reg.items=[item(1,false)];reg.item_count=1;
 reg.blocking_count=0;reg.blocks_document_draft=false;
 const r=run({register:reg,decisions:[decisions()[0]]});
 assert.equal(r.state,'routing_reviewed');assert.equal(r.issuance_allowed,false);
 assert.deepEqual(r.open_blocking_request_ids,[]);
});
test('does not repeat suggested text, evidences or reviewer notes in response',()=>{
 const reg=sampleRegister();reg.items[0].suggested_question='SECRET_SYNTH_QUESTION';
 const notes=[decisions()[0],{request_id:'REQ_0002',
   route:'investigate_internally',note:'SECRET_SYNTH_NOTE'}];
 const r=run({register:reg,decisions:notes});
 assert.equal(JSON.stringify(r).includes('SECRET_SYNTH'),false);
});
test('does not mutate trusted register, context or technician decisions',()=>{
 const reg=sampleRegister(),c=sampleContext(),d=decisions();
 const before=structuredClone([reg,c,d]);
 const r=run({register:reg,reviewerContext:c,decisions:d});
 r.routed_to_client_ids.push('REQ_0099');
 assert.deepEqual([reg,c,d],before);
});
test('missing and malformed context always denies',()=>{
 denied(prepareRouting());denied(run({register:null}));
 denied(run({reviewerContext:null}));denied(run({decisions:null}));
 const reg=sampleRegister();reg.items=[null];reg.item_count=1;reg.blocking_count=0;
 denied(run({register:reg}));
});

test('integration: a real validated register routes human decisions without resolving sources',()=>{
 const {buildClarificationRegister}=require('../js/duvri-clarification-register.js');
 const reg=buildClarificationRegister({
   packet:{
     schema_version:'colligo-duvri-review-packet/1.0',
     job_id:jobId,analysis_revision_id:analysis,
     state:'awaiting_input',human_review_required:true,issuance_allowed:false,
     required_agents:['documentale','normativa','coordinamento'],
     pending_agents:[],blocking_reasons:[],screening_required:[],
     screening_confirmation_required:[],findings:[],conflicts:[],
     missing_information:[{
       agent_id:'documentale',question:'Verificare dato sintetico?',
       why_needed:'Informazione necessaria per prova',blocking:true
     }]
   },
   sourceScope:{
     schema_version:'colligo-duvri-hse-evidence-scope/1.0',
     job_id:jobId,analysis_revision_id:analysis,extraction_revision_id:extraction,
     state:'ready_for_hse_screening',checklist_ready:true,issuance_allowed:false,
     allowed_file_ids:['CHECKLIST_SYNTH_001'],withheld_file_ids:[],
     manual_review_file_ids:[]
   },
   expectedJobId:jobId,expectedAnalysisRevisionId:analysis,
   expectedExtractionRevisionId:extraction
 });
 assert.equal(reg.state,'needs_technical_triage');
 const routed=run({register:reg,decisions:[{request_id:'REQ_0001',
   route:'ask_client'}]});
 assert.equal(routed.state,'routing_reviewed');
 assert.deepEqual(routed.open_blocking_request_ids,['REQ_0001']);
 assert.equal(routed.client_dispatch_allowed,false);
 assert.equal(routed.clarifications_resolved,false);
 assert.equal(routed.issuance_allowed,false);
});
test('integration: a blocked upstream register cannot be routed by a technician',()=>{
 const {buildClarificationRegister}=require('../js/duvri-clarification-register.js');
 const reg=buildClarificationRegister();
 denied(run({register:reg,decisions:[]}));
});
