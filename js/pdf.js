/**
 * Generazione del report PDF del sopralluogo con jsPDF + jsPDF-AutoTable, secondo il layout
 * del report reale del cliente: doppio logo, tabella DATI GENERALI, sezioni raggruppate in
 * ANALISI DOCUMENTALE / SOPRALLUOGO AMBIENTI DI LAVORO con tabelle a colonne C/P.C/N.C/N.P,
 * legenda a fondo pagina, pagina Altri aspetti, pagina Allegati con foto in griglia, firme finali.
 *
 * NOTA: questo layout (gruppi, colonne, legenda) è disegnato per checklist "a stato" del tipo
 * C-PC-NC-NA (es. people_design). Checklist con "stile": "raccolta-dati" (es. aggiornamento_dvr_pem)
 * hanno domande con tipi eterogenei (si-no, numero, testo, checkbox-multi...) non ancora supportati
 * né dal motore di compilazione né da questo report: per queste, generaReport produce un report
 * minimale segnaposto (vedi disegnaReportRaccoltaDati) finché non sarà definito il layout dedicato.
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

  async function caricaImmagineComeDataURL(url) {
    const response = await fetch(url);
    const blob = await response.blob();
    return blobADataURL(blob);
  }

  /** Logo del punto vendita/cliente (da Impostazioni). Nessun fallback: se assente, l'intestazione mostra solo il logo Colligo. */
  async function ottieniLogoPuntoVendita(azienda) {
    if (azienda && azienda.logo instanceof Blob) {
      return blobADataURL(azienda.logo);
    }
    return null;
  }

  /** Logo fisso di Colligo Ingegneria (assets/logo.png), sempre presente in intestazione. */
  async function ottieniLogoColligo() {
    return caricaImmagineComeDataURL('assets/logo.png');
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

  /** Intestazione con doppio logo affiancato (punto vendita a sinistra, Colligo Ingegneria a destra) e titolo checklist. */
  function disegnaIntestazione(doc, logoPuntoVenditaURL, logoColligoURL, checklist) {
    const DIM_LOGO = 22;

    if (logoPuntoVenditaURL) {
      doc.addImage(logoPuntoVenditaURL, 'PNG', MARGINE, MARGINE, DIM_LOGO, DIM_LOGO);
    }
    doc.addImage(logoColligoURL, 'PNG', LARGHEZZA_PAGINA - MARGINE - DIM_LOGO, MARGINE, DIM_LOGO, DIM_LOGO);

    doc.setFontSize(15);
    doc.setFont(undefined, 'bold');
    doc.text(checklist.titolo, LARGHEZZA_PAGINA / 2, MARGINE + DIM_LOGO / 2 + 3, { align: 'center' });
    doc.setFont(undefined, 'normal');

    return MARGINE + DIM_LOGO + 8;
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

  /** Disegna una singola firma (etichetta + immagine) e ritorna la y aggiornata. */
  function disegnaSingolaFirma(doc, etichetta, firmaDataURL, y) {
    doc.setFontSize(11);
    doc.setFont(undefined, 'bold');
    doc.text(etichetta, MARGINE, y);
    y += 4;

    if (firmaDataURL) {
      doc.addImage(firmaDataURL, 'PNG', MARGINE, y, 60, 30);
      y += 32;
    } else {
      y += 6;
    }

    return y + 10;
  }

  /** Pagina dedicata alle due firme richieste: Colligo Ingegneria e referente per la ricevuta. */
  function disegnaFirme(doc, sopralluogo) {
    doc.addPage();
    let y = MARGINE;
    doc.setFontSize(14);
    doc.setFont(undefined, 'bold');
    doc.text('FIRME', MARGINE, y);
    doc.setFont(undefined, 'normal');
    y += 12;

    y = disegnaSingolaFirma(doc, 'Firma Colligo Ingegneria S.r.l.', sopralluogo.firma_colligo, y);
    disegnaSingolaFirma(doc, 'Firma referente per la ricevuta', sopralluogo.firma_referente, y);
  }

  /**
   * Report segnaposto per checklist "stile": "raccolta-dati" (tipi di domanda eterogenei non
   * ancora supportati dal motore di compilazione né da un layout dedicato). Elenca semplicemente
   * id/testo domanda e l'eventuale nota salvata, così il PDF resta generabile senza errori.
   */
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
        doc.setFontSize(9);
        const riga = avvolgiTesto(
          doc,
          `${domanda.testo} — ${risposta ? (risposta.note || JSON.stringify(risposta)) : '(non compilata)'}`,
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

    const azienda = (await db.leggiImpostazione('azienda')) || {};
    const logoPuntoVenditaURL = await ottieniLogoPuntoVendita(azienda);
    const logoColligoURL = await ottieniLogoColligo();

    let y = disegnaIntestazione(doc, logoPuntoVenditaURL, logoColligoURL, checklist);
    y = disegnaTabellaDatiGenerali(doc, sopralluogo, y);
    disegnaGruppiSezioni(doc, checklist, sopralluogo, y);

    disegnaAltriAspetti(doc, sopralluogo);

    const fotoAllegati = raccogliFotoConDidascalia(checklist, sopralluogo);
    await disegnaPaginaAllegati(doc, fotoAllegati);

    disegnaFirme(doc, sopralluogo);

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
