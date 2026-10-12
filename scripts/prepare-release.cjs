// Prepare a reviewable candidate on a branch. Never commits, pushes, deploys or touches data.
const fs=require('node:fs'),path=require('node:path'),{execFileSync,spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');process.chdir(root);
const files=fs.readdirSync('tests').filter(f=>f.endsWith('.test.js')&&!f.startsWith('ore-')).map(f=>'tests/'+f);
const result=spawnSync(process.execPath,['--test',...files],{stdio:'inherit'});if(result.status!==0)process.exit(result.status||1);
const stamp=new Date().toISOString().replace(/[-:]/g,'').replace('T','-').slice(0,15);
const previous=JSON.parse(fs.readFileSync('version.json')).buildId;
for(const name of ['index.html','service-worker.js','js/aggiornamento.js']){
  const text=fs.readFileSync(name,'utf8');fs.writeFileSync(name,text.replaceAll(previous,stamp));
}
fs.writeFileSync('version.json',JSON.stringify({version:'1.0.0-rc.1',buildId:stamp},null,2)+'\n');
const touched=execFileSync('git',['diff','--name-only','origin/main'],{encoding:'utf8'}).split(/\r?\n/);
if(touched.some(f=>f.startsWith('ore-produttivita/')||f.startsWith('tests/ore-')||f.startsWith('supabase/functions/ore-')))throw Error('Unrelated project changes detected');
console.log('Candidato preparato: '+stamp+'. Rieseguire QA e gate Storage su questa build; pubblicazione esclusivamente tramite PR verificata.');
