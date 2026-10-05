const test=require('node:test'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
test('agente CRM: selezione fallita, duplicati, errori riservati e recupero bloccato',()=>{
 const result=spawnSync(process.env.PYTHON||'python',['tests/ore-crm-agent-unit.py'],{encoding:'utf8',windowsHide:true,timeout:30000});
 assert.equal(result.status,0,result.stderr||result.error?.message);assert.match(result.stderr,/Ran 8 tests/);
});
