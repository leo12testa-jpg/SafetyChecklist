'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
test('the main DUVRI screen links to isolated synthetic test without enabling real cloud',()=>{
 const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
 const config=fs.readFileSync(path.join(__dirname,'../js/supabase-config.js'),'utf8');
 assert.match(html,/id="dg-open-synthetic-demo"/);
 assert.match(html,/href="duvri-demo\/"/);
 assert.match(html,/rel="noopener noreferrer"/);
 assert.match(html,/NON EMETTIBILE/);
 assert.match(config,/DOCUMENT_GENERATION_CLOUD_ENABLED\s*=\s*false/);
});
