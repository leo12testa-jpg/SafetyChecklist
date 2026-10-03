// Keep the app shell and its cache references on the same release identifier.
const fs=require('node:fs');
const build=process.argv[2];
if(!/^\d{8}-\d{6}$/.test(build||''))throw new Error('Uso: node scripts/ore-build.cjs YYYYMMDD-HHMMSS');
for(const file of ['index.html','service-worker.js','aggiornamento.js','version.json']){
  const path='ore-produttivita/'+file;
  fs.writeFileSync(path,fs.readFileSync(path,'utf8').replace(/202\d{5}-\d{4,6}/g,build));
}
