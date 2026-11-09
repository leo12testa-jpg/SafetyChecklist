/* Demo Colligo: Word DOCX created in browser from fictional information ONLY.
 * Does not parse uploads, call AI, or produce an official DUVRI.
 */
(function(root,factory){
  const engine=factory();
  if(typeof module!=='undefined' && module.exports) module.exports=engine;
  else root.ColligoSyntheticDuvri=engine;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const R='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const MAX=12;
  function safe(s,max=130){
    return String(s==null?'':s).replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,max);
  }
  function xml(s){return safe(s,400).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');}
  function run(s,opts={}){
    const size=opts.size||20, color=opts.color||'26374B';
    return '<w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/>'+
      (opts.bold?'<w:b/>':'')+(opts.italic?'<w:i/>':'')+
      '<w:color w:val="'+color+'"/><w:sz w:val="'+size+'"/></w:rPr>'+
      '<w:t xml:space="preserve">'+xml(s)+'</w:t></w:r>';
  }
  function p(s,opts={}){
    return '<w:p><w:pPr><w:jc w:val="'+(opts.align||'left')+'"/>'+
      '<w:spacing w:before="'+(opts.before||0)+'" w:after="'+(opts.after===undefined?120:opts.after)+'" w:line="290" w:lineRule="auto"/>'+
      '</w:pPr>'+run(s,opts)+'</w:p>';
  }
  function row(values,widths,shaded){
    return '<w:tr>'+values.map((v,i)=>
      '<w:tc><w:tcPr><w:tcW w:w="'+widths[i]+'" w:type="dxa"/>'+
      (shaded?'<w:shd w:val="clear" w:fill="C6D9F1"/>':'')+
      '<w:tcBorders><w:bottom w:val="single" w:sz="5" w:color="8493A6"/>'+
      '<w:top w:val="single" w:sz="5" w:color="8493A6"/>'+
      '<w:left w:val="single" w:sz="5" w:color="8493A6"/>'+
      '<w:right w:val="single" w:sz="5" w:color="8493A6"/></w:tcBorders></w:tcPr>'+
      p(v,{size:18,after:25})+'</w:tc>'
    ).join('')+'</w:tr>';
  }
  function table(headers, rows, widths){
    return '<w:tbl><w:tblPr><w:tblW w:w="'+widths.reduce((a,b)=>a+b,0)+'" w:type="dxa"/>'+
      '<w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid>'+
      widths.map(n=>'<w:gridCol w:w="'+n+'"/>').join('')+'</w:tblGrid>'+
      row(headers,widths,true)+rows.map(r=>row(r,widths,false)).join('')+'</w:tbl>';
  }
  function section(cover){
    const margins=cover?'1140 822 618 561':'1418 1134 1134 1134';
    const x=margins.split(' ');
    return '<w:sectPr>'+(cover?'':'<w:headerReference w:type="default" r:id="rId2"/><w:footerReference w:type="default" r:id="rId3"/>')+
      '<w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="'+x[0]+'" w:bottom="'+x[1]+'" w:left="'+x[2]+'" w:right="'+x[3]+'"/></w:sectPr>';
  }
  function hardPage(){return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';}
  function content(props){
    const title=safe(props.title||'INTERVENTO DIMOSTRATIVO',95).toUpperCase();
    const files=(props.files||[]).slice(0,MAX).map((s,i)=>[String(i+1),safe(s)]);
    const cover=[
      p('COLLIGO  |  INGEGNERIA',{bold:true,size:36,color:'6E8AA9',align:'center',after:470}),
      p('DOCUMENTO DI VALUTAZIONE DEI RISCHI DERIVANTI DA ATTIVITÀ INTERFERENZIALI',{bold:true,size:24,align:'center',after:70}),
      p('Riferimento normativo subordinato alla verifica Titolo IV / art. 26',{bold:true,size:17,align:'center',after:530}),
      p(title,{bold:true,size:32,align:'center',after:180}),
      p('BOZZA SINTETICA — NON EMETTIBILE — NON APPROVATA',{bold:true,size:21,color:'B13636',align:'center',after:420}),
      table(['SOGGETTO','FIRMA'],[
        ['COMMITTENTE DIMOSTRATIVO (SOGGETTO INVENTATO)','________________________'],
        ['IMPRESA DIMOSTRATIVA A (INVENTATA)','________________________'],
        ['IMPRESA DIMOSTRATIVA B (INVENTATA)','________________________']
      ],[6400,4300]),
      p('DATA '+safe(props.date,25)+'   •   SOLO SIMULAZIONE',{bold:true,size:18,align:'center',before:300}),
      '<w:p><w:pPr>'+section(true)+'</w:pPr></w:p>'
    ].join('');
    const body=[
      p('INDICE DEL DOCUMENTO',{bold:true,size:27,align:'center',after:380}),
      p('1. Scopo e campo di applicazione ........................ 3'),
      p('2. Registro documentale sintetico ......................... 3'),
      p('3. Verifiche necessarie ........................................ 4'),
      p('4. Interferenze di esempio .................................. 4'),
      p('Indice dimostrativo: aggiornare la paginazione in Word.',{italic:true,size:17,color:'7B583C',before:230}),
      hardPage(),
      p('1. SCOPO E CAMPO DI APPLICAZIONE',{bold:true,size:24,before:160}),
      p('Questa è una simulazione. Il documento non contiene analisi reali dei rischi né valutazioni interferenziali. Non è utilizzabile per un appalto o un cliente.',{bold:true,color:'AA3030'}),
      p('2. REGISTRO DOCUMENTALE SINTETICO',{bold:true,size:24,before:210}),
      p('Sono riportati unicamente i nomi dei file scelti nel browser. I contenuti NON sono stati letti, trasmessi o valutati.'),
      table(['N.','NOME FILE (METADATO)'],files.length?files:[['—','Nessun allegato']], [850,9850]),
      hardPage(),
      p('3. VERIFICHE NECESSARIE',{bold:true,size:24,before:180}),
      table(['VERIFICA','ESITO'],[
        ['Titolo IV / articolo 26','DA DECIDERE DAL TECNICO'],
        ['Documenti del committente e delle imprese','DA CONTROLLARE SULLE FONTI'],
        ['D1 / D2 e valutazione HSE','NON APPROVATI'],
        ['Emissione e firme','VIETATE IN QUESTA DEMO']
      ],[6200,4500]),
      p('4. INTERFERENZE — SOLO ESEMPIO',{bold:true,size:24,before:260}),
      p('Scenario inventato: intervento tecnico e transito merci. Nessuna caratterizzazione dei rischi, misura, frequenza o livello residuo è stato stabilito.'),
      table(['ATTIVITÀ','INTERFERENZA','ESITO'],[
        ['Attività A fittizia','Da esaminare','DA VALIDARE'],
        ['Attività B fittizia','Da esaminare','DA VALIDARE']
      ],[3500,3500,3700]),
      p('NON EMETTIBILE — nessun documento cliente elaborato, nessuna firma o decisione HSE.',{bold:true,color:'AA3030',before:230}),
      section(false)
    ].join('');
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
      '<w:document xmlns:w="'+W+'" xmlns:r="'+R+'"><w:body>'+cover+body+'</w:body></w:document>';
  }
  function packageDoc(zip, props){
    zip.file('[Content_Types].xml','<?xml version="1.0" encoding="UTF-8"?>'+
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'+
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'+
      '<Default Extension="xml" ContentType="application/xml"/>'+
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'+
      '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>'+
      '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>');
    zip.file('_rels/.rels','<?xml version="1.0" encoding="UTF-8"?>'+
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
    zip.file('word/_rels/document.xml.rels','<?xml version="1.0" encoding="UTF-8"?>'+
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>'+
      '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/></Relationships>');
    zip.file('word/document.xml',content(props));
    zip.file('word/header1.xml','<?xml version="1.0" encoding="UTF-8"?>'+
      '<w:hdr xmlns:w="'+W+'">'+p('COLLIGO  |  BOZZA DIMOSTRATIVA NON EMETTIBILE',{bold:true,color:'607F9C',size:17})+'</w:hdr>');
    zip.file('word/footer1.xml','<?xml version="1.0" encoding="UTF-8"?>'+
      '<w:ftr xmlns:w="'+W+'">'+p('SIMULAZIONE — nessuna validazione tecnica HSE',{italic:true,size:17,color:'607F9C',align:'right'})+'</w:ftr>');
    return zip;
  }
  async function generate(JSZip, options){
    if(typeof JSZip!=='function') throw new Error('JSZip non disponibile');
    if(!options||!Array.isArray(options.files)||options.files.length>MAX) throw new Error('File non validi');
    return packageDoc(new JSZip(),options).generateAsync({type:'blob',compression:'DEFLATE'});
  }
  return {safe,xml,content,generate};
});