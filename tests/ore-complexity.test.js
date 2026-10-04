const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const ctx=vm.createContext({});const source=fs.readFileSync('ore-produttivita/job-complexity.js','utf8').replace(/initComplexityFilters\(\);\s*$/,'');vm.runInContext(source,ctx);
test('filtri complessità: null non inventati, campioni esatti e settore senza distinzione maiuscole',()=>{
 ctx.job={fascia_lavoratori:null,numero_sedi:2,settore:'ATECO 41'};
 for(const [filters,expected]of [[{},true],[{fascia_lavoratori:'__missing__'},true],[{fascia_lavoratori:'10-49'},false],[{numero_sedi:2,settore:'ateco 41'},true],[{numero_sedi:3},false]]){ctx.filters=filters;assert.equal(vm.runInContext('matchesJobComplexity(job,filters)',ctx),expected);}
});
