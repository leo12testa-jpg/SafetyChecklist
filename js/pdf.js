/**
 * Generazione del report PDF del sopralluogo con jsPDF + jsPDF-AutoTable, secondo il layout
 * del report reale del cliente: doppio logo, tabella DATI GENERALI, sezioni raggruppate in
 * ANALISI DOCUMENTALE / SOPRALLUOGO AMBIENTI DI LAVORO con tabelle a colonne C/P.C/N.C/N.P,
 * legenda a fondo pagina, pagina Altri aspetti, pagina Allegati con foto in griglia. Nessuna
 * firma nel report: il sopralluogo passa a "completato" alla generazione del PDF stesso.
 *
 * NOTA: questo layout (gruppi, colonne, legenda) è disegnato per checklist "a stato" del tipo
 * C-PC-NC-NA (es. people_design). Le checklist "stile": "raccolta-dati" (es. aggiornamento_dvr_pem),
 * con domande di tipo eterogeneo (testo, numero, si-no, scelta-singola, checkbox-multi con
 * sotto-campi, gruppo-testo), usano invece un report più semplice (vedi disegnaReportRaccoltaDati)
 * con valori formattati in modo leggibile e la stessa pagina Allegati.
 */
const pdf = (() => {
  const MARGINE = 15;
  const LARGHEZZA_PAGINA = 210; // A4, mm
  const ALTEZZA_PAGINA = 297;

  const TITOLI_GRUPPI_SEZIONI = ['ANALISI DOCUMENTALE', 'SOPRALLUOGO AMBIENTI DI LAVORO'];

  const LEGENDA = 'C = Conforme;   P.C = Parzialmente conforme;   N.C = Non conforme;   N.P = Non pertinente';

  function blobADataURL(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }

  /**
   * Carica un'immagine locale come dataURL (fetch + blob), senza passare da <img>/canvas.
   * jsPDF ha un proprio decoder immagine (supporta WEBP/PNG/JPEG in puro JS): passargli
   * direttamente il dataURL evita di dipendere dal supporto WebP del browser/WebView del
   * dispositivo, che può variare tra desktop e mobile.
   */
  async function caricaLogo(url) {
    const risposta = await fetch(url);
    if (!risposta.ok) {
      throw new Error(`Logo non trovato (HTTP ${risposta.status}): ${url}`);
    }
    const blob = await risposta.blob();
    return blobADataURL(blob);
  }

  /**
   * Associazione checklist -> file del logo cliente fisso in assets/. Il match è sull'id della
   * checklist (identificatore stabile, sempre presente e univocamente legato a un cliente in
   * checklists/clients.json), non sul testo libero "Punto vendita": quel campo è digitato
   * liberamente dall'utente e può non contenere affatto il nome del cliente.
   */
  const LOGO_CLIENTE_PER_CHECKLIST = [
    { corrispondenza: 'coin', file: 'assets/logo_coin.webp' },
    { corrispondenza: 'interparking', file: 'assets/logo_interparking.webp' },
    { corrispondenza: 'restage', file: 'assets/logo_restage.png' }
  ];

  /**
   * Logo del cliente corrispondente alla checklist del sopralluogo (match case-insensitive su
   * "coin"/"interparking"/"restage" nell'id o nel titolo della checklist). Loghi fissi, bundled nell'app.
   * Se la checklist non corrisponde a nessun cliente conosciuto, ritorna null (l'intestazione
   * non mostra nulla a destra, nessun placeholder rotto) e lo segnala con un console.warn per
   * poterlo individuare in futuro. Se il file è previsto ma non si riesce a caricare, l'errore
   * viene registrato esplicitamente in console (non fallisce silenziosamente) e il logo viene
   * comunque omesso, senza far fallire l'intera generazione del PDF per un asset mancante.
   */
  async function ottieniLogoCliente(checklist, puntoVendita) {
    const riferimento = `${checklist.id || ''} ${checklist.titolo || ''}`.toLowerCase();
    const voce = LOGO_CLIENTE_PER_CHECKLIST.find((c) => riferimento.includes(c.corrispondenza));
    if (!voce) {
      console.warn(`[pdf.js] Nessun logo cliente associato alla checklist "${checklist.id}" (titolo: "${checklist.titolo}", Punto vendita: "${puntoVendita || ''}"). Intestazione senza logo a destra.`);
      return null;
    }
    try {
      return await caricaLogo(voce.file);
    } catch (errore) {
      console.error(`[pdf.js] Logo cliente non caricato (${voce.file}) per checklist "${checklist.id}" (Punto vendita: "${puntoVendita || ''}"):`, errore);
      return null;
    }
  }

  /**
   * Logo fisso di Colligo Ingegneria, bundled nell'app: prova prima assets/logo_colligo.webp,
   * poi assets/logo.png come fallback. Se nessuno dei due si carica, l'errore viene registrato
   * esplicitamente in console e il logo viene omesso invece di far fallire l'intera generazione
   * del PDF.
   */
  async function ottieniLogoColligo() {
    try {
      return await caricaLogo('assets/logo_colligo.webp');
    } catch (errorePrimario) {
      try {
        return await caricaLogo('assets/logo.png');
      } catch (erroreFallback) {
        console.error('[pdf.js] Logo Colligo Ingegneria non caricato (né logo_colligo.webp né logo.png):', errorePrimario, erroreFallback);
        return null;
      }
    }
  }

  /** Formatta una data semplice "YYYY-MM-DD" (es. da <input type="date">) senza passare da Date/timezone. */
  function formattaDataSemplice(dataISO) {
    if (!dataISO) {
      return '';
    }
    const [anno, mese, giorno] = dataISO.split('-');
    return `${giorno}/${mese}/${anno}`;
  }

  /** Divide un testo su più righe rispettando gli a-capo espliciti (\n) oltre al wrap automatico. */
  function avvolgiTesto(doc, testo, larghezza) {
    return String(testo || '').split('\n').flatMap((riga) => doc.splitTextToSize(riga, larghezza));
  }

  /** Va a pagina nuova se non c'è più spazio verticale per il prossimo blocco. Ritorna la y aggiornata. */
  function nuovaRigaSeNecessario(doc, y, spazioRichiesto = 10) {
    if (y + spazioRichiesto > ALTEZZA_PAGINA - MARGINE) {
      doc.addPage();
      return MARGINE;
    }
    return y;
  }

  /**
   * Disegna un logo mantenendo le proporzioni originali dell'immagine, adattato dentro un
   * riquadro massimo larghezzaMax×altezzaMax (mai deformato): usa il fattore di scala più
   * restrittivo tra i due assi, e non ingrandisce mai oltre la dimensione naturale del file.
   */
  function disegnaLogoProporzionato(doc, dataURL, allineamento, larghezzaMax, altezzaMax) {
    if (!dataURL) {
      return;
    }
    const proprieta = doc.getImageProperties(dataURL);
    const scala = Math.min(larghezzaMax / proprieta.width, altezzaMax / proprieta.height, 1);
    const larghezza = proprieta.width * scala;
    const altezza = proprieta.height * scala;
    const x = allineamento === 'destra' ? LARGHEZZA_PAGINA - MARGINE - larghezza : MARGINE;
    doc.addImage(dataURL, proprieta.fileType, x, MARGINE, larghezza, altezza);
  }

  /** Intestazione con doppio logo affiancato (Colligo Ingegneria a sinistra, cliente a destra), proporzioni originali mantenute. Nessun titolo checklist: è un dato interno (usato solo per l'elenco a tendina), non va mostrato nel report. */
  function disegnaIntestazione(doc, logoClienteURL, logoColligoURL) {
    const LARGHEZZA_MAX_LOGO = 40;
    const ALTEZZA_MAX_LOGO = 15;

    disegnaLogoProporzionato(doc, logoColligoURL, 'sinistra', LARGHEZZA_MAX_LOGO, ALTEZZA_MAX_LOGO);
    disegnaLogoProporzionato(doc, logoClienteURL, 'destra', LARGHEZZA_MAX_LOGO, ALTEZZA_MAX_LOGO);

    return MARGINE + ALTEZZA_MAX_LOGO + 8;
  }

  /**
   * Etichette della tabella DATI GENERALI, con eventuali override per checklist_id. Riusa la
   * stessa mappa ETICHETTE_PERSONALIZZATE_PER_CHECKLIST definita in app.js per la UI del form
   * (stesse chiavi: puntoVendita/responsabile/presenzaResponsabile), così le due non possono
   * disallinearsi: un solo posto dove cambiare il testo per un cliente. app.js viene caricato
   * dopo pdf.js in index.html, ma la costante è già definita al momento in cui questa funzione
   * viene effettivamente chiamata (generazione PDF, sempre dopo il caricamento completo della pagina).
   */
  function etichetteDatiGenerali(checklistId) {
    const override = ETICHETTE_PERSONALIZZATE_PER_CHECKLIST[checklistId] || {};
    return {
      puntoVendita: override.puntoVendita || 'Punto vendita',
      responsabile: override.responsabile || 'Responsabile del punto vendita',
      presenzaResponsabile: override.presenzaResponsabile || 'Sopralluogo alla presenza del responsabile del punto vendita'
    };
  }

  /**
   * Tracciatore della legenda a piè di pagina: disegnata via l'hook didDrawPage di autoTable,
   * così ogni tabella la ridisegna in automatico su ogni pagina che tocca (compresa la
   * continuazione su pagine successive), senza doverla ripetere sotto ogni singola tabella né
   * fare un secondo giro a fine documento. Il Set tiene traccia delle pagine già servite: più
   * tabelle diverse possono condividere la stessa pagina (es. la coda di una sezione e l'inizio
   * della successiva), e didDrawPage spara per ciascuna di esse — senza questo controllo la
   * legenda verrebbe disegnata più volte, sovrapposta, sulla stessa pagina. completaPagineRestanti
   * è una rete di sicurezza per le pagine senza alcuna tabella (Altri aspetti, Allegati).
   */
  function creaTracciatoreLegenda(doc) {
    const pagineFatte = new Set();
    function disegnaSeNonGiaFatta(numeroPagina) {
      if (pagineFatte.has(numeroPagina)) {
        return;
      }
      pagineFatte.add(numeroPagina);
      const paginaPrecedente = doc.internal.getCurrentPageInfo().pageNumber;
      doc.setPage(numeroPagina);
      doc.setFontSize(7.5);
      doc.setFont(undefined, 'italic');
      doc.text(LEGENDA, MARGINE, ALTEZZA_PAGINA - 8);
      doc.setFont(undefined, 'normal');
      doc.setPage(paginaPrecedente);
    }
    return {
      hookDidDrawPage: (data) => disegnaSeNonGiaFatta(data.pageNumber),
      completaPagineRestanti() {
        const totale = doc.internal.getNumberOfPages();
        for (let i = 1; i <= totale; i += 1) {
          disegnaSeNonGiaFatta(i);
        }
      }
    };
  }

  /** Tabella "DATI GENERALI": titolo su sfondo arancione, righe con bordi neri. */
  function disegnaTabellaDatiGenerali(doc, checklist, sopralluogo, y, hookLegenda) {
    const etichette = etichetteDatiGenerali(checklist.id);
    const puntoVendita = `${sopralluogo.punto_vendita || ''}\n${sopralluogo.indirizzo_punto_vendita || ''}`;

    const corpo = [
      [etichette.puntoVendita, puntoVendita],
      ['Numero di dipendenti in forza al momento del sopralluogo', String(sopralluogo.numero_dipendenti || '')],
      [sopralluogo.tecnico_2 ? 'Tecnici che hanno eseguito il sopralluogo' : 'Tecnico che ha eseguito il sopralluogo',
        formattaTecnici(sopralluogo)],
      ['Data del sopralluogo', formattaDataSemplice(sopralluogo.data_sopralluogo)],
      [etichette.responsabile, sopralluogo.responsabile_punto_vendita || ''],
      [etichette.presenzaResponsabile, sopralluogo.presenza_responsabile || ''],
      ["Sopralluogo alla presenza dell'R.L.S.", sopralluogo.presenza_rls || '']
    ];

    doc.autoTable({
      startY: y,
      margin: { left: MARGINE, right: MARGINE },
      head: [[{ content: 'DATI GENERALI', colSpan: 2 }]],
      body: corpo,
      theme: 'grid',
      styles: { lineColor: [0, 0, 0], lineWidth: 0.2, fontSize: 9, cellPadding: 2, valign: 'middle', textColor: [0, 0, 0] },
      headStyles: { fillColor: [250, 200, 120], textColor: [0, 0, 0], fontStyle: 'bold', fontSize: 11, halign: 'left' },
      columnStyles: { 0: { fontStyle: 'bold', cellWidth: 65 }, 1: { cellWidth: 'auto' } },
      didDrawPage: hookLegenda
    });

    return doc.lastAutoTable.finalY + 8;
  }

  function formattaTecnici(sopralluogo) {
    return [sopralluogo.tecnico, sopralluogo.tecnico_2].filter(Boolean).join('\n');
  }

  /** Bandiera blu a piena larghezza con il titolo del macro-gruppo (ANALISI DOCUMENTALE / SOPRALLUOGO AMBIENTI DI LAVORO). */
  function disegnaIntestazioneGruppo(doc, titolo, y) {
    y = nuovaRigaSeNecessario(doc, y, 14);
    doc.setFillColor(74, 122, 181);
    doc.rect(MARGINE, y, LARGHEZZA_PAGINA - MARGINE * 2, 9, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(11);
    doc.setFont(undefined, 'bold');
    doc.text(titolo, MARGINE + 3, y + 6.2);
    doc.setTextColor(0, 0, 0);
    doc.setFont(undefined, 'normal');
    return y + 9 + 5;
  }

  function segnoRisposta(valoreRisposta, colonna) {
    return valoreRisposta === colonna ? 'X' : '';
  }

  /** Colore testo delle "X" nelle colonne di stato, per indice colonna (2=C, 3=P.C, 4=N.C, 5=N.P). */
  const COLORE_COLONNA_STATO = {
    2: [26, 122, 26], // C - verde (#1a7a1a)
    3: [201, 122, 0], // P.C - arancione (#c97a00)
    4: [192, 57, 43], // N.C - rosso (#c0392b)
    5: [51, 51, 51] // N.P - nero/grigio scuro (#333333)
  };

  const FONT_SIZE_TABELLA_SEZIONE = 7.5;
  const PADDING_TABELLA_SEZIONE = 2.5;
  const LARGHEZZA_COLONNA_NOTE = 77;
  const LARGHEZZA_NOTA_DISPONIBILE = LARGHEZZA_COLONNA_NOTE - PADDING_TABELLA_SEZIONE * 2;

  /**
   * Padding verticale (sopra/sotto) della sola colonna Note, più ampio del cellPadding generico
   * PADDING_TABELLA_SEZIONE (che resta invariato per il padding orizzontale della stessa colonna
   * e per tutte le altre colonne): dà più respiro alle note lunghe su più righe, così l'ultima
   * riga di testo non risulti mai a ridosso del bordo inferiore della cella (e quindi della
   * domanda successiva). Usato sia per calcolare l'altezza minima della riga (minCellHeight in
   * didParseCell) sia per centrare verticalmente il testo (disegnaNotaGiustificataCentrata): le
   * due cose devono restare in sincrono, altrimenti il centraggio non userebbe davvero lo spazio
   * extra appena riservato.
   */
  const PADDING_VERTICALE_NOTA = 3.5;

  /**
   * Testo della colonna Note giustificato (allineato sia a sinistra che a destra, come un
   * paragrafo) e centrato verticalmente nell'altezza della riga — su tutte le righe, non solo
   * N.C./P.C., per coerenza visiva. jsPDF-autotable non supporta halign:'justify' nativamente
   * (solo left/center/right): il core jsPDF sì, via doc.text(righe, x, y, {maxWidth,
   * align:'justify'}), quindi qui si disabilita il disegno automatico della cella
   * (data.cell.text = []) e si disegna a mano in didDrawCell. L'ultima riga di ciascuna nota
   * non viene forzata a riempire tutta la larghezza (comportamento nativo di jsPDF per
   * align:'justify': solo standard tipografico, mai una riga isolata "allargata" in modo innaturale).
   *
   * IMPORTANTE: in didParseCell, data.cell.width vale ancora 0 (il layout delle colonne non è
   * stato calcolato) — usarlo per il wrapping produce una larghezza negativa e centinaia di
   * "righe" di una lettera ciascuna, gonfiando a dismisura l'altezza della riga (bug osservato
   * e corretto durante lo sviluppo). Si usa quindi sempre LARGHEZZA_NOTA_DISPONIBILE, nota a
   * priori dalla configurazione della colonna, mai la geometria della cella per la larghezza.
   */
  function calcolaRigheNota(doc, testoGrezzo) {
    return avvolgiTesto(doc, testoGrezzo, LARGHEZZA_NOTA_DISPONIBILE);
  }

  /**
   * doc.getLineHeight() ritorna il valore in PUNTI TIPOGRAFICI, non nell'unità del documento
   * (qui 'mm'): usarlo direttamente come distanza tra righe in mm lo sovrastima di un fattore
   * ~2.83 (72/25.4), facendo "sembrare" il testo molto più corto del reale e quindi non
   * centrato verticalmente (bug osservato e corretto durante lo sviluppo, confermato misurando
   * la posizione reale delle righe nel PDF generato). doc.internal.scaleFactor è lo stesso
   * fattore punti-per-unità che jsPDF usa internamente: dividerlo per quello dà la vera altezza
   * riga nell'unità del documento.
   */
  function altezzaRigaMm(doc) {
    return doc.getLineHeight() / doc.internal.scaleFactor;
  }

  function disegnaNotaGiustificataCentrata(doc, cella) {
    const righe = cella._righeGiustificate;
    if (!righe || !righe.length) {
      return;
    }
    doc.setFont(undefined, 'italic');
    doc.setFontSize(FONT_SIZE_TABELLA_SEZIONE);
    const altezzaRiga = altezzaRigaMm(doc);
    const altezzaBlocco = righe.length * altezzaRiga;
    const x = cella.x + PADDING_TABELLA_SEZIONE;
    // + altezzaRiga*0.75: doc.text usa la baseline, non il top del blocco di testo.
    const yIniziale = cella.y + (cella.height - altezzaBlocco) / 2 + altezzaRiga * 0.75;
    doc.text(righe, x, yIniziale, { maxWidth: LARGHEZZA_NOTA_DISPONIBILE, align: 'justify' });
    doc.setFont(undefined, 'normal');
  }

  /**
   * Compatta un elenco di numeri (già ordinato crescente) in intervalli tipografici: run
   * consecutivi diventano "3-4", numeri isolati o run non contigui restano separati da virgola
   * (es. [2,3,4,7] -> "2-4, 7"). Nel caso pratico più comune (più foto scattate per la stessa
   * domanda) i numeri sono sempre consecutivi, essendo assegnati nello stesso ordine in cui le
   * foto di quella risposta vengono raccolte da raccogliFotoConDidascalia.
   */
  function formattaIntervalliNumerici(numeri) {
    const pezzi = [];
    let inizio = numeri[0];
    let precedente = numeri[0];
    for (let i = 1; i <= numeri.length; i += 1) {
      const attuale = numeri[i];
      if (attuale === precedente + 1) {
        precedente = attuale;
        continue;
      }
      pezzi.push(inizio === precedente ? `${inizio}` : `${inizio}-${precedente}`);
      inizio = attuale;
      precedente = attuale;
    }
    return pezzi.join(', ');
  }

  /**
   * Suffisso "(Vedi Foto N)" per una domanda con foto associate, numerazione coerente con la
   * pagina Allegati (stesso ordine, stesso indice+1 di raccogliFotoConDidascalia).
   */
  function suffissoVediFoto(domandaId, mappaFotoPerDomanda) {
    const numeri = mappaFotoPerDomanda && mappaFotoPerDomanda.get(domandaId);
    if (!numeri || !numeri.length) {
      return '';
    }
    return `Vedi ${numeri.map((numero) => `Foto ${numero}`).join(', ')}`;
  }

  /**
   * Tabella di una singola sezione: n., Descrizione attività, colonne di stato C/P.C/N.C/N.P, Note.
   * Il titolo della sezione è la PRIMA riga dell'head (colSpan su tutte le colonne), non un
   * paragrafo separato prima della tabella: con un head a due righe, autoTable ripete
   * automaticamente entrambe su ogni pagina in cui la tabella prosegue (showHead:'everyPage',
   * il default), eliminando sia il titolo "orfano" a fine pagina sia lo spreco di spazio. Nessun
   * page-break manuale prima della tabella: la paginazione naturale di autoTable basta.
   */
  function disegnaTabellaSezione(doc, sezione, sopralluogo, y, mappaFotoPerDomanda, hookLegenda) {
    const corpo = sezione.domande.map((domanda) => {
      const risposta = (sopralluogo.risposte || []).find((r) => r.domanda_id === domanda.id);
      const valore = risposta ? risposta.risposta : '';
      const nota = (risposta && risposta.note) || '';
      const vediFoto = suffissoVediFoto(domanda.id, mappaFotoPerDomanda);
      return [
        domanda.id,
        domanda.testo,
        segnoRisposta(valore, 'C'),
        segnoRisposta(valore, 'PC'),
        segnoRisposta(valore, 'NC'),
        segnoRisposta(valore, 'NA'),
        vediFoto ? (nota ? `${nota} ${vediFoto}` : vediFoto) : nota
      ];
    });

    doc.autoTable({
      startY: y,
      margin: { left: MARGINE, right: MARGINE },
      // Una riga non viene mai spezzata a metà fra due pagine: il testo della nota è disegnato a
      // mano in didDrawCell (vedi disegnaNotaGiustificataCentrata) partendo sempre dall'inizio
      // della nota, quindi non sa "riprendere da dove interrotto" come farebbe autoTable con le
      // celle che disegna nativamente — con lo split di default (rowPageBreak: 'auto') una riga
      // con una nota lunga che cade a cavallo di un'interruzione di pagina veniva tagliata a metà
      // sulla prima pagina E ridisegnata per intero (duplicata) in un frammento di riga orfano in
      // cima alla pagina successiva. 'avoid' sposta l'intera riga sulla pagina successiva se non
      // ci sta, invece di spezzarla.
      rowPageBreak: 'avoid',
      head: [
        [{ content: sezione.titolo, colSpan: 7, styles: { halign: 'left', fontStyle: 'bold', fontSize: 10, fillColor: [255, 255, 255], textColor: [0, 0, 0] } }],
        [
          'n.',
          'Descrizione attività',
          // Le colonne di stato (C/P.C/N.C/N.P) sono strette (7mm): il cellPadding generico
          // PADDING_TABELLA_SEZIONE (2.5mm per lato) lascerebbe solo ~2mm di spazio al testo,
          // troppo poco per "P.C"/"N.C"/"N.P" che andrebbero a capo lettera per lettera. Un
          // padding e un font ridotti solo per questi 4 header (non per il resto della riga né
          // per le celle "X" del corpo) bastano a farli stare su una riga sola.
          { content: 'C', styles: { fontSize: 6.5, cellPadding: 0.5 } },
          { content: 'P.C', styles: { fontSize: 6.5, cellPadding: 0.5 } },
          { content: 'N.C', styles: { fontSize: 6.5, cellPadding: 0.5 } },
          { content: 'N.P', styles: { fontSize: 6.5, cellPadding: 0.5 } },
          'Note'
        ]
      ],
      body: corpo,
      theme: 'grid',
      styles: { lineColor: [0, 0, 0], lineWidth: 0.2, fontSize: FONT_SIZE_TABELLA_SEZIONE, cellPadding: PADDING_TABELLA_SEZIONE, valign: 'middle', textColor: [0, 0, 0] },
      headStyles: { fillColor: [225, 225, 225], textColor: [0, 0, 0], fontStyle: 'bold', halign: 'center', fontSize: FONT_SIZE_TABELLA_SEZIONE },
      columnStyles: {
        0: { cellWidth: 10, halign: 'center' },
        1: { cellWidth: 65 },
        2: { cellWidth: 7, halign: 'center' },
        3: { cellWidth: 7, halign: 'center' },
        4: { cellWidth: 7, halign: 'center' },
        5: { cellWidth: 7, halign: 'center' },
        6: { cellWidth: LARGHEZZA_COLONNA_NOTE, fontStyle: 'italic' }
      },
      didParseCell(data) {
        if (data.section === 'body' && data.cell.raw === 'X') {
          const colore = COLORE_COLONNA_STATO[data.column.index];
          if (colore) {
            data.cell.styles.textColor = colore;
            data.cell.styles.fontStyle = 'bold';
          }
          return;
        }
        if (data.section === 'body' && data.column.index === 6) {
          // jsPDF-autotable chiama questo hook (in fase di calcolo larghezze/altezze) SENZA aver
          // applicato lo stile della cella al `doc`: il font/stile attivo in questo momento è
          // quello lasciato da qualunque cosa sia stata disegnata prima (es. "X" in grassetto di
          // un'altra colonna), non l'italic dichiarato in columnStyles per questa colonna. Se qui
          // si calcolano le righe con un font diverso da quello usato davvero al disegno (vedi
          // disegnaNotaGiustificataCentrata, che imposta italic/FONT_SIZE_TABELLA_SEZIONE), il
          // conteggio delle righe non corrisponde al wrapping reale: osservato concretamente con
          // lo stile "bold" (più largo) che restava impostato dopo una cella di stato "X" nella
          // colonna N.P, causando un a-capo più aggressivo del necessario nella nota della riga
          // subito successiva. Impostare esplicitamente lo stesso font del disegno PRIMA di
          // calcolare le righe elimina la discrepanza indipendentemente da cosa sia stato
          // disegnato prima.
          doc.setFont(undefined, 'italic');
          doc.setFontSize(FONT_SIZE_TABELLA_SEZIONE);
          const righe = calcolaRigheNota(doc, data.cell.raw);
          data.cell.styles.minCellHeight = righe.length * altezzaRigaMm(doc) + PADDING_VERTICALE_NOTA * 2;
          data.cell._righeGiustificate = righe;
          data.cell.text = [];
        }
      },
      didDrawCell(data) {
        if (data.section === 'body' && data.column.index === 6) {
          disegnaNotaGiustificataCentrata(doc, data.cell);
        }
      },
      didDrawPage: hookLegenda
    });

    return doc.lastAutoTable.finalY + 4;
  }

  /**
   * Punto (indice 0-based) in cui dividere le sezioni della checklist nei due macro-gruppi:
   * prime N sezioni sotto "ANALISI DOCUMENTALE", le restanti sotto "SOPRALLUOGO AMBIENTI DI
   * LAVORO". Le tre checklist esistenti hanno tutte la stessa struttura a 9 sezioni (5+4): il
   * fallback (metà arrotondata per eccesso) riproduce esattamente questo split senza elencare i
   * titoli delle sezioni uno per uno (fragile: nemmeno scritti in modo uniforme tra le checklist,
   * es. tutto maiuscolo in Coin contro Title Case in Interparking/Restage). Una checklist con una
   * struttura diversa può impostare esplicitamente il campo "puntoDivisioneGruppi" nel proprio JSON.
   */
  function calcolaPuntoDivisioneGruppi(checklist) {
    const totale = checklist.sezioni.length;
    const configurato = checklist.puntoDivisioneGruppi;
    if (Number.isInteger(configurato) && configurato > 0 && configurato < totale) {
      return configurato;
    }
    return Math.ceil(totale / 2);
  }

  /** Disegna tutti i macro-gruppi di sezioni (con relative tabelle), coprendo sempre tutte le sezioni della checklist. */
  function disegnaGruppiSezioni(doc, checklist, sopralluogo, y, mappaFotoPerDomanda, hookLegenda) {
    const puntoDivisione = calcolaPuntoDivisioneGruppi(checklist);
    const gruppi = [
      { titolo: TITOLI_GRUPPI_SEZIONI[0], sezioni: checklist.sezioni.slice(0, puntoDivisione) },
      { titolo: TITOLI_GRUPPI_SEZIONI[1], sezioni: checklist.sezioni.slice(puntoDivisione) }
    ];

    gruppi.forEach((gruppo) => {
      if (!gruppo.sezioni.length) {
        return;
      }
      y = disegnaIntestazioneGruppo(doc, gruppo.titolo, y);
      gruppo.sezioni.forEach((sezione) => {
        y = disegnaTabellaSezione(doc, sezione, sopralluogo, y, mappaFotoPerDomanda, hookLegenda);
      });
    });

    return y;
  }

  /**
   * Pagina finale "ALTRI ASPETTI DA EVIDENZIARE": testo e relative immagini restano nello
   * stesso blocco, dopo la sezione delle fotografie numerate associate alle domande.
   */
  async function disegnaAltriAspetti(doc, sopralluogo, allegatiNote) {
    if (!sopralluogo.altri_aspetti && !allegatiNote.length) {
      return;
    }

    doc.addPage();
    let y = MARGINE;
    doc.setFontSize(14);
    doc.setFont(undefined, 'bold');
    doc.text('ALTRI ASPETTI DA EVIDENZIARE', MARGINE, y);
    doc.setFont(undefined, 'normal');
    y += 10;

    doc.setFontSize(10);
    if (sopralluogo.altri_aspetti) {
      const righe = avvolgiTesto(doc, sopralluogo.altri_aspetti, LARGHEZZA_PAGINA - MARGINE * 2);
      doc.text(righe, MARGINE, y);
      y += righe.length * 4.5 + 8;
    }

    await disegnaPaginaAllegati(doc, allegatiNote, {
      aggiungiPagina: false,
      yIniziale: y,
      titolo: null
    });
  }

  /**
   * Tronca un testo SOLO a un confine di parola intero (mai a metà parola come "per ev..."):
   * usata unicamente come rete di sicurezza in disegnaPaginaAllegati per una didascalia che,
   * anche testo per intero, non entrerebbe comunque nelle righe disponibili sotto la foto.
   */
  function troncaAConfineDiParola(testo, lunghezzaMassima) {
    const pulito = String(testo || '').replace(/\s+/g, ' ').trim();
    if (pulito.length <= lunghezzaMassima) {
      return pulito;
    }
    const tagliato = pulito.slice(0, Math.max(lunghezzaMassima, 0));
    const ultimoSpazio = tagliato.lastIndexOf(' ');
    return `${ultimoSpazio > 0 ? tagliato.slice(0, ultimoSpazio) : tagliato}…`;
  }

  /**
   * Raccoglie separatamente foto delle domande e allegati delle note aggiuntive: soltanto le
   * prime ricevono la numerazione progressiva usata dai riferimenti incrociati nelle tabelle.
   */
  function raccogliFotoConDidascalia(checklist, sopralluogo) {
    const domandeComplete = [];
    checklist.sezioni.forEach((sezione) => {
      sezione.domande.forEach((domanda) => {
        domandeComplete.push({ sezione: sezione.titolo, domanda });
      });
    });

    const fotoDomande = [];
    (sopralluogo.risposte || []).forEach((risposta) => {
      if (!risposta.foto || !risposta.foto.length) {
        return;
      }
      const info = domandeComplete.find((d) => d.domanda.id === risposta.domanda_id);
      risposta.foto.forEach((fotoId) => {
        fotoDomande.push({
          fotoId,
          domandaId: risposta.domanda_id,
          domandaTesto: info ? info.domanda.testo : ''
        });
      });
    });

    const didascalieAltriAspetti = sopralluogo.altri_aspetti_foto_didascalie || {};
    const allegatiNote = (sopralluogo.altri_aspetti_foto || [])
      .map((fotoId) => ({ fotoId, altriAspetti: true, didascaliaPersonalizzata: didascalieAltriAspetti[fotoId] || null }));
    return { fotoDomande, allegatiNote };
  }

  /**
   * Scarta riferimenti orfani storici prima di assegnare i numeri definitivi. Risolve ogni foto
   * con fotoSync.risolviFoto: locale se presente su questo dispositivo, altrimenti scaricata da
   * Supabase Storage se il sopralluogo ne ha un riferimento (foto scattata da un altro
   * dispositivo, vedi js/foto-sync.js). "sopralluogo" è facoltativo: senza, resta il solo
   * comportamento locale (usato dai test).
   */
  async function filtraFotoEsistenti(elenco, sopralluogo) {
    const risultato = [];
    for (const voce of elenco) {
      const record = await fotoSync.risolviFoto(voce.fotoId, sopralluogo);
      if (record) risultato.push({ ...voce, record });
    }
    return risultato;
  }

  /**
   * Mappa domandaId -> elenco di numeri di foto (1-based, stesso ordine/indice di elencoFoto),
   * per il riferimento incrociato "(Vedi Foto N)" nella colonna Note delle tabelle di sezione.
   */
  function costruisciMappaFotoPerDomanda(elencoFoto) {
    const mappa = new Map();
    elencoFoto.forEach((voce, indice) => {
      if (!mappa.has(voce.domandaId)) {
        mappa.set(voce.domandaId, []);
      }
      mappa.get(voce.domandaId).push(indice + 1);
    });
    return mappa;
  }

  /** Pagina "ALLEGATI": tutte le foto scattate durante il sopralluogo, in griglia con didascalia. */
  async function disegnaPaginaAllegati(doc, elencoFoto, opzioni = {}) {
    if (!elencoFoto.length) {
      return;
    }

    const aggiungiPagina = opzioni.aggiungiPagina !== false;
    if (aggiungiPagina) doc.addPage();
    let y = opzioni.yIniziale ?? MARGINE;
    const titoloPagina = opzioni.titolo === undefined ? 'ALLEGATI — FOTOGRAFIE' : opzioni.titolo;
    if (titoloPagina) {
      doc.setFontSize(14);
      doc.setFont(undefined, 'bold');
      doc.text(titoloPagina, MARGINE, y);
      doc.setFont(undefined, 'normal');
      y += 10;
    }

    const COLONNE = 2;
    const GAP = 6;
    const LARGHEZZA_CELLA = (LARGHEZZA_PAGINA - MARGINE * 2 - GAP * (COLONNE - 1)) / COLONNE;
    /**
     * La foto non occupa mai l'intera cella: un riquadro max (78% larghezza cella × 65mm
     * d'altezza) evita che le foto orizzontali risultino sproporzionatamente estese in una
     * griglia a 2 colonne. Le proporzioni originali sono sempre preservate (mai deformata) -
     * vedi lo stesso pattern di scala in disegnaLogoProporzionato più sopra.
     */
    const LARGHEZZA_MASSIMA_IMMAGINE = LARGHEZZA_CELLA * 0.78;
    const ALTEZZA_MASSIMA_IMMAGINE = 65;
    const MASSIMO_RIGHE_DIDASCALIA = 4;
    const ALTEZZA_DIDASCALIA = 4 + MASSIMO_RIGHE_DIDASCALIA * 3.5;
    const ALTEZZA_CELLA = ALTEZZA_MASSIMA_IMMAGINE + ALTEZZA_DIDASCALIA;

    let colonna = 0;

    for (const [indice, voce] of elencoFoto.entries()) {
      const record = voce.record || await fotoSync.risolviFoto(voce.fotoId);
      if (!record) {
        continue;
      }

      if (colonna === 0) {
        const yPrima = y;
        y = nuovaRigaSeNecessario(doc, y, ALTEZZA_CELLA + GAP);
        if (y !== yPrima) {
          if (titoloPagina) {
            doc.setFontSize(14);
            doc.setFont(undefined, 'bold');
            doc.text(`${titoloPagina} (segue)`, MARGINE, y);
            doc.setFont(undefined, 'normal');
            y += 10;
          }
        }
      }

      const x = MARGINE + colonna * (LARGHEZZA_CELLA + GAP);
      const dataURL = await blobADataURL(record.blob);
      const proprietaImmagine = doc.getImageProperties(dataURL);
      const scalaImmagine = Math.min(
        LARGHEZZA_MASSIMA_IMMAGINE / proprietaImmagine.width,
        ALTEZZA_MASSIMA_IMMAGINE / proprietaImmagine.height,
        1
      );
      const larghezzaImmagine = proprietaImmagine.width * scalaImmagine;
      const altezzaImmagine = proprietaImmagine.height * scalaImmagine;
      const xImmagine = x + (LARGHEZZA_CELLA - larghezzaImmagine) / 2;
      const yImmagine = y + (ALTEZZA_MASSIMA_IMMAGINE - altezzaImmagine) / 2;
      doc.addImage(dataURL, proprietaImmagine.fileType, xImmagine, yImmagine, larghezzaImmagine, altezzaImmagine);

      /**
       * Didascalia MAI troncata a metà parola: si prova prima il testo della domanda per
       * intero, andando su più righe (fino a MASSIMO_RIGHE_DIDASCALIA) invece di tagliarlo a un
       * numero fisso di caratteri. Solo se anche così non entrasse (domanda eccezionalmente
       * lunga) si accorcia il testo un pezzo alla volta, sempre e solo a un confine di parola,
       * finché non ci sta - non un taglio arbitrario indipendente dal font/dalla larghezza reale.
       */
      doc.setFontSize(8);
      let didascalia;
      if (voce.altriAspetti) {
        // Didascalia personalizzata scritta dall'utente (altriAspettiScreen in app.js) se
        // presente, altrimenti la generica "Foto N — Altri aspetti da evidenziare" come fallback.
        const testoDidascalia = voce.didascaliaPersonalizzata || `Foto ${indice + 1} — Altri aspetti da evidenziare`;
        didascalia = avvolgiTesto(doc, testoDidascalia, LARGHEZZA_CELLA);
        if (didascalia.length > MASSIMO_RIGHE_DIDASCALIA) {
          let lunghezzaMassima = testoDidascalia.length;
          do {
            lunghezzaMassima -= 10;
            const testoTroncato = troncaAConfineDiParola(testoDidascalia, lunghezzaMassima);
            didascalia = avvolgiTesto(doc, testoTroncato, LARGHEZZA_CELLA);
          } while (didascalia.length > MASSIMO_RIGHE_DIDASCALIA && lunghezzaMassima > 0);
        }
      } else {
        const prefisso = `Foto ${indice + 1} — Domanda ${voce.domandaId}: `;
        didascalia = avvolgiTesto(doc, `${prefisso}${voce.domandaTesto}`, LARGHEZZA_CELLA);
        if (didascalia.length > MASSIMO_RIGHE_DIDASCALIA) {
          let lunghezzaMassima = String(voce.domandaTesto || '').length;
          do {
            lunghezzaMassima -= 10;
            const domandaTroncata = troncaAConfineDiParola(voce.domandaTesto, lunghezzaMassima);
            didascalia = avvolgiTesto(doc, `${prefisso}${domandaTroncata}`, LARGHEZZA_CELLA);
          } while (didascalia.length > MASSIMO_RIGHE_DIDASCALIA && lunghezzaMassima > 0);
        }
      }
      if (didascalia.length) {
        doc.text(didascalia, x + LARGHEZZA_CELLA / 2, y + ALTEZZA_MASSIMA_IMMAGINE + 4, { align: 'center' });
      }

      colonna += 1;
      if (colonna >= COLONNE) {
        colonna = 0;
        y += ALTEZZA_CELLA + GAP;
      }
    }
  }

  /**
   * Unico punto che governa l'ordine fisico delle sezioni finali del PDF. Ogni funzione
   * sottostante esegue il proprio addPage soltanto se la relativa sezione esiste.
   */
  async function disegnaSezioniFinali(doc, sopralluogo, fotoDomande, allegatiNote) {
    await disegnaPaginaAllegati(doc, fotoDomande);
    await disegnaAltriAspetti(doc, sopralluogo, allegatiNote);
  }

  /**
   * Report segnaposto per checklist "stile": "raccolta-dati" (tipi di domanda eterogenei non
   * ancora supportati dal motore di compilazione né da un layout dedicato). Elenca id/testo
   * domanda e valore salvato in forma leggibile, qualunque sia il tipo (testo, numero, si-no,
   * scelta-singola, checkbox-multi con eventuali sotto-campi, gruppo-testo).
   */
  function formattaValoreRaccoltaDati(valore) {
    if (valore === null || valore === undefined || valore === '') {
      return '(non compilata)';
    }
    if (Array.isArray(valore)) {
      if (!valore.length) {
        return '(non compilata)';
      }
      return valore
        .map((v) => (v.sottoCampoValore ? `${v.label} (${v.sottoCampoValore})` : v.label))
        .join(', ');
    }
    if (typeof valore === 'object') {
      const parti = Object.entries(valore)
        .filter(([, v]) => v)
        .map(([chiave, v]) => `${chiave}: ${v}`);
      return parti.length ? parti.join('; ') : '(non compilata)';
    }
    return String(valore);
  }

  async function disegnaReportRaccoltaDati(doc, checklist, sopralluogo) {
    doc.setFontSize(10);
    let y = MARGINE + 5;
    doc.text(
      'Layout dedicato non ancora disponibile per questo tipo di checklist (dati grezzi qui sotto).',
      MARGINE,
      y
    );
    y += 10;

    checklist.sezioni.forEach((sezione) => {
      y = nuovaRigaSeNecessario(doc, y, 12);
      doc.setFontSize(11);
      doc.setFont(undefined, 'bold');
      doc.text(sezione.titolo, MARGINE, y);
      doc.setFont(undefined, 'normal');
      y += 6;

      sezione.domande.forEach((domanda) => {
        const risposta = (sopralluogo.risposte || []).find((r) => r.domanda_id === domanda.id);
        const valoreTesto = formattaValoreRaccoltaDati(risposta ? risposta.risposta : undefined);
        const notaTesto = risposta && risposta.note ? ` (Note: ${risposta.note})` : '';

        doc.setFontSize(9);
        const riga = avvolgiTesto(
          doc,
          `${domanda.testo}: ${valoreTesto}${notaTesto}`,
          LARGHEZZA_PAGINA - MARGINE * 2
        );
        y = nuovaRigaSeNecessario(doc, y, riga.length * 4.5 + 2);
        doc.text(riga, MARGINE, y);
        y += riga.length * 4.5;
      });
      y += 4;
    });

    const raccoltaFoto = raccogliFotoConDidascalia(checklist, sopralluogo);
    const fotoDomande = await filtraFotoEsistenti(raccoltaFoto.fotoDomande, sopralluogo);
    const allegatiNote = await filtraFotoEsistenti(raccoltaFoto.allegatiNote, sopralluogo);
    await disegnaSezioniFinali(doc, sopralluogo, fotoDomande, allegatiNote);

    return doc.output('blob');
  }

  /**
   * Genera il report PDF completo di un sopralluogo. `checklist` e `sopralluogo` sono dati puri
   * (anche di un sopralluogo storico, non necessariamente quello attivo nel motore).
   * Ritorna un Blob "application/pdf".
   */
  async function generaReport(checklist, sopralluogo) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });

    if (checklist.stile === 'raccolta-dati') {
      return disegnaReportRaccoltaDati(doc, checklist, sopralluogo);
    }

    const logoColligoURL = await ottieniLogoColligo();
    const logoClienteURL = await ottieniLogoCliente(checklist, sopralluogo.punto_vendita);

    const raccoltaFoto = raccogliFotoConDidascalia(checklist, sopralluogo);
    const fotoDomande = await filtraFotoEsistenti(raccoltaFoto.fotoDomande, sopralluogo);
    const allegatiNote = await filtraFotoEsistenti(raccoltaFoto.allegatiNote, sopralluogo);
    const mappaFotoPerDomanda = costruisciMappaFotoPerDomanda(fotoDomande);
    const tracciatoreLegenda = creaTracciatoreLegenda(doc);

    let y = disegnaIntestazione(doc, logoClienteURL, logoColligoURL);
    y = disegnaTabellaDatiGenerali(doc, checklist, sopralluogo, y, tracciatoreLegenda.hookDidDrawPage);
    disegnaGruppiSezioni(doc, checklist, sopralluogo, y, mappaFotoPerDomanda, tracciatoreLegenda.hookDidDrawPage);

    await disegnaSezioniFinali(doc, sopralluogo, fotoDomande, allegatiNote);

    // Rete di sicurezza per le pagine senza alcuna tabella (Altri aspetti, Allegati): l'hook
    // didDrawPage sopra copre già tutte le pagine toccate da DATI GENERALI o da una tabella di
    // sezione, questo completa solo quelle rimaste scoperte, senza mai ridisegnare le altre.
    tracciatoreLegenda.completaPagineRestanti();

    return doc.output('blob');
  }

  /** Nome file suggerito per il PDF (sanificato per download/condivisione). */
  function nomeFile(sopralluogo) {
    const base = `Sopralluogo_${sopralluogo.punto_vendita}_${(sopralluogo.data || '').slice(0, 10)}`;
    return `${base.replace(/[^a-z0-9_-]+/gi, '_')}.pdf`;
  }

  /** Salva/condivide il PDF: Web Share API con file se disponibile, altrimenti download diretto. */
  async function salvaOCondividi(blob, filename) {
    const file = new File([blob], filename, { type: 'application/pdf' });

    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: filename });
      return;
    }

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  return { generaReport, nomeFile, salvaOCondividi,
    _test: {
      raccogliFotoConDidascalia,
      costruisciMappaFotoPerDomanda,
      suffissoVediFoto,
      filtraFotoEsistenti,
      formattaTecnici,
      disegnaSezioniFinali
    }
  };
})();
