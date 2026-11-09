'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
test('native DUVRI generation replaces demo link without enabling cloud',()=>{
 const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
 const action=fs.readFileSync(path.join(__dirname,'../js/document-generation-action.js'),'utf8');
 const config=fs.readFileSync(path.join(__dirname,'../js/supabase-config.js'),'utf8');
 assert.doesNotMatch(html,/id="dg-open-synthetic-demo"/);
 assert.doesNotMatch(html,/href="duvri-demo\\/"/);
 assert.match(html,/src="js\\/document-generation-action\\.js"/);
 assert.match(action,/Genera DUVRI \\(bozza Word\\)/);
 assert.match(action,/NON EMETTIBILE/);
 assert.match(config,/DOCUMENT_GENERATION_CLOUD_ENABLED\\s*=\\s*false/);
});
