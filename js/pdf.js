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

  const GRUPPI_SEZIONI = [
    {
      titolo: 'ANALISI DOCUMENTALE',
      sezioni: [
        'Adempimenti Formali',
        'Documento di Valutazione del Rischio',
        "Gestione dell'Emergenza",
        'Attività di Formazione',
        'Documentazione Procedurale'
      ]
    },
    {
      titolo: 'SOPRALLUOGO AMBIENTI DI LAVORO',
      sezioni: [
        'Antincendio / Mezzi di Emergenza e Cartellonistica',
        'Vie di Esodo',
        'Locali di Lavoro / Struttura',
        'Macchine / Attrezzature'
      ]
    }
  ];

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
   * Logo fisso di Colligo Ingegneria, bundled nell'app (assets/logo_colligo.webp). Se non si
   * carica, l'errore viene registrato esplicitamente in console e il logo viene omesso invece
   * di far fallire l'intera generazione del PDF.
   */
  async function ottieniLogoColligo() {
    try {
      return await caricaLogo('assets/logo_colligo.webp');
    } catch (errore) {
      console.error('[pdf.js] Logo Colligo Ingegneria non caricato:', errore);
      return null;
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

  /** Intestazione con doppio logo affiancato (Colligo Ingegneria a sinistra, cliente a destra), proporzioni originali mantenute, e titolo checklist. */
  function disegnaIntestazione(doc, logoClienteURL, logoColligoURL, checklist) {
    const LARGHEZZA_MAX_LOGO = 40;
    const ALTEZZA_MAX_LOGO = 15;

    disegnaLogoProporzionato(doc, logoColligoURL, 'sinistra', LARGHEZZA_MAX_LOGO, ALTEZZA_MAX_LOGO);

    // DEBUG TEMPORANEO: da rimuovere una volta confermato che il logo cliente compare in produzione.
    console.warn('[pdf.js][DEBUG] logo cliente:', {
      checklistId: checklist.id,
      checklistTitolo: checklist.titolo,
      logoClienteURL_presente: !!logoClienteURL,
      logoClienteURL_anteprima: logoClienteURL ? logoClienteURL.slice(0, 40) + '…' : null
    });
    disegnaLogoProporzionato(doc, logoClienteURL, 'destra', LARGHEZZA_MAX_LOGO, ALTEZZA_MAX_LOGO);

    doc.setFontSize(15);
    doc.setFont(undefined, 'bold');
    doc.text(checklist.titolo, LARGHEZZA_PAGINA / 2, MARGINE + ALTEZZA_MAX_LOGO / 2 + 3, { align: 'center' });
    doc.setFont(undefined, 'normal');

    return MARGINE + ALTEZZA_MAX_LOGO + 8;
  }

  /** Tabella "DATI GENERALI": titolo su sfondo arancione, righe con bordi neri. */
  function disegnaTabellaDatiGenerali(doc, sopralluogo, y) {
    const puntoVendita = `${sopralluogo.punto_vendita || ''}\n${sopralluogo.indirizzo_punto_vendita || ''}`;

    const corpo = [
      ['Punto vendita', puntoVendita],
      ['Numero di dipendenti in forza al momento del sopralluogo', String(sopralluogo.numero_dipendenti || '')],
      ['Tecnico che ha eseguito il sopralluogo', sopralluogo.tecnico || ''],
      ['Data del sopralluogo', formattaDataSemplice(sopralluogo.data_sopralluogo)],
      ['Responsabile del punto vendita', sopralluogo.responsabile_punto_vendita || ''],
      ['Sopralluogo alla presenza del responsabile del punto vendita', sopralluogo.presenza_responsabile || ''],
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
      columnStyles: { 0: { fontStyle: 'bold', cellWidth: 65 }, 1: { cellWidth: 'auto' } }
    });

    return doc.lastAutoTable.finalY + 8;
  }

  /** Bandiera blu a piena larghezza con il titolo del macro-gruppo (ANALISI DOCUMENTALE / SOPRALLUOGO AMBIENTI DI LAVORO). */
  function disegnaIntestazioneGruppo(doc, titolo, y) {
    y = nuovaRigaSeNecessario(doc, y, 14);
    doc.setFillColor(35, 65, 125);
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
    2: [0, 140, 60], // C - verde
    3: [230, 140, 0], // P.C - arancione
    4: [200, 30, 30], // N.C - rosso
    5: [0, 0, 0] // N.P - nero (colore testo standard)
  };

  /** Tabella di una singola sezione: n., Descrizione attività, colonne di stato C/P.C/N.C/N.P, Note. */
  function disegnaTabellaSezione(doc, sezione, sopralluogo, y) {
    y = nuovaRigaSeNecessario(doc, y, 16);
    doc.setFontSize(10);
    doc.setFont(undefined, 'bold');
    doc.text(sezione.titolo, MARGINE, y);
    doc.setFont(undefined, 'normal');
    y += 5;

    const corpo = sezione.domande.map((domanda) => {
      const risposta = (sopralluogo.risposte || []).find((r) => r.domanda_id === domanda.id);
      const valore = risposta ? risposta.risposta : '';
      return [
        domanda.id,
        domanda.testo,
        segnoRisposta(valore, 'C'),
        segnoRisposta(valore, 'PC'),
        segnoRisposta(valore, 'NC'),
        segnoRisposta(valore, 'NA'),
        (risposta && risposta.note) || ''
      ];
    });

    doc.autoTable({
      startY: y,
      margin: { left: MARGINE, right: MARGINE },
      head: [['n.', 'Descrizione attività', 'C', 'P.C', 'N.C', 'N.P', 'Note']],
      body: corpo,
      theme: 'grid',
      styles: { lineColor: [0, 0, 0], lineWidth: 0.2, fontSize: 7.5, cellPadding: 1.5, valign: 'middle', textColor: [0, 0, 0] },
      headStyles: { fillColor: [225, 225, 225], textColor: [0, 0, 0], fontStyle: 'bold', halign: 'center', fontSize: 7.5 },
      columnStyles: {
        0: { cellWidth: 10, halign: 'center' },
        1: { cellWidth: 65 },
        2: { cellWidth: 10, halign: 'center' },
        3: { cellWidth: 10, halign: 'center' },
        4: { cellWidth: 10, halign: 'center' },
        5: { cellWidth: 10, halign: 'center' },
        6: { cellWidth: 65 }
      },
      didParseCell(data) {
        if (data.section !== 'body' || data.cell.raw !== 'X') {
          return;
        }
        const colore = COLORE_COLONNA_STATO[data.column.index];
        if (colore) {
          data.cell.styles.textColor = colore;
          data.cell.styles.fontStyle = 'bold';
        }
      }
    });

    return doc.lastAutoTable.finalY + 4;
  }

  /**
   * Disegna tutti i macro-gruppi di sezioni (con relative tabelle). Eventuali sezioni della
   * checklist non incluse in nessun gruppo vengono comunque stampate sotto "ALTRE SEZIONI",
   * per non perdere silenziosamente dati non previsti dalla mappatura.
   */
  function disegnaGruppiSezioni(doc, checklist, sopralluogo, y) {
    const titoliMappati = GRUPPI_SEZIONI.flatMap((g) => g.sezioni);

    GRUPPI_SEZIONI.forEach((gruppo) => {
      const sezioniGruppo = checklist.sezioni.filter((s) => gruppo.sezioni.includes(s.titolo));
      if (!sezioniGruppo.length) {
        return;
      }
      y = disegnaIntestazioneGruppo(doc, gruppo.titolo, y);
      sezioniGruppo.forEach((sezione) => {
        y = disegnaTabellaSezione(doc, sezione, sopralluogo, y);
      });
    });

    const sezioniNonMappate = checklist.sezioni.filter((s) => !titoliMappati.includes(s.titolo));
    if (sezioniNonMappate.length) {
      y = disegnaIntestazioneGruppo(doc, 'ALTRE SEZIONI', y);
      sezioniNonMappate.forEach((sezione) => {
        y = disegnaTabellaSezione(doc, sezione, sopralluogo, y);
      });
    }

    return y;
  }

  /** Legenda dei codici di stato, ripetuta a fondo pagina su ogni pagina del PDF. */
  function aggiungiLegendaSuOgniPagina(doc) {
    const numeroPagine = doc.internal.getNumberOfPages();
    for (let i = 1; i <= numeroPagine; i += 1) {
      doc.setPage(i);
      doc.setFontSize(7.5);
      doc.setFont(undefined, 'italic');
      doc.text(LEGENDA, MARGINE, ALTEZZA_PAGINA - 8);
      doc.setFont(undefined, 'normal');
    }
  }

  /** Pagina dedicata "ALTRI ASPETTI DA EVIDENZIARE" (facoltativa, compilata dopo l'ultima domanda). */
  function disegnaAltriAspetti(doc, sopralluogo) {
    if (!sopralluogo.altri_aspetti) {
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
    const righe = avvolgiTesto(doc, sopralluogo.altri_aspetti, LARGHEZZA_PAGINA - MARGINE * 2);
    doc.text(righe, MARGINE, y);
  }

  /** Tronca un testo a `lunghezzaMassima` caratteri (normalizzando gli a-capo in spazi) aggiungendo "…" se tagliato. */
  function troncaTesto(testo, lunghezzaMassima = 55) {
    const pulito = String(testo || '').replace(/\s+/g, ' ').trim();
    return pulito.length > lunghezzaMassima ? `${pulito.slice(0, lunghezzaMassima)}...` : pulito;
  }

  /** Raccoglie tutte le foto (di qualsiasi domanda, qualsiasi stile di checklist) con id/testo domanda per la pagina Allegati. */
  function raccogliFotoConDidascalia(checklist, sopralluogo) {
    const domandeComplete = [];
    checklist.sezioni.forEach((sezione) => {
      sezione.domande.forEach((domanda) => {
        domandeComplete.push({ sezione: sezione.titolo, domanda });
      });
    });

    const elenco = [];
    (sopralluogo.risposte || []).forEach((risposta) => {
      if (!risposta.foto || !risposta.foto.length) {
        return;
      }
      const info = domandeComplete.find((d) => d.domanda.id === risposta.domanda_id);
      risposta.foto.forEach((fotoId) => {
        elenco.push({
          fotoId,
          domandaId: risposta.domanda_id,
          domandaTesto: info ? info.domanda.testo : ''
        });
      });
    });

    return elenco;
  }

  /** Pagina "ALLEGATI": tutte le foto scattate durante il sopralluogo, in griglia con didascalia. */
  async function disegnaPaginaAllegati(doc, elencoFoto) {
    if (!elencoFoto.length) {
      return;
    }

    doc.addPage();
    let y = MARGINE;
    doc.setFontSize(14);
    doc.setFont(undefined, 'bold');
    doc.text('ALLEGATI', MARGINE, y);
    doc.setFont(undefined, 'normal');
    y += 10;

    const COLONNE = 2;
    const GAP = 6;
    const LARGHEZZA_CELLA = (LARGHEZZA_PAGINA - MARGINE * 2 - GAP * (COLONNE - 1)) / COLONNE;
    const ALTEZZA_IMMAGINE = 55;
    const ALTEZZA_CELLA = ALTEZZA_IMMAGINE + 14;

    let colonna = 0;

    for (const [indice, voce] of elencoFoto.entries()) {
      const record = await db.leggiFoto(voce.fotoId);
      if (!record) {
        continue;
      }

      if (colonna === 0) {
        const yPrima = y;
        y = nuovaRigaSeNecessario(doc, y, ALTEZZA_CELLA + GAP);
        if (y !== yPrima) {
          doc.setFontSize(14);
          doc.setFont(undefined, 'bold');
          doc.text('ALLEGATI (segue)', MARGINE, y);
          doc.setFont(undefined, 'normal');
          y += 10;
        }
      }

      const x = MARGINE + colonna * (LARGHEZZA_CELLA + GAP);
      const dataURL = await blobADataURL(record.blob);
      doc.addImage(dataURL, 'JPEG', x, y, LARGHEZZA_CELLA, ALTEZZA_IMMAGINE);

      doc.setFontSize(8);
      const didascalia = avvolgiTesto(
        doc,
        `Foto ${indice + 1} – Domanda ${voce.domandaId}: ${troncaTesto(voce.domandaTesto)}`,
        LARGHEZZA_CELLA
      ).slice(0, 2);
      doc.text(didascalia, x, y + ALTEZZA_IMMAGINE + 4);

      colonna += 1;
      if (colonna >= COLONNE) {
        colonna = 0;
        y += ALTEZZA_CELLA + GAP;
      }
    }
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
    doc.setFontSize(16);
    doc.setFont(undefined, 'bold');
    doc.text(checklist.titolo, MARGINE, MARGINE + 5);
    doc.setFont(undefined, 'normal');

    doc.setFontSize(10);
    let y = MARGINE + 16;
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

    const fotoAllegati = raccogliFotoConDidascalia(checklist, sopralluogo);
    await disegnaPaginaAllegati(doc, fotoAllegati);

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

    let y = disegnaIntestazione(doc, logoClienteURL, logoColligoURL, checklist);
    y = disegnaTabellaDatiGenerali(doc, sopralluogo, y);
    disegnaGruppiSezioni(doc, checklist, sopralluogo, y);

    disegnaAltriAspetti(doc, sopralluogo);

    const fotoAllegati = raccogliFotoConDidascalia(checklist, sopralluogo);
    await disegnaPaginaAllegati(doc, fotoAllegati);

    aggiungiLegendaSuOgniPagina(doc);

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

  return { generaReport, nomeFile, salvaOCondividi };
})();
