/* COLLIGO — synthetic-only Word draft renderer, static preview. Never accepts HSE approvals. */
'use strict';
(function (root, factory) {
  const engine = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = engine;
  else root.ColligoDemoWord = engine;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const LAYOUT_ID = 'COLLIGO-DUVRI-CORPORATE-2026-V1';
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const MAX_FILE_NAMES = 12;
  function escape(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
  }
  function restrict(s, n=140) { return String(s ?? '').replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,n); }
  function run(s, { bold=false, italic=false, color='24364B', size=20 }={}) {
    return '<w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/>' +
      (bold?'<w:b/>':'') + (italic?'<w:i/>':'') +
      `<w:color w:val="${color}"/><w:sz w:val="${size}"/></w:rPr>` +
      `<w:t xml:space="preserve">${escape(s)}</w:t></w:r>`;
  }
  function paragraph(text, format={}) {
    const { align='left', spacing=125, before=0, after=130, border=false }=format;
    return `<w:p><w:pPr><w:jc w:val="${align}"/>`+
      `<w:spacing w:line="${spacing*2}" w:lineRule="auto" w:before="${before}" w:after="${after}"/>`+
      (border?'<w:pBdr><w:bottom w:val="single" w:sz="6" w:color="A9BAD1"/></w:pBdr>':'') +
      '</w:pPr>'+run(text,format)+'</w:p>';
  }
  function heading(text, level=1) {
    return paragraph(text,{bold:true,size:level===1?24:22,color:'24364B',before:240,after:100});
  }
  function cell(text, shade=false, width=5000) {
    return `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>`+
      (shade?'<w:shd w:val="clear" w:fill="C6D9F1"/>':'') +
      '<w:tcBorders><w:bottom w:val="single" w:sz="5" w:color="6F7986"/>'+
      '<w:top w:val="single" w:sz="5" w:color="6F7986"/>'+
      '<w:left w:val="single" w:sz="5" w:color="6F7986"/>'+
      '<w:right w:val="single" w:sz="5" w:color="6F7986"/></w:tcBorders></w:tcPr>'+
      paragraph(text,{size:19,after:40,before:40})+'</w:tc>';
  }
  function table(headers, rows, widths) {
    const grid=widths.map(w=>`<w:gridCol w:w="${w}"/>`).join('');
    const row=(cells,shade=false)=>'<w:tr>'+cells.map((v,i)=>cell(v,shade,widths[i])).join('')+'</w:tr>';
    return '<w:tbl><w:tblPr><w:tblW w:w="'+widths.reduce((a,b)=>a+b,0)+'" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr>'+
      '<w:tblGrid>'+grid+'</w:tblGrid>'+row(headers,true)+rows.map(v=>row(v)).join('')+'</w:tbl>';
  }
  function section({ cover=false, header=false, footer=false }={}) {
    const margin=cover
      ? '<w:pgMar w:top="1140" w:bottom="822" w:left="618" w:right="561" w:header="450" w:footer="450"/>'
      : '<w:pgMar w:top="1418" w:bottom="1134" w:left="1134" w:right="1134" w:header="450" w:footer="450"/>';
    const refs=(header?'<w:headerReference w:type="default" r:id="rId2"/>':'')+
      (footer?'<w:footerReference w:type="default" r:id="rId3"/>':'');
    return `<w:sectPr>${refs}<w:pgSz w:w="11906" w:h="16838"/>${margin}</w:sectPr>`;
  }
  function hardPage() { return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>'; }
  function documentXml({title, files, demoDate}) {
    const name=restrict(title || 'INTERVENTO DIMOSTRATIVO',95).toUpperCase();
    const src=files.slice(0,MAX_FILE_NAMES).map((x,i)=>[String(i+1),restrict(x,125)]);
    const purpose='FASCICOLO SINTETICO — SOLO TEST INTERFACCIA, SENZA VALUTAZIONE TECNICA';
    let cover = paragraph('COLLIGO  |  INGEGNERIA',{bold:true,size:40,color:'6A7C9A',align:'center',after:460})+
      paragraph('DOCUMENTO DI VALUTAZIONE DEI RISCHI DERIVANTI DA ATTIVITÀ INTERFERENZIALI',{bold:true,size:26,align:'center',after:60})+
      paragraph('ai sensi dell’art. 26, commi 2 e 3, D.Lgs. 81/2008 — REGIME DA VERIFICARE',{bold:true,size:17,align:'center',after:480})+
      paragraph(name,{bold:true,size:36,align:'center',after:90})+
      paragraph('DIMOSTRAZIONE SINTETICA — NESSUN CLIENTE REALE',{bold:true,color:'B53737',size:22,align:'center',after:460})+
      table(['SOGGETTO','FIRMA'],[
        ['Committente: SOCIETÀ DIMOSTRATIVA (INVENTATA)','___________________________'],
        ['Appaltatore: IMPRESA ESEMPIO A (INVENTATA)','___________________________'],
        ['Appaltatore: IMPRESA ESEMPIO B (INVENTATA)','___________________________']], [6450,4277])+
      paragraph('DATA: '+escape(restrict(demoDate,25))+'   ·   BOZZA NON EMETTIBILE',{bold:true,size:18,align:'center',before:350});
    cover += '<w:p><w:pPr>'+section({cover:true})+'</w:pPr></w:p>';
    let body = paragraph('INDICE DEL DOCUMENTO',{bold:true,size:28,align:'center',after:320})+
      paragraph('1. Scopo e campo di applicazione ............................................................. 3',{size:20})+
      paragraph('2. Documenti acquisiti ...................................................................................... 3',{size:20})+
      paragraph('3. Verifiche tecniche ancora necessarie ...................................................... 4',{size:20})+
      paragraph('4. Scheda interferenze (simulazione) ........................................................... 4',{size:20})+
      paragraph('INDICE DIMOSTRATIVO: il paginato effettivo deve essere aggiornato in Microsoft Word.',{italic:true,size:17,color:'8A5A38',before:260})+
      hardPage()+
      heading('1. SCOPO E CAMPO DI APPLICAZIONE')+
      paragraph(purpose,{bold:true,color:'B53737'})+
      paragraph('Questo file serve a verificare il percorso di generazione e il layout Word. Non analizza le informazioni dei documenti caricati e non determina né accerta rischi, imprese, interventi o misure di prevenzione.')+
      heading('2. DOCUMENTI ACQUISITI')+
      paragraph('I nomi qui riportati sono meri metadati locali. Nessun contenuto dei file è stato trasmesso a server, letto da un agente o interpretato come valutazione tecnica.')+
      table(['N.','FONTE DICHIARATA'],src.length?src:[['—','Nessun allegato selezionato']], [1000,9727])+
      hardPage()+
      heading('3. VERIFICHE TECNICHE ANCORA NECESSARIE')+
      table(['VERIFICA','STATO'],[
        ['Regime applicabile (Titolo IV / art. 26)','NON DETERMINATO — decisione del tecnico'],
        ['Documenti del committente e delle imprese','DA VERIFICARE SULLE FONTI'],
        ['Rischi e interferenze effettivi','NON ANALIZZATI'],
        ['D1 / D2 e revisione HSE','NON APPROVATI']], [5900,4827])+
      heading('4. SCHEDA INTERFERENZE — ESEMPIO, NON VALUTAZIONE')+
      paragraph('Caso inventato: un intervento tecnico e una consegna merci hanno una possibile sovrapposizione. Le misure, gli orari e la qualificazione dell’interferenza non sono determinati. Questo testo è solo un segnaposto di impaginazione.')+
      table(['ATTIVITÀ','RISCHIO INTERFERENZIALE','ESITO HSE'],[
        ['Attività tecnica inventata','Da valutare','DA COMPLETARE DAL TECNICO'],
        ['Consegna inventata','Da valutare','DA COMPLETARE DAL TECNICO']], [3500,3500,3727])+
      paragraph('NON EMETTIBILE — Nessuna firma, approvazione, verifica normativa o decisione tecnica è stata effettuata.',{bold:true,color:'B53737',before:320});
    const xml='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>`+cover+body+section({header:true,footer:true})+'</w:body></w:document>';
    return xml;
  }
  function packageFiles(zip, props) {
    zip.file('[Content_Types].xml','<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'+
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'+
      '<Default Extension="xml" ContentType="application/xml"/>'+
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'+
      '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>'+
      '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>'+
      '</Types>');
    zip.file('_rels/.rels','<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'+
      '</Relationships>');
    zip.file('word/_rels/document.xml.rels','<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>'+
      '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>'+
      '</Relationships>');
    zip.file('word/document.xml', documentXml(props));
    zip.file('word/header1.xml','<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
      `<w:hdr xmlns:w="${W}">`+paragraph('COLLIGO INGEGNERIA     |     BOZZA DIMOSTRATIVA NON EMETTIBILE',{bold:true,size:16,color:'6582A0',border:true})+'</w:hdr>');
    zip.file('word/footer1.xml','<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
      `<w:ftr xmlns:w="${W}">`+paragraph('COLLIGO — SOLO PROVA SINTETICA • Nessun dato cliente elaborato',{size:16,italic:true,color:'8A97A8',align:'right'})+'</w:ftr>');
    return zip;
  }
  async function generate(JSZipConstructor, options) {
    if (typeof JSZipConstructor !== 'function') throw new Error('Libreria ZIP non disponibile.');
    const props={...options,title:restrict(options?.title,95),files:options?.files || []};
    if (props.files.length>MAX_FILE_NAMES) throw new Error('Troppi file per la demo.');
    const zip=packageFiles(new JSZipConstructor(),props);
    return zip.generateAsync({type:'blob',compression:'DEFLATE',compressionOptions:{level:6}});
  }
  return {LAYOUT_ID, escape, restrict, documentXml, packageFiles, generate};
});
