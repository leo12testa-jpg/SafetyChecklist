/**
 * Generazione del report PDF del sopralluogo con jsPDF (PROJECT.md §7.7): intestazione
 * azienda, dati sopralluogo, risposte per sezione, Non Conformità, pagina Allegati con
 * tutte le foto scattate, firma finale.
 */
const pdf = (() => {
  const MARGINE = 15;
  const LARGHEZZA_PAGINA = 210; // A4, mm
  const ALTEZZA_PAGINA = 297;

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

  async function ottieniLogoDataURL(azienda) {
    if (azienda && azienda.logo instanceof Blob) {
      return blobADataURL(azienda.logo);
    }
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

  function disegnaIntestazione(doc, logoDataURL, azienda, checklist) {
    doc.addImage(logoDataURL, 'PNG', MARGINE, MARGINE, 20, 20);

    doc.setFontSize(14);
    doc.setFont(undefined, 'bold');
    doc.text(azienda.nome || 'Safety Checklist', MARGINE + 25, MARGINE + 8);

    doc.setFontSize(10);
    doc.setFont(undefined, 'normal');
    if (azienda.indirizzo) {
      doc.text(azienda.indirizzo, MARGINE + 25, MARGINE + 14);
    }

    doc.setFontSize(16);
    doc.setFont(undefined, 'bold');
    doc.text(`Report Sopralluogo – ${checklist.titolo}`, MARGINE, MARGINE + 32);
    doc.setFont(undefined, 'normal');

    return MARGINE + 40;
  }

  /**
   * Tabella con i dati generali del sopralluogo. NOTA: layout provvisorio (tabella semplice
   * disegnata a mano) in attesa della specifica esatta del layout richiesto (autotable, colori,
   * disposizione punto 6 non ancora ricevuta per intero).
   */
  function disegnaTabellaSopralluogo(doc, sopralluogo, y) {
    const LARGHEZZA_ETICHETTA = 65;
    const LARGHEZZA_VALORE = LARGHEZZA_PAGINA - MARGINE * 2 - LARGHEZZA_ETICHETTA;
    const ALTEZZA_RIGA = 8;

    const righe = [
      ['Punto vendita', sopralluogo.punto_vendita || ''],
      ['Indirizzo punto vendita', sopralluogo.indirizzo_punto_vendita || ''],
      ['Numero di dipendenti in forza', sopralluogo.numero_dipendenti || ''],
      ['Tecnico che ha eseguito il sopralluogo', sopralluogo.tecnico || ''],
      ['Data del sopralluogo', formattaDataSemplice(sopralluogo.data_sopralluogo)],
      ['Responsabile del punto vendita', sopralluogo.responsabile_punto_vendita || ''],
      ['Presenza del responsabile del punto vendita?', sopralluogo.presenza_responsabile || ''],
      ["Presenza dell'R.L.S.?", sopralluogo.presenza_rls || '']
    ];

    doc.setFontSize(10);
    righe.forEach(([etichetta, valore]) => {
      y = nuovaRigaSeNecessario(doc, y, ALTEZZA_RIGA);

      doc.setFont(undefined, 'bold');
      doc.rect(MARGINE, y, LARGHEZZA_ETICHETTA, ALTEZZA_RIGA);
      doc.text(etichetta, MARGINE + 2, y + 5.5);

      doc.setFont(undefined, 'normal');
      doc.rect(MARGINE + LARGHEZZA_ETICHETTA, y, LARGHEZZA_VALORE, ALTEZZA_RIGA);
      doc.text(String(valore), MARGINE + LARGHEZZA_ETICHETTA + 2, y + 5.5);

      y += ALTEZZA_RIGA;
    });

    return y + 6;
  }

  function disegnaRiepilogoConteggi(doc, riepilogo, y) {
    doc.setFontSize(11);
    doc.setFont(undefined, 'bold');
    doc.text('Riepilogo', MARGINE, y);
    doc.setFont(undefined, 'normal');
    y += 6;

    const { conteggi, totale } = riepilogo;
    const testo = doc.splitTextToSize(
      `Totale domande: ${totale}   Conformi: ${conteggi.C}   Parz. conformi: ${conteggi.PC}   ` +
      `Non conformi: ${conteggi.NC}   Non applicabili: ${conteggi.NA}`,
      LARGHEZZA_PAGINA - MARGINE * 2
    );
    doc.text(testo, MARGINE, y);
    return y + testo.length * 5 + 6;
  }

  function disegnaRisposte(doc, checklist, sopralluogo, y) {
    doc.setFontSize(13);
    doc.setFont(undefined, 'bold');
    y = nuovaRigaSeNecessario(doc, y, 10);
    doc.text('Risposte per sezione', MARGINE, y);
    y += 8;

    checklist.sezioni.forEach((sezione) => {
      y = nuovaRigaSeNecessario(doc, y, 12);
      doc.setFontSize(12);
      doc.setFont(undefined, 'bold');
      doc.text(sezione.titolo, MARGINE, y);
      y += 6;

      sezione.domande.forEach((domanda) => {
        const risposta = (sopralluogo.risposte || []).find((r) => r.domanda_id === domanda.id);
        const valore = risposta ? risposta.risposta : '-';

        doc.setFontSize(10);
        doc.setFont(undefined, 'normal');
        const righeDomanda = avvolgiTesto(doc, domanda.testo, LARGHEZZA_PAGINA - MARGINE * 2);
        y = nuovaRigaSeNecessario(doc, y, righeDomanda.length * 5 + 7);
        doc.text(righeDomanda, MARGINE, y);
        y += righeDomanda.length * 5;

        doc.setFont(undefined, 'bold');
        doc.text(`Risposta: ${valore}`, MARGINE, y);
        doc.setFont(undefined, 'normal');
        y += 5;

        if (risposta && risposta.note) {
          doc.setFontSize(9);
          const nota = doc.splitTextToSize(`Note: ${risposta.note}`, LARGHEZZA_PAGINA - MARGINE * 2 - 4);
          y = nuovaRigaSeNecessario(doc, y, nota.length * 4.5 + 2);
          doc.text(nota, MARGINE + 4, y);
          y += nota.length * 4.5;
        }
      });
      y += 4;
    });

    return y;
  }

  function disegnaNonConformita(doc, nonConformita, y) {
    if (!nonConformita.length) {
      return y;
    }

    y = nuovaRigaSeNecessario(doc, y, 12);
    doc.setFontSize(13);
    doc.setFont(undefined, 'bold');
    doc.text('Non Conformità rilevate', MARGINE, y);
    y += 8;

    for (const nc of nonConformita) {
      y = nuovaRigaSeNecessario(doc, y, 14);
      doc.setFontSize(11);
      doc.setFont(undefined, 'bold');
      const intestazione = avvolgiTesto(doc, `${nc.sezione} – ${nc.testo}`, LARGHEZZA_PAGINA - MARGINE * 2);
      doc.text(intestazione, MARGINE, y);
      y += intestazione.length * 5;

      doc.setFontSize(10);
      doc.setFont(undefined, 'normal');
      const note = avvolgiTesto(doc, nc.note, LARGHEZZA_PAGINA - MARGINE * 2);
      y = nuovaRigaSeNecessario(doc, y, note.length * 5 + 2);
      doc.text(note, MARGINE, y);
      y += note.length * 5 + 4;
    }

    return y;
  }

  /** Raccoglie tutte le foto (di qualsiasi domanda, non solo NC) con didascalia per la pagina Allegati. */
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
          sezione: info ? info.sezione : risposta.sezione,
          domandaTesto: info ? info.domanda.testo : '',
          rispostaValore: risposta.risposta
        });
      });
    });

    return elenco;
  }

  /**
   * Pagina "ALLEGATI": tutte le foto scattate durante il sopralluogo, in griglia con didascalia.
   * Ritorna la y aggiornata (sulla nuova pagina), o la `y` originale invariata se non ci sono foto.
   */
  async function disegnaPaginaAllegati(doc, elencoFoto, y) {
    if (!elencoFoto.length) {
      return y;
    }

    doc.addPage();
    y = MARGINE;
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

    for (const voce of elencoFoto) {
      const record = await db.leggiFoto(voce.fotoId);
      if (!record) {
        continue;
      }

      if (colonna === 0) {
        const yPrima = y;
        y = nuovaRigaSeNecessario(doc, y, ALTEZZA_CELLA + GAP);
        if (y !== yPrima && y === MARGINE) {
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
        `${voce.sezione} – ${voce.domandaTesto} (${voce.rispostaValore})`,
        LARGHEZZA_CELLA
      ).slice(0, 2);
      doc.text(didascalia, x, y + ALTEZZA_IMMAGINE + 4);

      colonna += 1;
      if (colonna >= COLONNE) {
        colonna = 0;
        y += ALTEZZA_CELLA + GAP;
      }
    }

    return colonna === 0 ? y : y + ALTEZZA_CELLA + GAP;
  }

  /** Sezione "Altri aspetti da evidenziare" (facoltativa, compilata dopo l'ultima domanda). */
  function disegnaAltriAspetti(doc, sopralluogo, y) {
    if (!sopralluogo.altri_aspetti) {
      return y;
    }

    y = nuovaRigaSeNecessario(doc, y, 12);
    doc.setFontSize(13);
    doc.setFont(undefined, 'bold');
    doc.text('Altri aspetti da evidenziare', MARGINE, y);
    y += 8;

    doc.setFontSize(10);
    doc.setFont(undefined, 'normal');
    const righe = avvolgiTesto(doc, sopralluogo.altri_aspetti, LARGHEZZA_PAGINA - MARGINE * 2);
    y = nuovaRigaSeNecessario(doc, y, righe.length * 5 + 2);
    doc.text(righe, MARGINE, y);
    return y + righe.length * 5 + 6;
  }

  /** Disegna una singola firma (etichetta + immagine) e ritorna la y aggiornata. */
  function disegnaSingolaFirma(doc, etichetta, firmaDataURL, y) {
    y = nuovaRigaSeNecessario(doc, y, 45);
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

    return y + 6;
  }

  /** Le due firme richieste dal documento: Colligo Ingegneria e referente per la ricevuta. */
  function disegnaFirme(doc, sopralluogo, y) {
    y = disegnaSingolaFirma(doc, 'Firma Colligo Ingegneria S.r.l.', sopralluogo.firma_colligo, y);
    y = disegnaSingolaFirma(doc, 'Firma referente per la ricevuta', sopralluogo.firma_referente, y);
    return y;
  }

  /**
   * Genera il report PDF completo di un sopralluogo. `checklist` e `sopralluogo` sono dati puri
   * (anche di un sopralluogo storico, non necessariamente quello attivo nel motore).
   * Ritorna un Blob "application/pdf".
   */
  async function generaReport(checklist, sopralluogo) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });

    const azienda = (await db.leggiImpostazione('azienda')) || {};
    const logoDataURL = await ottieniLogoDataURL(azienda);
    const riepilogo = checklistEngine.calcolaRiepilogo(checklist, sopralluogo);

    let y = disegnaIntestazione(doc, logoDataURL, azienda, checklist);
    y = disegnaTabellaSopralluogo(doc, sopralluogo, y);
    y = disegnaRiepilogoConteggi(doc, riepilogo, y);
    y = disegnaRisposte(doc, checklist, sopralluogo, y);
    y = disegnaNonConformita(doc, riepilogo.nonConformita, y);
    y = disegnaAltriAspetti(doc, sopralluogo, y);

    const fotoAllegati = raccogliFotoConDidascalia(checklist, sopralluogo);
    y = await disegnaPaginaAllegati(doc, fotoAllegati, y);

    disegnaFirme(doc, sopralluogo, y);

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
