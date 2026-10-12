const fs=require('node:fs'),assert=require('node:assert/strict');
const file=process.argv[2],text=fs.readFileSync(file,'utf8');const values={};
for(const line of text.split(/\r?\n/)){const m=line.match(/^([A-Z_]+)="(.*)"$/);if(m)values[m[1]]=m[2];}
assert.ok(values.API_URL?.startsWith('http://127.0.0.1:'));assert.ok(values.SERVICE_ROLE_KEY&&values.ANON_KEY);
const output={QA_REAL_STORAGE_URL:values.API_URL,QA_REAL_STORAGE_KEY:values.SERVICE_ROLE_KEY,QA_REAL_STORAGE_ANON:values.ANON_KEY};
if(process.env.GITHUB_ENV){console.log('::add-mask::'+values.SERVICE_ROLE_KEY);fs.appendFileSync(process.env.GITHUB_ENV,Object.entries(output).map(([k,v])=>k+'='+v+'\n').join(''));}
else fs.writeFileSync('tests/storage-local/.env.qa',JSON.stringify(output));
console.log('Local Storage endpoint configured; privileged key remains server-side');
