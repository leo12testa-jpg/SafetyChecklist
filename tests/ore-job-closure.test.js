const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const context=vm.createContext({});vm.runInContext(fs.readFileSync('ore-produttivita/job-closure.js','utf8'),context);
test('inattività usa solo date indicate, esclude pratiche chiuse e gestisce il cambio ora',()=>{
 for(const [job,expected]of [[{stato:'in_lavorazione',ultima_attivita:'2026-09-01'},33],[{stato:'in_lavorazione',data_apertura:'2026-10-01'},3],[{stato:'in_lavorazione'},null],[{stato:'completata',ultima_attivita:'2026-09-01'},null]]){context.job=job;assert.equal(vm.runInContext("inactivityDays(job,'2026-10-04')",context),expected);}
 context.job={stato:'sospesa',ultima_attivita:'2026-10-24'};assert.equal(vm.runInContext("inactivityDays(job,'2026-10-26')",context),2);
});
