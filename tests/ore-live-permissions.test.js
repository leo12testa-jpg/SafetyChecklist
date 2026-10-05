const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');
const {adminActions}=require('./ore-live-permissions.cjs');
test('smoke live comprende tutte le azioni admin e nessuna azione condivisa',()=>{
 const actions=adminActions(fs.readFileSync('supabase/functions/ore-produttivita-api/index.ts','utf8'));
 for(const action of ['adminSummary','adminEconomics','saveJobEconomics','archiveJobs','changeJobState','saveJobComplexity'])assert.ok(actions.includes(action));
 assert.ok(!actions.includes('saveSession'));assert.equal(new Set(actions).size,actions.length);
});
