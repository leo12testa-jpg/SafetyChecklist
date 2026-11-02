/*
 * COLLIGO DUVRI AI — standalone, LOCAL, synthetic DOCX demonstration.
 * The output is NEVER an official DUVRI. It deliberately DOES NOT read the
 * contents of the files to infer risks and does not call AI/cloud services.
 * Only file names are listed as unverified input for the demonstration.
 */
const duvriDemoGenerator=(()=>{
  'use strict';
  const MIME='application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  const XMLNS='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  function escapeXml(x) {
    return String(x).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,'')
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/'/g,'&apos;');
  }
  function para(message,kind='body'){
    const props=kind==='title'?
      '<w:spacing w:before="100" w:after="180"/><w:keepNext/>':
      kind==='heading'?
      '<w:spacing w:before="240" w:after="100"/><w:keepNext/>':
      '<w:spacing w:after="120"/>';
    const size=kind==='title'?'36':kind==='heading'?'25':'20';
    const bold=kind!=='body'?'<w:b/>':'';
    const color=kind==='body'?'323D48':'244866';
    return '<w:p><w:pPr>'+props+'</w:pPr><w:r><w:rPr>'+
      bold+'<w:color w:val="'+color+'"/><w:sz w:val="'+size+'"/></w:rPr>'+
      '<w:t xml:space="preserve">'+escapeXml(message)+'</w:t></w:r></w:p>';
  }
  function cell(s,bold){
    return '<w:tc><w:tcPr><w:tcW w:w="2400" w:type="dxa"/></w:tcPr>'+
      '<w:p><w:r><w:rPr>'+(bold?'<w:b/>':'')+
      '<w:sz w:val="17"/></w:rPr><w:t xml:space="preserve">'+
      escapeXml(s)+'</w:t></w:r></w:p></w:tc>';
  }
  function table(headers,rows){
    const rowsXml=[headers,...rows].map((row,i)=>'<w:tr>'+row.map(v=>cell(v,i===0)).join('')+'</w:tr>').join('');
    return '<w:tbl><w:tblPr><w:tblW w:w="9500" w:type="dxa"/>'+
      '<w:tblBorders><w:top w:val="single" w:sz="4"/>'+
      '<w:left w:val="single" w:sz="4"/><w:bottom w:val="single" w:sz="4"/>'+
      '<w:right w:val="single" w:sz="4"/><w:insideH w:val="single" w:sz="4"/>'+
      '<w:insideV w:val="single" w:sz="4"/></w:tblBorders></w:tblPr>'+
      rowsXml+'</w:tbl>';
  }
  function validate(input) {
    if (!input||typeof input.checklistName!=='string'||
        !/\.docx$/i.test(input.checklistName)||!Array.isArray(input.attachments)||
        !input.attachments.length||input.attachments.length>100||
        input.attachments.some(x=>!x||typeof x.name!=='string'||!x.name.trim()||
          x.name.length>300)) throw new Error('Carica una checklist Word e almeno un allegato.');
  }
  function documentXml(input) {
    const a=input.attachments;
    const d=[
      para('ESEMPIO DIMOSTRATIVO — NON UTILIZZARE PER LAVORI REALI','heading'),
      para('DOCUMENTO UNICO DI VALUTAZIONE DEI RISCHI DA INTERFERENZE','title'),
      para('Anteprima di funzionamento — dati completamente fittizi'),
      para('Questo DOCX è generato sul dispositivo. L’app ha verificato la presenza di una checklist Word e di allegati, ma NON ha interpretato i loro contenuti ai fini HSE. Le misure sotto sono esempi fissi e non una valutazione dell’intervento.'),
      para('1. Scenario dimostrativo','heading'),
      table(['Campo','Dato fittizio'],[
        ['Committente','Azienda Dimostrativa S.r.l. — soggetto inesistente'],
        ['Appaltatore','Impianti Demo S.r.l. — soggetto inesistente'],
        ['Lavorazione','Manutenzione sintetica di impianto in copertura'],
        ['Sede','Stabilimento dimostrativo, località fittizia'],
        ['Stato','BOZZA DEMO. Nessuna analisi automatica di rischio eseguita.']
      ]),
      para('2. File selezionati per la prova','heading'),
      para('Checklist Word selezionata: '+input.checklistName),
      para('Allegati selezionati: '+a.length+'. L’elenco seguente riporta soltanto i nomi, non la verifica tecnica dei file.'),
      table(['N.','Nome dell’allegato'],a.map((f,i)=>[String(i+1),f.name])),
      para('3. Possibili interferenze — SOLO DATI SINTETICI','heading'),
      table(['Scenario illustrativo','Proposta preliminare da verificare'],[
        ['Transito di personale sotto area di intervento in quota',
          'Verificare la segregazione delle zone interessate e i percorsi effettivi.'],
        ['Percorsi condivisi per trasporto utensili',
          'Valutare un piano di accesso e coordinamento con il committente.'],
        ['Interazione con impianti elettrici esistenti',
          'Definire una procedura di consegna e messa in sicurezza dell’impianto.']
      ]),
      para('4. Dati mancanti e controlli bloccanti','heading'),
      para('Verificare planimetrie, viabilità, compresenze, procedure di emergenza, referenti e rischi interferenziali reali.'),
      para('La metodologia di rischio Colligo D1, il modello Word ufficiale D2 e le decisioni del tecnico HSE non sono approvati in questa demo. Non sono attribuiti indici P/D/R o costi inventati.'),
      para('5. Revisione tecnica e firme','heading'),
      table(['Ruolo','Nominativo e firma'],[
        ['Tecnico HSE','DA IDENTIFICARE — ____________________________'],
        ['Committente','DA IDENTIFICARE — ____________________________'],
        ['Appaltatore','DA IDENTIFICARE — ____________________________']
      ]),
      para('FINE DELLA DEMO — Questo documento NON è un DUVRI ufficiale e NON autorizza alcuna attività.')
    ].join('');
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
      '<w:document xmlns:w="'+XMLNS+'"><w:body>'+d+
      '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>'+
      '<w:pgMar w:top="1250" w:right="1250" w:bottom="1250" w:left="1250"'+
      ' w:header="640" w:footer="640" w:gutter="0"/></w:sectPr>'+
      '</w:body></w:document>';
  }
  async function generateDocx(JSZipConstructor,input,options={}) {
    if (typeof JSZipConstructor!=='function') throw new Error('Libreria DOCX non disponibile.');
    validate(input);
    const zip=new JSZipConstructor();
    zip.file('[Content_Types].xml','<?xml version="1.0" encoding="UTF-8"?>'+
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'+
      '<Default Extension="xml" ContentType="application/xml"/>'+
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'+
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'+
      '</Types>');
    zip.file('_rels/.rels','<?xml version="1.0" encoding="UTF-8"?>'+
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'+
      '</Relationships>');
    zip.file('word/document.xml',documentXml(input));
    return zip.generateAsync({
      type:options.outputType||'blob',
      mimeType:MIME,
      compression:'DEFLATE',
      compressionOptions:{level:6}
    });
  }
  return Object.freeze({generateDocx,documentXml,escapeXml,MIME});
})();
if(typeof module!=='undefined'&&module.exports)module.exports=duvriDemoGenerator;
