'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeSpecialtyScreening } = require('../js/duvri-hse-screening.js');
const { SIGNAL_TO_AGENT, routeSpecialists } = require('../js/duvri-agent-contract.js');

const jobId='FASCICOLO_SYNTH_001', ownFile='CHECKLIST_SYNTH_001';
const ev=(status='confirmed',file_id=ownFile,source_type='current_job_checklist')=>({
  source_type,file_id,locator:'Domanda 1 - dati sintetici',verification_status:status
});
const answer=(signal,answer,evidence=[ev()])=>({signal,answer,evidence});
const run=(answers,more={})=>normalizeSpecialtyScreening({
  jobId,answers,allowedFileIds:[ownFile],...more
});

test('confirmed positive answer activates specialist',()=>{
  const r=run([answer('lavori_in_quota','yes')]);
  assert.equal(r.signals.lavori_in_quota,'yes');
  assert.ok(routeSpecialists(r.signals).selected_agents.includes('lavori_quota'));
  assert.equal(r.errors.length,0);
});
test('confirmed no screens out a specialist but not other unknowns',()=>{
  const r=run([answer('impianti_elettrici','no')]);
  assert.equal(r.signals.impianti_elettrici,'no');
  assert.equal(routeSpecialists(r.signals).selected_agents.includes('elettrico'),false);
  assert.ok(r.needs_confirmation.includes('lavori_in_quota'));
});
test('unconfirmed negative becomes unknown, never proves absence',()=>{
  const r=run([answer('impianti_elettrici','no',[ev('extracted_unconfirmed')])]);
  assert.equal(r.signals.impianti_elettrici,'unknown');
  assert.ok(r.needs_confirmation.includes('impianti_elettrici'));
  assert.equal(r.state,'needs_confirmation');
});
test('unconfirmed positive activates agent while asking for confirmation',()=>{
  const r=run([answer('lavori_in_quota','yes',[ev('requires_verification')])]);
  assert.equal(r.signals.lavori_in_quota,'yes');
  assert.ok(r.needs_confirmation.includes('lavori_in_quota'));
  assert.ok(routeSpecialists(r.signals).selected_agents.includes('lavori_quota'));
});
test('unknown answer with no evidence is allowed only as unknown',()=>{
  const r=run([answer('lavori_in_quota','unknown',[])]);
  assert.equal(r.signals.lavori_in_quota,'unknown');
  assert.equal(r.state,'needs_confirmation');
});
test('yes/no without evidence is blocked',()=>{
  assert.equal(run([answer('lavori_in_quota','yes',[])]).state,'blocked');
  assert.equal(run([answer('lavori_in_quota','no',[])]).state,'blocked');
});
test('missing backend case identity or ACL list is blocked',()=>{
  assert.equal(run([], {jobId:''}).state,'blocked');
  assert.equal(run([], {allowedFileIds:null}).state,'blocked');
  assert.equal(normalizeSpecialtyScreening().state,'blocked');
});
test('screening cannot borrow document evidence from other fascicolo',()=>{
  const r=run([answer('lavori_in_quota','no',[ev('confirmed','FOREIGN_FILE')])]);
  assert.equal(r.state,'blocked');
  assert.deepEqual(r.signals,{});
});
test('historical 2026 precedent is never valid to prove yes/no in current job',()=>{
  assert.equal(run([answer('lavori_in_quota','no',[ev('confirmed',ownFile,'historical_2026_reference')])]).state,'blocked');
});
test('unknown or repeated signals are rejected',()=>{
  assert.equal(run([answer('cliente_coin','yes')]).state,'blocked');
  assert.equal(run([answer('lavori_in_quota','yes'),answer('lavori_in_quota','no')]).state,'blocked');
});
test('unrecognized keys and invented scores are rejected',()=>{
  const r=run([{...answer('lavori_in_quota','yes'),risk_score:9}]);
  assert.equal(r.state,'blocked');
  assert.equal(run([answer('lavori_in_quota','yes',[{...ev(),client:'OTHER_CUSTOMER'}])]).state,'blocked');
});
test('an answer cannot be routed without a valid source locator',()=>{
  assert.equal(run([answer('lavori_in_quota','no',[{...ev(),locator:''}])]).state,'blocked');
  assert.equal(run([answer('lavori_in_quota','no',[{...ev(),verification_status:'historical_example_only'}])]).state,'blocked');
});
test('all known negative signals confirmed yields ready status',()=>{
  const r=run(Object.keys(SIGNAL_TO_AGENT).map(s=>answer(s,'no')));
  assert.equal(r.state,'ready');
  assert.equal(r.needs_confirmation.length,0);
  assert.equal(routeSpecialists(r.signals).selected_agents.length,3);
});
test('empty answers cannot be interpreted as no risks',()=>{
  const r=run([]);
  assert.equal(r.state,'needs_confirmation');
  assert.equal(r.needs_confirmation.length,Object.keys(SIGNAL_TO_AGENT).length);
});
test('all outputs exclude sensitive excerpts and file identifiers',()=>{
  const r=run([answer('lavori_in_quota','yes')]);
  assert.equal(JSON.stringify(r).includes(ownFile),false);
  assert.equal(JSON.stringify(r).includes('Domanda 1'),false);
  assert.deepEqual(Object.keys(r.observations[0]).sort(),[
    'signal','provided_answer','routed_answer','evidence_count',
    'confirmed_source','has_unconfirmed_sources'
  ].sort());
});
test('input screening records are not modified',()=>{
  const inp=[answer('lavori_in_quota','no')];const orig=structuredClone(inp);
  const r=run(inp);r.observations[0].routed_answer='yes';
  assert.deepEqual(inp,orig);
});

test('mixed confirmed and unconfirmed negative evidence cannot exclude specialist',()=>{
  const r=run([answer('impianti_elettrici','no',[ev('confirmed'),ev('extracted_unconfirmed')])]);
  assert.equal(r.signals.impianti_elettrici,'unknown');
  assert.ok(r.needs_confirmation.includes('impianti_elettrici'));
  assert.equal(r.state,'needs_confirmation');
});
