const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium, firefox, webkit } = require('playwright');

const root = path.join(__dirname, '..');
const mime = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.webp':'image/webp'};

const server = http.createServer((req,res) => {
  const clean = decodeURIComponent((req.url || '/').split('?')[0]);
  const rel = clean === '/' ? 'index.html' : clean.replace(/^\//,'');
  const file = path.join(root, rel);
  if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
  fs.readFile(file,(err,data)=>{
    if(err){res.writeHead(404);return res.end();}
    res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');
    res.end(data);
  });
});

async function prova(nome, browserType) {
  const browser = await browserType.launch({headless:true});
  try {
    const context = await browser.newContext({serviceWorkers:'block'});
    const page = await context.newPage();
    await page.goto('http://127.0.0.1:8766/',{waitUntil:'domcontentloaded'});
    await page.waitForSelector('#login-view:not([hidden])');

    await page.evaluate(() => {
      document.body.dataset.authReady='true';
      document.body.dataset.authenticated='true';
      document.querySelector('#login-view').hidden=true;
      document.querySelector('#screens').hidden=false;
      document.querySelectorAll('.screen').forEach(el => { el.hidden = el.dataset.screen !== 'compilazione'; });

      const daMappa = sync._test.mappaRisposteInArray({
        '3': { risposta:'NC', note:null, foto:[] }
      });
      const fake = {
        id:'interparking-browser-marker',
        risposte:[
          { domanda_id:'1', risposta:'C', note:null, foto:[] },
          { domanda_id:2, risposta:'PC', note:null, foto:[] },
          ...daMappa,
          { domanda_id:'4', risposta:'NA', note:null, foto:[] }
        ]
      };
      const checklist = {
        id:'interparking_sopralluogo',
        sezioni:[{titolo:'Test Interparking',domande:[
          {id:1,testo:'Uno',tipo:'C-PC-NC-NA'},
          {id:2,testo:'Due',tipo:'C-PC-NC-NA'},
          {id:3,testo:'Tre',tipo:'C-PC-NC-NA'},
          {id:4,testo:'Quattro',tipo:'C-PC-NC-NA'},
          {id:5,testo:'Cinque',tipo:'C-PC-NC-NA'}
        ]}]
      };

      db.salvaRisposta = async (_id, risposta) => {
        const i=fake.risposte.findIndex(r => String(r.domanda_id)===String(risposta.domanda_id));
        if(i>=0) fake.risposte[i]={...fake.risposte[i],...risposta};
        else fake.risposte.push(risposta);
        return fake;
      };
      checklistEngine.avvia(checklist,fake);
      compilazioneScreen.init();
      compilazioneScreen.renderDomandaCorrente();
    });

    assert.equal(await page.locator('#progress-label').textContent(),'Domanda 5 di 5', nome+' resume');
    assert.deepEqual(
      await page.locator('.progress-marker').evaluateAll(els=>els.map(el=>el.dataset.stato)),
      ['completa','completa','completa','completa','da-completare'],
      nome+' initial markers'
    );
    await page.locator('input[name="risposta"][value="C"]').check();
    await page.waitForFunction(()=>document.querySelectorAll('.progress-marker')[4]?.dataset.stato==='completa');
    assert.deepEqual(
      await page.locator('.progress-marker').evaluateAll(els=>els.map(el=>el.dataset.stato)),
      ['completa','completa','completa','completa','completa'],
      nome+' after answer'
    );
    console.log(nome+': PASS');
  } finally {
    await browser.close();
  }
}

server.listen(8766,'127.0.0.1',async()=>{
  try {
    for(const [nome,type] of [['Chromium',chromium],['Firefox',firefox],['WebKit',webkit]]) await prova(nome,type);
    console.log('INTERPARKING CROSS-BROWSER PASS');
    server.close(()=>process.exit(0));
  } catch(error) {
    console.error(error);
    server.close(()=>process.exit(1));
  }
});
