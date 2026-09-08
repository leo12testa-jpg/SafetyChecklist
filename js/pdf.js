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
 *
 * ARCHITETTURA (motore unico per tutti i clienti, introdotta per eliminare i fix sparsi per
 * singolo cliente che si erano accumulati su loghi/footer/salti pagina):
 * - CONFIG_CLIENTI: unica fonte di verità per logo/colore banner/eventuali proprietà PDF future
 *   di ciascun cliente. Aggiungere un cliente = aggiungere UNA voce qui, mai un if/else nel
 *   resto del file.
 * - LAYOUT (vedi creaLayout): unica fonte di verità per margini/dimensioni pagina/spazi fra
 *   blocchi, sempre derivata da doc.internal.pageSize, mai coordinate magiche sparse.
 * - assicuraSpazio: unico guard per i salti pagina, usato con l'altezza REALE del blocco che
 *   deve restare unito (titolo+prima riga, foto+didascalia, ecc.), non con altezze arbitrarie.
 * - disegnaHeader / disegnaFooter / disegnaNumeriPagina: unico punto per ciascuna delle tre
 *   responsabilità, nessuna duplicazione di logica.
 */
const pdf = (() => {
  /**
   * Configurazione di un cliente: logo di intestazione, colore della bandiera dei macro-gruppi,
   * ed eventuali proprietà PDF specifiche future (oggi vuoto per tutti: nessun override esiste
   * ancora, ma la struttura è pronta ad accoglierne senza richiedere nuovi if/else altrove — un
   * consumatore futuro leggerebbe semplicemente configCliente.pdf.qualcosa con un fallback,
   * esattamente come già avviene per logo.larghezzaMax/altezzaMax).
   *
   * "match" è la sotto-stringa (case-insensitive) cercata in `${checklist.id} ${checklist.titolo}`
   * per risolvere quale configurazione si applica a una checklist — vedi risolviConfigCliente.
   * Per i loghi già ritagliati sul contenuto reale (es. Melluso: scritta orizzontale molto più
   * larga che alta, non un quadrato) larghezzaMax/altezzaMax vanno specificati esplicitamente;
   * altrimenti si applica il default condiviso (vedi LAYOUT.logoClienteDefault in creaLayout).
   */
  const CONFIG_CLIENTI = {
    coin: {
      match: 'coin',
      logo: { file: 'assets/logo_coin.webp' },
      coloreBanner: { sfondo: [43, 43, 43] }, // #2b2b2b, grigio scuro Coin
      pdf: {}
    },
    interparking: {
      match: 'interparking',
      logo: { file: 'assets/logo_interparking.webp' },
      // accento: sottile riga sul bordo inferiore della bandiera, usata solo dove il colore
      // secondario del logo non è adatto come sfondo pieno (contrasto insufficiente col testo
      // bianco, qui il giallo Interparking) — mai come bordo laterale.
      coloreBanner: { sfondo: [0, 58, 114], accento: [255, 220, 69] }, // #003a72 + #ffdc45
      pdf: {}
    },
    restage: {
      match: 'restage',
      logo: { file: 'assets/logo_restage.png' },
      coloreBanner: { sfondo: [28, 66, 36] }, // #1c4224, verde Restage
      pdf: {}
    },
    melluso: {
      match: 'melluso',
      // Logo già ritagliato sul contenuto reale (la scritta "Melluso" è una striscia
      // orizzontale molto più larga che alta, non un quadrato): larghezzaMax è il vincolo che
      // determina la dimensione finale, altezzaMax è volutamente larga per non essere lei il
      // fattore limitante (altrimenti il logo resterebbe piccolo come con un vecchio file
      // quadrato pieno di spazio trasparente).
      logo: { file: 'assets/logo_melluso.png', larghezzaMax: 35, altezzaMax: 10 },
      coloreBanner: { sfondo: [200, 2, 52] }, // #c80234, rosso Melluso
      pdf: {}
    }
  };

  /** Colore di sfondo della bandiera per checklist non associate a nessun cliente in CONFIG_CLIENTI. */
  const COLORE_BANNER_DEFAULT = { sfondo: [74, 122, 181] }; // #4a7ab5, blu originale

  const TITOLI_GRUPPI_SEZIONI = ['ANALISI DOCUMENTALE', 'SOPRALLUOGO AMBIENTI DI LAVORO'];

  const LEGENDA = 'C = Conforme;   P.C = Parzialmente conforme;   N.C = Non conforme;   N.P = Non pertinente';

  /**
   * Layout del documento: unica fonte di verità per margini, dimensioni pagina e spazi fra
   * blocchi. larghezzaPagina/altezzaPagina sono SEMPRE lette da doc.internal.pageSize (mai
   * hardcoded a 210×297): se in futuro cambiasse il formato pagina, tutto il file si adatta da
   * solo, senza coordinate magiche sparse da correggere una per una.
   */
  function creaLayout(doc) {
    const altezzaPagina = doc.internal.pageSize.getHeight();
    return {
      larghezzaPagina: doc.internal.pageSize.getWidth(),
      altezzaPagina,
      margine: 15,
      // Il numero di pagina nel footer va volutamente più vicino al bordo fisico destro rispetto
      // al margine generale usato per il resto del documento: un margine dedicato, più stretto,
      // solo per questo testo.
      margineNumeroPagina: 7,
      // Riga unica di testo del footer (legenda a sinistra, numero pagina a destra): stessa y per
      // entrambi, così restano sempre allineati sulla stessa riga in fondo alla pagina.
      yFooter: altezzaPagina - 8,
      logoClienteDefault: { larghezzaMax: 40, altezzaMax: 15 },
      gapDopoHeader: 8,
      gapDopoTabellaDatiGenerali: 8,
      gapDopoTabellaSezione: 4,
      bannerGruppo: { altezza: 9, altezzaAccento: 1.2, gapDopo: 5 }
    };
  }

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
   * Risolve la configurazione cliente (CONFIG_CLIENTI) applicabile a una checklist, cercando
   * "match" come sotto-stringa case-insensitive in `id + titolo`: identificatori stabili, sempre
   * presenti e univocamente legati a un cliente in checklists/clients.json — non il testo libero
   * "Punto vendita", che l'utente digita liberamente e può non contenere affatto il nome del
   * cliente. Ritorna null se nessuna configurazione corrisponde (checklist non ancora associata a
   * un cliente noto): loghi e colore bandiera useranno i rispettivi default.
   */
  function risolviConfigCliente(checklist) {
    const riferimento = `${checklist.id || ''} ${checklist.titolo || ''}`.toLowerCase();
    const chiave = Object.keys(CONFIG_CLIENTI).find((k) => riferimento.includes(CONFIG_CLIENTI[k].match));
    return chiave ? CONFIG_CLIENTI[chiave] : null;
  }

  /**
   * Logo del cliente corrispondente alla checklist del sopralluogo, secondo CONFIG_CLIENTI. Se la
   * checklist non corrisponde a nessun cliente configurato, ritorna null (l'intestazione non
   * mostra nulla a destra, nessun placeholder rotto) e lo segnala con un console.warn per poterlo
   * individuare in futuro. Se il file è previsto ma non si riesce a caricare, l'errore viene
   * registrato esplicitamente in console (non fallisce silenziosamente) e il logo viene comunque
   * omesso, senza far fallire l'intera generazione del PDF per un asset mancante.
   */
  async function ottieniLogoCliente(configCliente, checklist, puntoVendita, layout) {
    if (!configCliente) {
      console.warn(`[pdf.js] Nessun logo cliente associato alla checklist "${checklist.id}" (titolo: "${checklist.titolo}", Punto vendita: "${puntoVendita || ''}"). Intestazione senza logo a destra.`);
      return null;
    }
    const dimensione = {
      larghezzaMax: configCliente.logo.larghezzaMax || layout.logoClienteDefault.larghezzaMax,
      altezzaMax: configCliente.logo.altezzaMax || layout.logoClienteDefault.altezzaMax
    };
    try {
      const url = await caricaLogo(configCliente.logo.file);
      return { url, ...dimensione };
    } catch (errore) {
      console.error(`[pdf.js] Logo cliente non caricato (${configCliente.logo.file}) per checklist "${checklist.id}" (Punto vendita: "${puntoVendita || ''}"):`, errore);
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

  /**
   * Unico guard anti-salto-pagina: va a pagina nuova se il BLOCCO che deve restare unito (non una
   * singola riga) non ci sta più nello spazio verticale residuo. `altezzaBlocco` deve essere
   * l'altezza reale dell'intero blocco che non va spezzato — es. titolo di un gruppo di sezioni +
   * lo spazio minimo della prima riga di tabella che segue, oppure una foto + la sua didascalia —
   * non un valore arbitrario indipendente dal contenuto: usarla con un'altezza sottostimata
   * vanifica la garanzia "mai un titolo/blocco orfano in fondo pagina". Ritorna la y aggiornata.
   */
  function assicuraSpazio(doc, layout, y, altezzaBlocco = 10) {
    if (y + altezzaBlocco > layout.altezzaPagina - layout.margine) {
      doc.addPage();
      return layout.margine;
    }
    return y;
  }

  /**
   * Disegna un blocco di testo già suddiviso in righe (vedi avvolgiTesto), andando a capo pagina
   * automaticamente quando serve — riga per riga, mai spezzando un a-capo pagina a metà di una
   * riga né sovrapponendo testo al footer: ogni riga passa da assicuraSpazio prima di essere
   * disegnata. Usata per note libere potenzialmente molto lunghe (es. "Altri aspetti da
   * evidenziare"), che a differenza delle tabelle di sezione non hanno un meccanismo nativo di
   * autoTable per continuare pulite sulla pagina successiva.
   */
  function disegnaTestoImpaginato(doc, layout, righe, x, yIniziale) {
    const ALTEZZA_RIGA = 4.5;
    let y = yIniziale;
    righe.forEach((riga) => {
      y = assicuraSpazio(doc, layout, y, ALTEZZA_RIGA);
      doc.text(riga, x, y);
      y += ALTEZZA_RIGA;
    });
    return y;
  }

  /**
   * Disegna un logo mantenendo le proporzioni originali dell'immagine, adattato dentro un
   * riquadro massimo larghezzaMax×altezzaMax (mai deformato): usa il fattore di scala più
   * restrittivo tra i due assi, e non ingrandisce mai oltre la dimensione naturale del file.
   */
  function disegnaLogoProporzionato(doc, layout, dataURL, allineamento, larghezzaMax, altezzaMax) {
    if (!dataURL) {
      return;
    }
    const proprieta = doc.getImageProperties(dataURL);
    const scala = Math.min(larghezzaMax / proprieta.width, altezzaMax / proprieta.height, 1);
    const larghezza = proprieta.width * scala;
    const altezza = proprieta.height * scala;
    const x = allineamento === 'destra' ? layout.larghezzaPagina - layout.margine - larghezza : layout.margine;
    doc.addImage(dataURL, proprieta.fileType, x, layout.margine, larghezza, altezza);
  }

  /** Intestazione con doppio logo affiancato (Colligo Ingegneria a sinistra, cliente a destra), proporzioni originali mantenute. Nessun titolo checklist: è un dato interno (usato solo per l'elenco a tendina), non va mostrato nel report. */
  function disegnaHeader(doc, layout, logoCliente, logoColligoURL) {
    const { larghezzaMax, altezzaMax } = layout.logoClienteDefault;

    disegnaLogoProporzionato(doc, layout, logoColligoURL, 'sinistra', larghezzaMax, altezzaMax);
    disegnaLogoProporzionato(
      doc,
      layout,
      logoCliente ? logoCliente.url : null,
      'destra',
      logoCliente ? logoCliente.larghezzaMax : larghezzaMax,
      logoCliente ? logoCliente.altezzaMax : altezzaMax
    );

    const altezzaRiservata = Math.max(altezzaMax, logoCliente ? logoCliente.altezzaMax : altezzaMax);
    return layout.margine + altezzaRiservata + layout.gapDopoHeader;
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
   * Disegna la riga di footer (legenda) su UNA pagina, così com'è ora, senza logica di
   * "già disegnata su questa pagina": quella logica vive in creaTracciatoreFooter, che avvolge
   * questa funzione con un Set di pagine già servite. Un solo punto disegna, un solo punto
   * decide quando disegnarlo — nessuna duplicazione della logica di disegno.
   *
   * Il numero di pagina ("Pag. X di Y") NON viene disegnato qui, deliberatamente: vedi
   * disegnaNumeriPagina più sotto per il motivo (un bug reale di allineamento, non solo una scelta
   * di stile).
   */
  function disegnaFooter(doc, layout) {
    doc.setFontSize(7.5);
    doc.setFont(undefined, 'italic');
    doc.text(LEGENDA, layout.margine, layout.yFooter);
    doc.setFont(undefined, 'normal');
  }

  /**
   * Tracciatore del footer: disegnato via l'hook didDrawPage di autoTable, così ogni tabella lo
   * ridisegna in automatico su ogni pagina che tocca (compresa la continuazione su pagine
   * successive), senza doverlo ripetere sotto ogni singola tabella né fare un secondo giro a fine
   * documento. Il Set tiene traccia delle pagine già servite: più tabelle diverse possono
   * condividere la stessa pagina (es. la coda di una sezione e l'inizio della successiva), e
   * didDrawPage spara per ciascuna di esse — senza questo controllo il footer verrebbe disegnato
   * più volte, sovrapposto, sulla stessa pagina. completaPagineRestanti è una rete di sicurezza
   * per le pagine senza alcuna tabella (Altri aspetti, Allegati).
   */
  function creaTracciatoreFooter(doc, layout) {
    const pagineFatte = new Set();
    function disegnaSeNonGiaFatta(numeroPagina) {
      if (pagineFatte.has(numeroPagina)) {
        return;
      }
      pagineFatte.add(numeroPagina);
      const paginaPrecedente = doc.internal.getCurrentPageInfo().pageNumber;
      doc.setPage(numeroPagina);
      disegnaFooter(doc, layout);
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

  /**
   * Disegna "Pag. X di Y" in fondo a ogni pagina, allineato a destra vicino al bordo fisico
   * (layout.margineNumeroPagina, più stretto del margine generale usato per il resto del
   * documento). Chiamata in un'UNICA passata finale, quando il numero totale di pagine è già
   * definitivo (dopo completaPagineRestanti in generaReport): jsPDF non ricalcola mai un
   * allineamento 'right' già scritto quando il testo cambia lunghezza in seguito. Il vecchio
   * approccio scriveva un segnaposto lungo ("Pag. X di {total_pages_count_string}"), calcolava
   * l'allineamento a destra su QUELLA lunghezza, e solo alla fine sostituiva il segnaposto con il
   * numero vero (doc.putTotalPages): la sostituzione è un rimpiazzo di testo grezzo nel content
   * stream, non un nuovo disegno, quindi il testo restava ancorato alla posizione calcolata per il
   * segnaposto (molto più largo del numero reale) e appariva visibilmente più a sinistra del
   * previsto, indipendentemente da quanto si stringesse il margine. Disegnando qui, invece, il
   * testo scritto è già quello reale e definitivo: l'allineamento a destra è sempre corretto al
   * primo colpo.
   */
  function disegnaNumeriPagina(doc, layout) {
    const totale = doc.internal.getNumberOfPages();
    const paginaPrecedente = doc.internal.getCurrentPageInfo().pageNumber;
    for (let numeroPagina = 1; numeroPagina <= totale; numeroPagina += 1) {
      doc.setPage(numeroPagina);
      doc.setFontSize(7.5);
      doc.setFont(undefined, 'italic');
      doc.text(
        `Pag. ${numeroPagina} di ${totale}`,
        layout.larghezzaPagina - layout.margineNumeroPagina,
        layout.yFooter,
        { align: 'right' }
      );
      doc.setFont(undefined, 'normal');
    }
    doc.setPage(paginaPrecedente);
  }

  /** Tabella "DATI GENERALI": titolo su sfondo arancione, righe con bordi neri. */
  function disegnaTabellaDatiGenerali(doc, layout, checklist, sopralluogo, y, hookLegenda) {
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
      margin: { left: layout.margine, right: layout.margine },
      head: [[{ content: 'DATI GENERALI', colSpan: 2 }]],
      body: corpo,
      theme: 'grid',
      styles: { lineColor: [0, 0, 0], lineWidth: 0.2, fontSize: 9, cellPadding: 2, valign: 'middle', textColor: [0, 0, 0] },
      headStyles: { fillColor: [250, 200, 120], textColor: [0, 0, 0], fontStyle: 'bold', fontSize: 11, halign: 'left' },
      columnStyles: { 0: { fontStyle: 'bold', cellWidth: 65 }, 1: { cellWidth: 'auto' } },
      didDrawPage: hookLegenda
    });

    return doc.lastAutoTable.finalY + layout.gapDopoTabellaDatiGenerali;
  }

  function formattaTecnici(sopralluogo) {
    return [sopralluogo.tecnico, sopralluogo.tecnico_2].filter(Boolean).join('\n');
  }

  /**
   * Altezza minima riservata, oltre alla bandiera stessa, per la prima riga della tabella di
   * sezione che segue il titolo di gruppo: senza questa riserva la bandiera può restare da sola
   * in fondo pagina con l'intera tabella spinta sulla pagina successiva (titolo "orfano" — bug
   * reale osservato prima di questa riserva esplicita). Copre le due righe di head della tabella
   * (titolo sezione + intestazione colonne) più una riga di dati tipica.
   */
  const ALTEZZA_MINIMA_PRIMA_RIGA_TABELLA = 20;

  /** Bandiera a piena larghezza (colore per cliente, vedi CONFIG_CLIENTI) con il titolo del macro-gruppo. */
  function disegnaIntestazioneGruppo(doc, layout, titolo, y, configCliente) {
    const { altezza, altezzaAccento, gapDopo } = layout.bannerGruppo;
    const colore = (configCliente && configCliente.coloreBanner) || COLORE_BANNER_DEFAULT;

    // Blocco "bandiera + inizio della tabella che segue" trattato come unità unica (vedi
    // ALTEZZA_MINIMA_PRIMA_RIGA_TABELLA): mai la sola bandiera in fondo pagina.
    y = assicuraSpazio(doc, layout, y, altezza + gapDopo + ALTEZZA_MINIMA_PRIMA_RIGA_TABELLA);

    doc.setFillColor(...colore.sfondo);
    doc.rect(layout.margine, y, layout.larghezzaPagina - layout.margine * 2, altezza, 'F');
    if (colore.accento) {
      doc.setFillColor(...colore.accento);
      doc.rect(layout.margine, y + altezza - altezzaAccento, layout.larghezzaPagina - layout.margine * 2, altezzaAccento, 'F');
    }
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(11);
    doc.setFont(undefined, 'bold');
    doc.text(titolo, layout.margine + 3, y + 6.2);
    doc.setTextColor(0, 0, 0);
    doc.setFont(undefined, 'normal');
    return y + altezza + gapDopo;
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
  function disegnaTabellaSezione(doc, layout, sezione, sopralluogo, y, mappaFotoPerDomanda, hookLegenda) {
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
      margin: { left: layout.margine, right: layout.margine },
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
      // Griglia interna sottile e chiara ("morbida"): il bordo esterno netto attorno alla tabella
      // resta separato via tableLineColor/tableLineWidth qui sotto (autoTable lo ridisegna
      // correttamente per ogni pagina anche quando la tabella prosegue su più pagine).
      styles: { lineColor: [210, 210, 210], lineWidth: 0.1, fontSize: FONT_SIZE_TABELLA_SEZIONE, cellPadding: PADDING_TABELLA_SEZIONE, valign: 'middle', textColor: [0, 0, 0] },
      tableLineColor: [0, 0, 0],
      tableLineWidth: 0.3,
      // Zebra striping sulle sole righe dati: alternateRowStyles di autoTable si applica solo alle
      // righe di "body" (mai a head/foot), quindi né il titolo di sezione né l'intestazione delle
      // colonne (entrambi "head", vedi sotto) vengono coinvolti.
      alternateRowStyles: { fillColor: [246, 246, 246] },
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

    return doc.lastAutoTable.finalY + layout.gapDopoTabellaSezione;
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
  function disegnaGruppiSezioni(doc, layout, checklist, sopralluogo, y, mappaFotoPerDomanda, hookLegenda, configCliente) {
    const puntoDivisione = calcolaPuntoDivisioneGruppi(checklist);
    const gruppi = [
      { titolo: TITOLI_GRUPPI_SEZIONI[0], sezioni: checklist.sezioni.slice(0, puntoDivisione) },
      { titolo: TITOLI_GRUPPI_SEZIONI[1], sezioni: checklist.sezioni.slice(puntoDivisione) }
    ];

    gruppi.forEach((gruppo) => {
      if (!gruppo.sezioni.length) {
        return;
      }
      y = disegnaIntestazioneGruppo(doc, layout, gruppo.titolo, y, configCliente);
      gruppo.sezioni.forEach((sezione) => {
        y = disegnaTabellaSezione(doc, layout, sezione, sopralluogo, y, mappaFotoPerDomanda, hookLegenda);
      });
    });

    return y;
  }

  /**
   * Pagina finale "ALTRI ASPETTI DA EVIDENZIARE": testo e relative immagini restano nello
   * stesso blocco, dopo la sezione delle fotografie numerate associate alle domande.
   */
  async function disegnaAltriAspetti(doc, layout, sopralluogo, allegatiNote) {
    if (!sopralluogo.altri_aspetti && !allegatiNote.length) {
      return;
    }

    doc.addPage();
    let y = layout.margine;
    doc.setFontSize(14);
    doc.setFont(undefined, 'bold');
    doc.text('ALTRI ASPETTI DA EVIDENZIARE', layout.margine, y);
    doc.setFont(undefined, 'normal');
    y += 10;

    // Le note libere e le foto associate restano due blocchi chiaramente separati (mai un'unica
    // massa indistinta di testo e immagini), ciascuno con la propria etichetta.
    if (sopralluogo.altri_aspetti) {
      doc.setFontSize(11);
      doc.setFont(undefined, 'bold');
      doc.text('NOTE AGGIUNTIVE', layout.margine, y);
      doc.setFont(undefined, 'normal');
      y += 6;

      doc.setFontSize(10);
      const righe = avvolgiTesto(doc, sopralluogo.altri_aspetti, layout.larghezzaPagina - layout.margine * 2);
      // Nota potenzialmente molto lunga: disegnaTestoImpaginato va a capo pagina da sola, riga per
      // riga, senza mai sovrapporsi al footer né spezzare una riga a metà (vedi la sua doc).
      y = disegnaTestoImpaginato(doc, layout, righe, layout.margine, y);
      y += 8;
    }

    await disegnaPaginaAllegati(doc, layout, allegatiNote, {
      aggiungiPagina: false,
      yIniziale: y,
      titolo: 'DOCUMENTAZIONE FOTOGRAFICA'
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
  async function disegnaPaginaAllegati(doc, layout, elencoFoto, opzioni = {}) {
    if (!elencoFoto.length) {
      return;
    }

    const aggiungiPagina = opzioni.aggiungiPagina !== false;
    if (aggiungiPagina) doc.addPage();
    let y = opzioni.yIniziale ?? layout.margine;
    const titoloPagina = opzioni.titolo === undefined ? 'ALLEGATI — FOTOGRAFIE' : opzioni.titolo;
    if (titoloPagina) {
      doc.setFontSize(14);
      doc.setFont(undefined, 'bold');
      doc.text(titoloPagina, layout.margine, y);
      doc.setFont(undefined, 'normal');
      y += 10;
    }

    const COLONNE = 2;
    const GAP = 6;
    const LARGHEZZA_CELLA = (layout.larghezzaPagina - layout.margine * 2 - GAP * (COLONNE - 1)) / COLONNE;
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
    // Foto + didascalia sono trattate come UN unico blocco: l'altezza di riga riservata da
    // assicuraSpazio include già lo spazio della didascalia, mai solo quello dell'immagine — la
    // didascalia non può quindi mai restare separata dalla propria foto su un'altra pagina.
    const ALTEZZA_CELLA = ALTEZZA_MASSIMA_IMMAGINE + ALTEZZA_DIDASCALIA;

    let colonna = 0;

    for (const [indice, voce] of elencoFoto.entries()) {
      const record = voce.record || await fotoSync.risolviFoto(voce.fotoId);
      if (!record) {
        continue;
      }

      if (colonna === 0) {
        const yPrima = y;
        y = assicuraSpazio(doc, layout, y, ALTEZZA_CELLA + GAP);
        if (y !== yPrima) {
          if (titoloPagina) {
            doc.setFontSize(14);
            doc.setFont(undefined, 'bold');
            doc.text(`${titoloPagina} (segue)`, layout.margine, y);
            doc.setFont(undefined, 'normal');
            y += 10;
          }
        }
      }

      const x = layout.margine + colonna * (LARGHEZZA_CELLA + GAP);
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
   * sottostante esegue il proprio addPage soltanto se la relativa sezione esiste. Il layout è
   * derivato qui da `doc` (invece di essere passato dal chiamante) così questa funzione resta
   * utilizzabile anche isolatamente (es. nei test) con la sola dipendenza sul documento.
   */
  async function disegnaSezioniFinali(doc, sopralluogo, fotoDomande, allegatiNote) {
    const layout = creaLayout(doc);
    await disegnaPaginaAllegati(doc, layout, fotoDomande);
    await disegnaAltriAspetti(doc, layout, sopralluogo, allegatiNote);
  }

  /**
   * Report segnaposto per checklist "stile": "raccolta-dati" (tipi di domanda eterogenei non
   * ancora supportati dal motore di compilazione né da un layout dedicato). Elenca id/testo
   * domanda e valore salvato in forma leggibile, qualunque sia il tipo (testo, numero, si-no,
   * scelta-singola, checkbox-multi con eventuali sotto-campi, gruppo-testo).
   *
   * TODO: questo percorso NON usa ancora il motore centralizzato header/footer/logo/banner
   * (CONFIG_CLIENTI, disegnaHeader/disegnaFooter/disegnaNumeriPagina) — nessuna pagina di
   * intestazione, nessuna legenda, nessun numero di pagina. Lasciato volutamente fuori scope
   * dalla rifattorizzazione PDF (nessuna checklist attuale in checklists/index.json usa questo
   * stile): se in futuro un cliente lo richiede, va portato sullo stesso motore invece di
   * duplicare margini/footer a mano qui.
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

  async function disegnaReportRaccoltaDati(doc, checklist, sopralluogo, layout) {
    doc.setFontSize(10);
    let y = layout.margine + 5;
    doc.text(
      'Layout dedicato non ancora disponibile per questo tipo di checklist (dati grezzi qui sotto).',
      layout.margine,
      y
    );
    y += 10;

    checklist.sezioni.forEach((sezione) => {
      y = assicuraSpazio(doc, layout, y, 12);
      doc.setFontSize(11);
      doc.setFont(undefined, 'bold');
      doc.text(sezione.titolo, layout.margine, y);
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
          layout.larghezzaPagina - layout.margine * 2
        );
        y = assicuraSpazio(doc, layout, y, riga.length * 4.5 + 2);
        doc.text(riga, layout.margine, y);
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
    const layout = creaLayout(doc);

    if (checklist.stile === 'raccolta-dati') {
      return disegnaReportRaccoltaDati(doc, checklist, sopralluogo, layout);
    }

    const configCliente = risolviConfigCliente(checklist);
    const logoColligoURL = await ottieniLogoColligo();
    const logoCliente = await ottieniLogoCliente(configCliente, checklist, sopralluogo.punto_vendita, layout);

    const raccoltaFoto = raccogliFotoConDidascalia(checklist, sopralluogo);
    const fotoDomande = await filtraFotoEsistenti(raccoltaFoto.fotoDomande, sopralluogo);
    const allegatiNote = await filtraFotoEsistenti(raccoltaFoto.allegatiNote, sopralluogo);
    const mappaFotoPerDomanda = costruisciMappaFotoPerDomanda(fotoDomande);
    const tracciatoreFooter = creaTracciatoreFooter(doc, layout);

    let y = disegnaHeader(doc, layout, logoCliente, logoColligoURL);
    y = disegnaTabellaDatiGenerali(doc, layout, checklist, sopralluogo, y, tracciatoreFooter.hookDidDrawPage);
    disegnaGruppiSezioni(doc, layout, checklist, sopralluogo, y, mappaFotoPerDomanda, tracciatoreFooter.hookDidDrawPage, configCliente);

    await disegnaSezioniFinali(doc, sopralluogo, fotoDomande, allegatiNote);

    // Rete di sicurezza per le pagine senza alcuna tabella (Altri aspetti, Allegati): l'hook
    // didDrawPage sopra copre già tutte le pagine toccate da DATI GENERALI o da una tabella di
    // sezione, questo completa solo quelle rimaste scoperte, senza mai ridisegnare le altre.
    tracciatoreFooter.completaPagineRestanti();

    // Numeri di pagina in un'unica passata finale, ora che il totale pagine reale è noto (vedi
    // disegnaNumeriPagina per il perché non si può disegnarli incrementalmente con un segnaposto).
    disegnaNumeriPagina(doc, layout);

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

  return { generaReport, nomeFile, salvaOCondividi, calcolaPuntoDivisioneGruppi,
    _test: {
      raccogliFotoConDidascalia,
      costruisciMappaFotoPerDomanda,
      suffissoVediFoto,
      filtraFotoEsistenti,
      formattaTecnici,
      disegnaSezioniFinali,
      creaLayout,
      risolviConfigCliente,
      configClienti: CONFIG_CLIENTI,
      coloreBannerDefault: COLORE_BANNER_DEFAULT,
      disegnaNumeriPagina,
      disegnaFooter
    }
  };
})();
