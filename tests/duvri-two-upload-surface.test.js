'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const css=fs.readFileSync(path.join(root,'css/style.css'),'utf8');
const screen=html.slice(html.indexOf('<section id="screen-document-generation"'),html.indexOf('<section id="screen-history"'));
const uploadSurface=screen.slice(screen.indexOf('<section class="dg-panel dg-auto-panel"'),screen.indexOf('<div class="dg-prototype-alert"'));

test('operatore vede due sole aree: checklist Word e tutti gli allegati',()=>{
  assert.equal((uploadSurface.match(/class="dg-intake-area"/g)||[]).length,2);
  assert.match(uploadSurface,/id="dg-area-checklist-title">1\. Checklist Word/);
  assert.match(uploadSurface,/id="dg-area-docs-title">2\. Tutti gli allegati ricevuti/);
  assert.match(uploadSurface,/id="dg-checklist-file" type="file" accept="\.docx"/);
  assert.match(uploadSurface,/id="dg-auto-files" type="file" multiple/);
  assert.equal((uploadSurface.match(/class="dg-upload-zone dg-checklist-upload"/g)||[]).length,1);
  assert.equal((uploadSurface.match(/class="dg-upload-zone dg-drop-zone"/g)||[]).length,1);
});
test('solo DUVRI: scelta documenti nascosta e senza COIN',()=>{
  assert.match(uploadSurface,/<select id="dg-auto-type"[^>]*hidden>/);
  assert.doesNotMatch(uploadSurface,/informativa-coin/);
});
test('il vecchio questionario e il caricamento template restano fuori dalla vista',()=>{
  for(const target of [
    '#screen-document-generation > #dg-form',
    '#screen-document-generation > .dg-workflow-strip',
    '#screen-document-generation > .dg-prototype-alert',
    '#screen-document-generation > .dg-customer-instructions',
    '#screen-document-generation > .dg-queue-panel',
    '#screen-document-generation #dg-template-details',
    '#screen-document-generation #dg-auto-results',
    '#screen-document-generation #dg-auto-files-list select'
  ]){
    assert.ok(css.includes(target),target+' deve restare nascosto');
  }
  assert.match(css,/#screen-document-generation > #dg-form,[\s\S]*?display:\s*none\s*!important;/);
});
test('nessun backend o provider AI attivato dal solo cambiamento della vista',()=>{
  const config=fs.readFileSync(path.join(root,'js/supabase-config.js'),'utf8');
  assert.match(config,/DOCUMENT_GENERATION_CLOUD_ENABLED\s*=\s*false/);
  assert.doesNotMatch(uploadSurface,/Carica checklist e avvia agenti/);
});
test('upload allegati resta multiplo e classificato localmente',()=>{
  const intake=fs.readFileSync(path.join(root,'js/document-intake-ui.js'),'utf8');
  assert.match(intake,/let entries\s*=/);
  assert.match(intake,/input\.addEventListener\('change'/);
  assert.match(intake,/checklistInput\.addEventListener\('change'/);
  assert.match(intake,/documentIntake\.analyzeFile/);
});
