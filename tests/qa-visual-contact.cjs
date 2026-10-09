const fs=require('node:fs'),path=require('node:path');
const {root,playwright,makeServer,guard}=require('./qa-support.cjs');
const server=makeServer();let browser;
(async()=>{
  const url=await server.start();browser=await playwright().chromium.launch({channel:'chrome',headless:true});
  const context=await browser.newContext({viewport:{width:1020,height:900},serviceWorkers:'block'});await guard(context,server.origin);
  const page=await context.newPage();await page.goto(url);
  for(const client of ['coin','interparking','restage','melluso','carrefour']){
    const files=fs.readdirSync(path.join(root,'reports/qa-v1/pdf')).filter(f=>f.startsWith(client+'-page-')).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
    await page.setContent(`<style>body{margin:10px;font:14px sans-serif;background:#ddd}main{display:grid;grid-template-columns:1fr 1fr;gap:10px}figure{margin:0;background:white}figcaption{padding:5px}img{width:100%;display:block}</style><h1>QA ${client} — ${files.length} pagine sintetiche</h1><main>${files.map(f=>`<figure><figcaption>${f}</figcaption><img src="${server.origin}/reports/qa-v1/pdf/${f}"></figure>`).join('')}</main>`);
    await page.evaluate(()=>Promise.all([...document.images].map(i=>i.decode())));
    await page.screenshot({path:path.join(root,'reports/qa-v1/pdf',client+'-contact.png'),fullPage:true});
  }
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{await browser?.close();server.close();});
