/**
 * Generazione del report PDF del sopralluogo con jsPDF (PROJECT.md §7.7): intestazione
 * azienda, dati sopralluogo, risposte per sezione, dettaglio NC con foto, firma finale.
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

  function formattaData(iso) {
    return new Date(iso).toLocaleDateString('it-IT');
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

  function disegnaDatiSopralluogo(doc, sopralluogo, y) {
    doc.setFontSize(11);
    [
      `Cliente: ${sopralluogo.cliente}`,
      `Sede: ${sopralluogo.sede}`,
      `Tecnico: ${sopralluogo.tecnico}`,
      `Data: ${formattaData(sopralluogo.data)}`
    ].forEach((riga) => {
      doc.text(riga, MARGINE, y);
      y += 6;
    });
    return y + 4;
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
        const testo = doc.splitTextToSize(`${domanda.testo}: ${valore}`, LARGHEZZA_PAGINA - MARGINE * 2);
        y = nuovaRigaSeNecessario(doc, y, testo.length * 5 + 2);
        doc.text(testo, MARGINE, y);
        y += testo.length * 5;

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

  async function disegnaFoto(doc, fotoIds, y) {
    const LARGHEZZA_FOTO = 40;
    const ALTEZZA_FOTO = 30;
    let x = MARGINE;
    y = nuovaRigaSeNecessario(doc, y, ALTEZZA_FOTO + 5);

    for (const fotoId of fotoIds) {
      const record = await db.leggiFoto(fotoId);
      if (!record) {
        continue;
      }
      if (x + LARGHEZZA_FOTO > LARGHEZZA_PAGINA - MARGINE) {
        x = MARGINE;
        y += ALTEZZA_FOTO + 5;
        y = nuovaRigaSeNecessario(doc, y, ALTEZZA_FOTO + 5);
      }
      const dataURL = await blobADataURL(record.blob);
      doc.addImage(dataURL, 'JPEG', x, y, LARGHEZZA_FOTO, ALTEZZA_FOTO);
      x += LARGHEZZA_FOTO + 5;
    }

    return y + ALTEZZA_FOTO + 6;
  }

  async function disegnaNonConformita(doc, nonConformita, y) {
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
      doc.text(`${nc.sezione} – Priorità: ${nc.priorita}`, MARGINE, y);
      y += 6;

      doc.setFontSize(10);
      doc.setFont(undefined, 'normal');
      const descrizione = doc.splitTextToSize(nc.descrizione, LARGHEZZA_PAGINA - MARGINE * 2);
      y = nuovaRigaSeNecessario(doc, y, descrizione.length * 5 + 2);
      doc.text(descrizione, MARGINE, y);
      y += descrizione.length * 5;

      if (nc.scadenza) {
        y = nuovaRigaSeNecessario(doc, y, 6);
        doc.text(`Scadenza: ${nc.scadenza}`, MARGINE, y);
        y += 6;
      }

      if (nc.foto && nc.foto.length) {
        y = await disegnaFoto(doc, nc.foto, y);
      }

      y += 4;
    }

    return y;
  }

  function disegnaFirma(doc, firmaDataURL, sopralluogo, y) {
    y = nuovaRigaSeNecessario(doc, y, 45);
    doc.setFontSize(12);
    doc.setFont(undefined, 'bold');
    doc.text('Firma', MARGINE, y);
    y += 4;

    if (firmaDataURL) {
      doc.addImage(firmaDataURL, 'PNG', MARGINE, y, 60, 30);
      y += 32;
    }

    doc.setFontSize(10);
    doc.setFont(undefined, 'normal');
    doc.text(sopralluogo.tecnico || '', MARGINE, y);
    return y + 6;
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
    y = disegnaDatiSopralluogo(doc, sopralluogo, y);
    y = disegnaRiepilogoConteggi(doc, riepilogo, y);
    y = disegnaRisposte(doc, checklist, sopralluogo, y);
    y = await disegnaNonConformita(doc, riepilogo.nonConformita, y);
    disegnaFirma(doc, sopralluogo.firma, sopralluogo, y);

    return doc.output('blob');
  }

  /** Nome file suggerito per il PDF (sanificato per download/condivisione). */
  function nomeFile(sopralluogo) {
    const base = `Sopralluogo_${sopralluogo.cliente}_${sopralluogo.sede}_${(sopralluogo.data || '').slice(0, 10)}`;
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
