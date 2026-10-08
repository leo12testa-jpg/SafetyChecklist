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
  const VERSIONE_LAYOUT_REPORT = '20261002-numerazione-progressiva-v2';
  /**
   * Configurazione di un cliente: logo di intestazione, colore della bandiera dei macro-gruppi,
   * ed eventuali proprietà PDF specifiche future (oggi vuoto per tutti: nessun override esiste
   * ancora, ma la struttura è pronta ad accoglierne senza richiedere nuovi if/else altrove — un
   * consumatore futuro leggerebbe semplicemente configCliente.pdf.qualcosa con un fallback,
   * esattamente come già avviene per logo.larghezzaMax/altezzaMax).
   *
   * "match" è la sotto-stringa (case-insensitive) cercata in `${checklist.id} ${checklist.titolo}`
   * per risolvere quale configurazione si applica a una checklist — vedi risolviConfigCliente.
   * Per i loghi con esigenze di spazio dedicate, larghezzaMax/altezzaMax si specificano qui;
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
      // Nuovo logo completo di monogramma e margini originali (715 × 490 px).
      // Il riquadro dedicato mantiene leggibile il marchio senza deformarlo.
      logo: { file: 'assets/logo_melluso.png', larghezzaMax: 40, altezzaMax: 28 },
      coloreBanner: { sfondo: [200, 2, 52] }, // #c80234, rosso Melluso
      pdf: {}
    },
    carrefour: {
      match: 'carrefour',
      // Il PNG fornito è quello ufficiale. Prima di passarlo a jsPDF lo rasterizziamo in JPEG:
      // evita gli artefatti che alcuni decoder PNG di jsPDF producono sul lettering Carrefour.
      logo: { file: 'assets/logo_carrefour.png', larghezzaMax: 40, altezzaMax: 35, forzaJpeg: true, inlinePng: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAWAAAAEyCAMAAADz+fqCAAABgFBMVEX+/v4BS5flNSzT5+4UU48xZpasx9dvl7XaOTAlW4+VtsvF2+ZZhapJeaSIqsPv6+tJdptljbC61eLQV1C40tzSSUTc8vXSQzrz2NKEpbvWd3J7orv349vZiYTot7HUamTuysSivdA7cqLbl5E0aqFBbJfkqaUCS6F6o8LtxLvD2d0SS3zSY1vil5I8cZvXgnvkpJyCnbqcwtSxzeJXgZtynMEmVH1mhJ5BbqTWPELksJ8eUXseY5glTYJZj8FXl8DfoJrbpaAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD1f8G5AAAAgHRSTlP///////////////////////////////////////////////////////////////////////////////////////8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHjxBMUAABMOSURBVHja7V1ne+K80sZIcm8QB0JIIyGb7GY3W552+vue//+nDhgXyZZVwATbzP1lr02MI26PR9M0MxoBAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB0DcgzN/BQBFQcgVw3dnAGh1i/EFDSKrs+NioglgkktwSX1OjdApPJFMg5HF5gNAL7CRAkRPT0FMnE1xAB+01SbP5lAr/R7fzySniFZciAw6ZP4rNn+OZ2bl8LJdjChhyBx/togg3HPXOCb237QsjvRIHeF8NwuAyHxst5y/DN9w2/D6Irlirym6oJHpFRsPn4GctwdG3b9g/h/mYog/BsYnNL/dkyfHVtj+1b0RWJYxzIcLpDninDV/cbfu9vRJcEhg4snge4FlgZZ8Dv5WfRJaEWv3wRdlMlvjhLfu3x3z+JLpkamuDuc6mXgpdn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' },
      coloreBanner: { sfondo: [0, 84, 159], accento: [239, 51, 43] },
      pdf: {}
    }
  };

  /** Colore di sfondo della bandiera per checklist non associate a nessun cliente in CONFIG_CLIENTI. */
  const COLORE_BANNER_DEFAULT = { sfondo: [74, 122, 181] }; // #4a7ab5, blu originale

  const TITOLI_GRUPPI_SEZIONI = ['ANALISI DOCUMENTALE', 'SOPRALLUOGO AMBIENTI DI LAVORO'];

  const LEGENDA = 'C = Conforme;   P.C = Parzialmente conforme;   N.C = Non conforme;   N.P = Non pertinente';

  /** Accetta sia l'array locale sia la mappa Firestore domanda_id -> risposta. */
  function risposteComeArray(risposte) {
    if (Array.isArray(risposte)) return risposte;
    if (risposte && typeof risposte === 'object') {
      return Object.keys(risposte).map((chiave) => {
        const risposta = risposte[chiave];
        if (!risposta || typeof risposta !== 'object') return null;
        return risposta.domanda_id == null
          ? { ...risposta, domanda_id: Number.isNaN(Number(chiave)) ? chiave : Number(chiave) }
          : risposta;
      }).filter(Boolean);
    }
    return [];
  }

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
      if (typeof FileReader !== 'function') return reject(metodoNonDisponibile('FileReader'));
      const reader = new FileReader();
      if (typeof reader.readAsDataURL !== 'function') return reject(metodoNonDisponibile('FileReader.readAsDataURL'));
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
  async function rasterizzaLogoComeJpeg(blob) {
    // In browser convertiamo il raster in RGB/JPEG prima di consegnarlo a jsPDF. Questo evita
    // gli artefatti osservati sul PNG Carrefour (simbolo corretto, lettering corrotto).
    // Nei test Node, dove DOM/Image non esistono, manteniamo il dataURL originale.
    if (typeof document === 'undefined' || typeof Image !== 'function' ||
        typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
      return blobADataURL(blob);
    }

    const objectUrl = URL.createObjectURL(blob);
    try {
      const immagine = await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('Impossibile decodificare il logo cliente.'));
        img.src = objectUrl;
      });
      const canvas = document.createElement('canvas');
      canvas.width = immagine.naturalWidth || immagine.width;
      canvas.height = immagine.naturalHeight || immagine.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas 2D non disponibile per il logo cliente.');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(immagine, 0, 0);
      return canvas.toDataURL('image/jpeg', 0.96);
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

  async function caricaLogo(url, { forzaJpeg = false } = {}) {
    const risposta = await fetch(url, { cache: 'no-store' });
    if (!risposta.ok) {
      throw new Error(`Logo non trovato (HTTP ${risposta.status}): ${url}`);
    }
    const blob = await risposta.blob();
    if (!blob.type.startsWith('image/')) throw new Error(`La risorsa ${url} non è un'immagine (${blob.type || 'tipo sconosciuto'}).`);
    if (!forzaJpeg) return blobADataURL(blob);
    try { return await rasterizzaLogoComeJpeg(blob); }
    catch (errore) {
      console.warn('[pdf.js] Conversione JPEG non disponibile, provo il PNG originale:', errore);
      return blobADataURL(blob);
    }
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
    const riferimento = [checklist.id, checklist.titolo, checklist.cliente, checklist.cliente_nome, checklist.checklist_id].filter(Boolean).join(' ').toLowerCase();
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
      let url;
      if (configCliente.logo.inlinePng) {
        // Asset Carrefour incorporato nel motore PDF: evita cache obsolete, 404 e risposte HTML
        // quando l'app viene utilizzata online/offline o installata come PWA.
        const bytes = Uint8Array.from(atob(configCliente.logo.inlinePng.split(',')[1]), c => c.charCodeAt(0));
        const blob = new Blob([bytes], { type: 'image/png' });
        try {
          url = configCliente.logo.forzaJpeg ? await rasterizzaLogoComeJpeg(blob) : configCliente.logo.inlinePng;
        } catch (errore) {
          console.warn('[pdf.js] Rasterizzazione logo Carrefour non riuscita; uso PNG incorporato:', errore);
          url = configCliente.logo.inlinePng;
        }
      } else {
        url = configCliente.logo.dataURL || await caricaLogo(
          configCliente.logo.file,
          { forzaJpeg: Boolean(configCliente.logo.forzaJpeg) }
        );
      }
      return { url, ...dimensione };
    } catch (errore) {
      console.error(`[pdf.js] Logo cliente non caricato (${configCliente.logo.file}) per checklist "${checklist.id}" (Punto vendita: "${puntoVendita || ''}"):`, errore);
      throw new Error(`Impossibile inserire il logo ${configCliente.logo.file} nel PDF. Verificare la connessione e riprovare, evitando di generare un report incompleto.`);
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
    return String(testo || '').split('\n').reduce((righe, riga) => righe.concat(doc.splitTextToSize(riga, larghezza)), []);
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
  function disegnaLogoProporzionato(doc, layout, dataURL, allineamento, larghezzaMax, altezzaMax, fasciaVisiva) {
    if (!dataURL) {
      return;
    }
    const proprieta = doc.getImageProperties(dataURL);
    const scala = Math.min(larghezzaMax / proprieta.width, altezzaMax / proprieta.height, 1);
    const larghezza = proprieta.width * scala;
    const altezza = proprieta.height * scala;
    let x = allineamento === 'destra' ? layout.larghezzaPagina - layout.margine - larghezza : layout.margine;
    let y = layout.margine;
    if (fasciaVisiva) {
      const { area, centroY } = fasciaVisiva;
      x = allineamento === 'destra'
        ? layout.larghezzaPagina - layout.margine - larghezza * (area.x + area.larghezza)
        : layout.margine - larghezza * area.x;
      y = centroY - altezza * (area.y + area.altezza / 2);
    }
    doc.addImage(dataURL, proprieta.fileType, x, y, larghezza, altezza);
  }

  /** Intestazione con doppio logo affiancato (Colligo Ingegneria a sinistra, cliente a destra), proporzioni originali mantenute. Nessun titolo checklist: è un dato interno (usato solo per l'elenco a tendina), non va mostrato nel report. */
  function disegnaHeader(doc, layout, logoCliente, logoColligoURL, checklistId) {
    const { larghezzaMax, altezzaMax } = layout.logoClienteDefault;
    const altezzaRiservata = Math.max(altezzaMax, logoCliente ? logoCliente.altezzaMax : altezzaMax);

    if (checklistId === 'melluso_sopralluogo' && logoCliente) {
      const centroY = layout.margine + altezzaRiservata / 2;
      // Limiti del contenuto visibile misurati sugli asset originali, normalizzati sui pixel
      // reali (Colligo 383×130, Melluso 715×490). Nessun ritaglio o deformazione dell'immagine.
      const areaColligo = { x: 2 / 383, y: 3 / 130, larghezza: 377 / 383, altezza: 125 / 130 };
      const areaMelluso = { x: 70 / 715, y: 129 / 490, larghezza: 575 / 715, altezza: 233 / 490 };
      const ingrandimentoMelluso = 1.1;
      disegnaLogoProporzionato(doc, layout, logoColligoURL, 'sinistra', larghezzaMax, altezzaMax,
        { centroY, area: areaColligo });
      disegnaLogoProporzionato(doc, layout, logoCliente.url, 'destra',
        logoCliente.larghezzaMax * ingrandimentoMelluso, logoCliente.altezzaMax * ingrandimentoMelluso,
        { centroY, area: areaMelluso });
      // La tabella DATI GENERALI deve restare esattamente alla quota precedente.
      return layout.margine + altezzaRiservata + layout.gapDopoHeader;
    }

    disegnaLogoProporzionato(doc, layout, logoColligoURL, 'sinistra', larghezzaMax, altezzaMax);
    disegnaLogoProporzionato(
      doc,
      layout,
      logoCliente ? logoCliente.url : null,
      'destra',
      logoCliente ? logoCliente.larghezzaMax : larghezzaMax,
      logoCliente ? logoCliente.altezzaMax : altezzaMax
    );

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
      hookDidDrawPage: () => disegnaSeNonGiaFatta(doc.internal.getCurrentPageInfo().pageNumber),
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
    const nascondeNumeroDipendenti = checklist.id === 'melluso_sopralluogo' || checklist.id === 'interparking_sopralluogo';
    const tecnici = formattaTecnici(sopralluogo);

    const corpo = [
      [etichette.puntoVendita, puntoVendita],
      ...(nascondeNumeroDipendenti ? [] : [
        ['Numero di dipendenti in forza al momento del sopralluogo', String(sopralluogo.numero_dipendenti || '')]
      ]),
      [tecnici.includes('\n') ? 'Tecnici che hanno eseguito il sopralluogo' : 'Tecnico che ha eseguito il sopralluogo', tecnici],
      ['Data del sopralluogo', formattaDataSemplice(sopralluogo.data_sopralluogo)],
      [etichette.responsabile, sopralluogo.responsabile_punto_vendita || ''],
      ...(checklist.id !== 'interparking_sopralluogo' && sopralluogo.area_manager ? [
        ['Area Manager', sopralluogo.area_manager]
      ] : []),
      [etichette.presenzaResponsabile, sopralluogo.presenza_responsabile || ''],
      ["Sopralluogo alla presenza dell'R.L.S.", sopralluogo.presenza_rls || ''],
      // Nome RLS: solo Interparking, solo se l'RLS era presente e il nome è stato compilato
      // (mai una riga vuota altrimenti).
      ...(checklist.id === 'interparking_sopralluogo' && sopralluogo.presenza_rls === 'Sì' && sopralluogo.nome_rls ? [
        ['Nome RLS', sopralluogo.nome_rls]
      ] : [])
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

  /** Solo i tecnici effettivamente compilati (mai righe vuote): fino a 4 con Interparking. */
  function formattaTecnici(sopralluogo) {
    return [sopralluogo.tecnico, sopralluogo.tecnico_2, sopralluogo.tecnico_3, sopralluogo.tecnico_4].filter(Boolean).join('\n');
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
  // Native AutoTable text owns wrapping and continuation of exceptionally tall rows.
  const PADDING_VERTICALE_NOTA = 3.5;

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

  /** Numero visibile nel PDF: progressivo 1..N nell'ordine reale della checklist.
   * Gli id delle domande restano invariati e continuano a essere usati internamente per
   * risposte, sincronizzazione e compatibilità con i sopralluoghi storici.
   */
  function costruisciMappaNumeroDomanda(checklist) {
    const mappa = new Map();
    let numero = 1;
    (checklist.sezioni || []).forEach((sezione) => {
      (sezione.domande || []).forEach((domanda) => {
        mappa.set(domanda.id, numero);
        numero += 1;
      });
    });
    return mappa;
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
   * il default), mantenendo il contesto nelle pagine di continuazione.
   * Il guard willDrawPage riserva titolo, header e prima riga completa prima del disegno.
   */
  function disegnaTabellaSezione(doc, layout, sezione, sopralluogo, y, mappaFotoPerDomanda, hookLegenda, gruppo, mappaNumeroDomanda = null) {
    const coloreGruppo = gruppo && ((gruppo.configCliente && gruppo.configCliente.coloreBanner) || COLORE_BANNER_DEFAULT);
    const corpo = sezione.domande.map((domanda) => {
      const risposta = risposteComeArray(sopralluogo.risposte).find((r) => r && r.domanda_id != null && String(r.domanda_id) === String(domanda.id));
      const valore = risposta ? risposta.risposta : '';
      const nota = (risposta && risposta.note) || '';
      const vediFoto = suffissoVediFoto(domanda.id, mappaFotoPerDomanda);
      return [
        (mappaNumeroDomanda && mappaNumeroDomanda.get(domanda.id)) || domanda.id,
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
      margin: { top: layout.margine, bottom: layout.margine, left: layout.margine, right: layout.margine },
      // Keep ordinary rows together; only rows taller than a page may continue.
      rowPageBreak: 'avoid',
      head: [
        // A group banner belongs to the measured/repeated head. A nearly page-high
        // first row cannot be pushed away from it by a second, independent layout.
        ...(gruppo ? [[{ content: gruppo.titolo, colSpan: 7, styles: {
          halign: 'left', fontStyle: 'bold', fontSize: 11,
          fillColor: coloreGruppo.sfondo, textColor: [255, 255, 255],
          minCellHeight: layout.bannerGruppo.altezza, cellPadding: 3
        } }]] : []),
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
        6: { cellWidth: LARGHEZZA_COLONNA_NOTE, fontStyle: 'italic', cellPadding: { top: PADDING_VERTICALE_NOTA, bottom: PADDING_VERTICALE_NOTA, left: PADDING_TABELLA_SEZIONE, right: PADDING_TABELLA_SEZIONE } }
      },
      didDrawCell(data) {
        if (gruppo && coloreGruppo.accento && data.section === 'head' && data.row.index === 0) {
          doc.setFillColor(...coloreGruppo.accento);
          doc.rect(data.cell.x, data.cell.y + data.cell.height - layout.bannerGruppo.altezzaAccento,
            data.cell.width, layout.bannerGruppo.altezzaAccento, 'F');
        }
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
      },
      // AutoTable has now measured every wrapped cell, including the complete note.
      // Move BEFORE drawing either head row; reserve the group banner as well.
      willDrawPage(data) {
        if (data.pageNumber !== 1) return;
        const head = data.table.head.reduce((sum, row) => sum + row.height, 0);
        const first = data.table.body[0];
        const available = layout.altezzaPagina - 2 * layout.margine - head;
        const required = head + (first ? Math.min(first.height, available) : 0);
        const nextY = assicuraSpazio(doc, layout, data.cursor.y, required);
        data.cursor.y = nextY;
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
  function disegnaGruppiSezioni(doc, layout, checklist, sopralluogo, y, mappaFotoPerDomanda, hookLegenda, configCliente, mappaNumeroDomanda) {
    const puntoDivisione = calcolaPuntoDivisioneGruppi(checklist);
    const gruppi = [
      { titolo: TITOLI_GRUPPI_SEZIONI[0], sezioni: checklist.sezioni.slice(0, puntoDivisione) },
      { titolo: TITOLI_GRUPPI_SEZIONI[1], sezioni: checklist.sezioni.slice(puntoDivisione) }
    ];

    gruppi.forEach((gruppo) => {
      if (!gruppo.sezioni.length) {
        return;
      }
      gruppo.sezioni.forEach((sezione, indice) => {
        y = disegnaTabellaSezione(doc, layout, sezione, sopralluogo, y, mappaFotoPerDomanda, hookLegenda, indice === 0 ? { titolo: gruppo.titolo, configCliente } : null, mappaNumeroDomanda);
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
    const mappaNumeroDomanda = costruisciMappaNumeroDomanda(checklist);
    const domandeComplete = [];
    checklist.sezioni.forEach((sezione) => {
      sezione.domande.forEach((domanda) => {
        domandeComplete.push({ sezione: sezione.titolo, domanda });
      });
    });

    const fotoDomande = [];
    risposteComeArray(sopralluogo.risposte).forEach((risposta) => {
      if (!risposta.foto || !risposta.foto.length) {
        return;
      }
      const info = domandeComplete.find((d) => String(d.domanda.id) === String(risposta.domanda_id));
      risposta.foto.forEach((fotoId) => {
        fotoDomande.push({
          fotoId,
          domandaId: risposta.domanda_id,
          domandaNumero: mappaNumeroDomanda.get(risposta.domanda_id) || risposta.domanda_id,
          stato: risposta.risposta || null,
          domandaTesto: info ? info.domanda.testo : ''
        });
      });
    });

    const didascalieAltriAspetti = sopralluogo.altri_aspetti_foto_didascalie || {};
    const allegatiNote = (sopralluogo.altri_aspetti_foto || [])
      .map((fotoId) => ({ fotoId, altriAspetti: true, didascaliaPersonalizzata: didascalieAltriAspetti[fotoId] || null }));
    return { fotoDomande, allegatiNote };
  }

  /** Conserva ogni riferimento e la numerazione anche quando il blob non ? disponibile. */
  async function filtraFotoEsistenti(elenco, sopralluogo) {
    const risultato = [];
    for (const voce of elenco) {
      let record;
      try { record = await fotoSync.risolviFoto(voce.fotoId, sopralluogo); } catch (_) {}
      if (record && record.blob && record.blob.size > 0) risultato.push({ ...voce, record });
      else risultato.push({ ...voce, mancante: true });
    }
    return risultato;
  }

  async function preparaFotoReport(checklist, sopralluogo) {
    const raccolta = raccogliFotoConDidascalia(checklist, sopralluogo);
    const tutte = await filtraFotoEsistenti(raccolta.fotoDomande.concat(raccolta.allegatiNote), sopralluogo);
    return { fotoDomande: tutte.filter(f => !f.altriAspetti), allegatiNote: tutte.filter(f => f.altriAspetti) };
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
      const record = voce.record || null;

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
      try {
        if (!record?.blob) throw new Error('Foto assente');
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
      } catch (_) {
        doc.setFontSize(9);
        doc.text(doc.splitTextToSize('Foto non disponibile al momento della generazione.', LARGHEZZA_CELLA - 4), x + 2, y + 15);
      }

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
        const prefisso = `Foto ${indice + 1} — Domanda ${voce.domandaNumero || voce.domandaId}${voce.stato ? ` [${voce.stato}]` : ''}: `;
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
        const risposta = risposteComeArray(sopralluogo.risposte).find((r) => r && r.domanda_id != null && String(r.domanda_id) === String(domanda.id));
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

    const { fotoDomande, allegatiNote } = await preparaFotoReport(checklist, sopralluogo);
    await disegnaSezioniFinali(doc, sopralluogo, fotoDomande, allegatiNote);

    return esportaBlob(doc);
  }

  /**
   * Genera il report PDF completo di un sopralluogo. `checklist` e `sopralluogo` sono dati puri
   * (anche di un sopralluogo storico, non necessariamente quello attivo nel motore).
   * Ritorna un Blob "application/pdf".
   */
  async function generaReport(checklist, sopralluogo) {
    const jsPDF = window.jspdf && window.jspdf.jsPDF;
    if (typeof jsPDF !== 'function') throw new Error('Motore PDF non disponibile. Riaprire l’app dopo il caricamento completo.');
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    if (typeof doc.autoTable !== 'function') throw new Error('Modulo tabelle PDF non disponibile. Ricaricare l’app.');
    const layout = creaLayout(doc);

    if (checklist.stile === 'raccolta-dati') {
      return disegnaReportRaccoltaDati(doc, checklist, sopralluogo, layout);
    }

    const configCliente = risolviConfigCliente({ ...checklist, checklist_id: sopralluogo.checklist_id, cliente: checklist.cliente || sopralluogo.cliente });
    const logoColligoURL = await ottieniLogoColligo();
    const logoCliente = await ottieniLogoCliente(configCliente, checklist, sopralluogo.punto_vendita, layout);

    const { fotoDomande, allegatiNote } = await preparaFotoReport(checklist, sopralluogo);
    const mappaFotoPerDomanda = costruisciMappaFotoPerDomanda(fotoDomande);
    const mappaNumeroDomanda = costruisciMappaNumeroDomanda(checklist);
    const tracciatoreFooter = creaTracciatoreFooter(doc, layout);

    let y = disegnaHeader(doc, layout, logoCliente, logoColligoURL, checklist.id);
    y = disegnaTabellaDatiGenerali(doc, layout, checklist, sopralluogo, y, tracciatoreFooter.hookDidDrawPage);
    disegnaGruppiSezioni(doc, layout, checklist, sopralluogo, y, mappaFotoPerDomanda, tracciatoreFooter.hookDidDrawPage, configCliente, mappaNumeroDomanda);

    await disegnaSezioniFinali(doc, sopralluogo, fotoDomande, allegatiNote);

    // Rete di sicurezza per le pagine senza alcuna tabella (Altri aspetti, Allegati): l'hook
    // didDrawPage sopra copre già tutte le pagine toccate da DATI GENERALI o da una tabella di
    // sezione, questo completa solo quelle rimaste scoperte, senza mai ridisegnare le altre.
    tracciatoreFooter.completaPagineRestanti();

    // Numeri di pagina in un'unica passata finale, ora che il totale pagine reale è noto (vedi
    // disegnaNumeriPagina per il perché non si può disegnarli incrementalmente con un segnaposto).
    disegnaNumeriPagina(doc, layout);

    return esportaBlob(doc);
  }

  function esportaBlob(doc) {
    if (typeof doc.output !== 'function') throw metodoNonDisponibile('doc.output');
    if (typeof Blob !== 'function') throw metodoNonDisponibile('Blob');
    const buffer = doc.output('arraybuffer');
    if (!buffer || buffer.byteLength < 5 || new Uint8Array(buffer, 0, 5).join(',') !== '37,80,68,70,45') {
      throw new Error('Il motore non ha prodotto un PDF valido.');
    }
    return new Blob([buffer], { type: 'application/pdf' });
  }

  function leggiArrayBuffer(blob) {
    if (blob && typeof blob.arrayBuffer === 'function') return blob.arrayBuffer();
    return new Promise((resolve, reject) => {
      diagnostica('Blob.arrayBuffer');
      if (typeof FileReader !== 'function') return reject(metodoNonDisponibile('FileReader'));
      const reader = new FileReader();
      if (typeof reader.readAsArrayBuffer !== 'function') return reject(metodoNonDisponibile('FileReader.readAsArrayBuffer'));
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error || new Error('Lettura PDF fallita.'));
      reader.readAsArrayBuffer(blob);
    });
  }

  async function urlPdf(blob) {
    if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
      try { return URL.createObjectURL(blob); } catch (error) { diagnostica('URL.createObjectURL', error); }
    } else diagnostica('URL.createObjectURL');
    if (typeof FileReader === 'function') return blobADataURL(blob);
    throw metodoNonDisponibile('URL.createObjectURL / FileReader');
  }

  function rilasciaUrl(url) {
    if (url.startsWith('blob:') && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
      // Revoking in the click handler races the browser download/navigation.
      setTimeout(() => {
        if (typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(url);
      }, 60000);
    }
  }

  function prenotaFinestra() {
    // PDF.js renders inside the app: no popup or native viewer is required.
    return null;
  }

  function diagnostica(metodo, errore) {
    console.warn('[SafetyChecklist PDF]', {
      metodo,
      esito: errore ? 'chiamata fallita, provo il fallback' : 'metodo non disponibile, provo il fallback',
      errore: errore ? `${errore.name || 'Error'}: ${errore.message || ''}` : null
    });
  }

  function metodoNonDisponibile(metodo) {
    const error = new Error(`Impossibile aprire il PDF su questo dispositivo. Metodo non disponibile: ${metodo}.`);
    error.metodoPdf = metodo;
    console.error('[SafetyChecklist PDF]', { metodo, esito: 'nessun fallback disponibile' });
    return error;
  }

  function descriviErrore(azione, errore) {
    console.error(`[SafetyChecklist PDF] ${azione}`, errore);
    if (errore && errore.metodoPdf) return errore.message;
    const message = errore && errore.message ? errore.message : String(errore);
    const missing = message.match(/([^\s]+) is not a function/);
    if (missing) {
      const metodo = missing[1];
      const apiBrowser = /^(navigator\.|URL\.|window\.|Blob\.|FileReader|HTMLAnchorElement)/.test(metodo);
      if (apiBrowser) return `Impossibile ${azione} il PDF su questo dispositivo. Metodo non disponibile: ${metodo}.`;
      return `Impossibile ${azione} il PDF: formato dati non compatibile (${metodo}). Riapri l'app e riprova dopo la sincronizzazione.`;
    }
    return `Impossibile ${azione} il PDF: ${message}`;
  }

  async function scarica(blob, filename) {
    if (blob.type === 'application/pdf' && typeof pdfjsLib !== 'undefined' && typeof pdfjsLib.getDocument === 'function') {
      const link = await apri(blob, filename);
      // A synthetic click is only an attempt. The real link stays available.
      if (link && typeof link.click === 'function') link.click();
      return;
    }
    const url = await urlPdf(blob);
    const link = document.createElement('a');
    link.href = url;
    if (!('download' in link)) {
      diagnostica('HTMLAnchorElement.download');
      link.target = '_blank';
      link.rel = 'noopener';
    }
    link.download = filename;
    link.textContent = `Scarica ${filename}`;
    document.body.appendChild(link);
    try {
      if (typeof link.click === 'function') link.click();
      else {
        diagnostica('HTMLAnchorElement.click');
        // Keep a real, keyboard-accessible link for manual activation.
        return;
      }
    } finally {
      if (typeof link.click === 'function') {
        setTimeout(() => { if (link.parentNode) link.parentNode.removeChild(link); }, 60000);
        rilasciaUrl(url);
      }
    }
  }

  async function apri(blob, filename, finestra) {
    if (finestra) {
      try { if (typeof finestra.close === 'function') finestra.close(); } catch (error) { diagnostica('window.close', error); }
    }
    // Native viewer navigation can succeed while leaving a blank tab on Edge.
    // Success here means every PDF.js page has actually finished rendering.
    if (typeof pdfjsLib !== 'undefined' && typeof pdfjsLib.getDocument === 'function') {
      const panel = document.createElement('div');
      panel.className = 'pdf-preview-overlay';
      panel.setAttribute('role', 'dialog');
      panel.setAttribute('aria-label', 'Anteprima PDF');
      panel.setAttribute('aria-modal', 'true');
      const previousFocus = document.activeElement;
      const toolbar = document.createElement('div');
      toolbar.className = 'pdf-preview-toolbar';
      const close = document.createElement('button');
      close.textContent = 'Chiudi anteprima PDF';
      const download = document.createElement('a');
      download.textContent = 'Scarica PDF';
      download.download = filename;
      const status = document.createElement('p');
      status.setAttribute('role', 'status');
      status.textContent = 'Preparazione PDF…';
      toolbar.append(close, download, status);
      panel.append(toolbar);
      document.body.appendChild(panel);
      close.focus();
      let documento;
      let url;
      let chiuso = false;
      let distruzione;
      const distruggi = () => documento ? (distruzione || (distruzione = documento.destroy())) : Promise.resolve();
      close.onclick = () => {
        chiuso = true; panel.remove();
        if (url) rilasciaUrl(url);
        distruggi().catch(e => diagnostica('PDF.js.destroy', e));
        if (previousFocus && typeof previousFocus.focus === 'function') previousFocus.focus();
      };
      panel.onkeydown = event => {
        if (event.key === 'Escape') close.click();
        if (event.key === 'Tab') {
          event.preventDefault();
          (document.activeElement === close && download.href ? download : close).focus();
        }
      };
      download.onclick = () => {
        status.textContent = 'Download richiesto. Se il file non compare nei download del browser, premi di nuovo Scarica PDF.';
      };
      try {
        url = await urlPdf(blob);
        if (chiuso) { rilasciaUrl(url); return; }
        download.href = url;
        documento = await pdfjsLib.getDocument({ data: new Uint8Array(await leggiArrayBuffer(blob)) }).promise;
        for (let n = 1; n <= documento.numPages && !chiuso; n++) {
          const page = await documento.getPage(n);

          // Il vecchio viewer renderizzava ogni pagina a 1 pixel per punto PDF (~595 px per un A4):
          // su schermi moderni/zoom browser il canvas veniva poi ingrandito dal CSS e risultava
          // visibilmente sgranato. Manteniamo una dimensione comoda a schermo ma renderizziamo
          // internamente a densità molto più alta, rispettando anche il devicePixelRatio.
          const scalaCss = 1.25;
          const densitaSchermo = Math.max(1.5, Number(window.devicePixelRatio) || 1);
          const scalaRender = Math.min(2.25, scalaCss * densitaSchermo);
          const viewportCss = page.getViewport({ scale: scalaCss });
          const viewportRender = page.getViewport({ scale: scalaRender });

          const canvas = document.createElement('canvas');
          canvas.width = Math.ceil(viewportRender.width);
          canvas.height = Math.ceil(viewportRender.height);
          canvas.style.width = `${Math.ceil(viewportCss.width)}px`;
          canvas.style.height = `${Math.ceil(viewportCss.height)}px`;
          canvas.dataset.renderScale = String(scalaRender);
          canvas.dataset.cssScale = String(scalaCss);
          panel.appendChild(canvas);

          status.textContent = `Rendering pagina ${n} di ${documento.numPages}…`;
          const contesto = canvas.getContext('2d', { alpha: false });
          await page.render({ canvasContext: contesto, viewport: viewportRender }).promise;
          page.cleanup();
        }
        if (!chiuso) {
          panel.dataset.renderedPages = String(documento.numPages);
          status.textContent = `${documento.numPages} pagine pronte. Premi Scarica PDF per salvare il file.`;
        }
      } catch (error) {
        if (!chiuso) {
          status.textContent = descriviErrore('visualizzare', error) + ' Puoi usare Scarica PDF se disponibile.';
          throw error;
        }
      } finally { await distruggi(); }
      return chiuso ? null : download;
    }
    await scarica(blob, filename);
  }

  /** Nome file suggerito per il PDF (sanificato per download/condivisione). */
  function nomeFile(sopralluogo) {
    const base = `Sopralluogo_${sopralluogo.punto_vendita}_${(sopralluogo.data || '').slice(0, 10)}`;
    return `${base.replace(/[^a-z0-9_-]+/gi, '_')}.pdf`;
  }

  /** Salva/condivide il PDF: Web Share API con file se disponibile, altrimenti download diretto. */
  async function salvaOCondividi(blob, filename) {
    // Desktop download must not open the Windows share sheet (or depend on
    // transient activation surviving asynchronous PDF generation).
    if (blob.type === 'application/pdf' && /Windows NT|Macintosh|X11|CrOS/.test(navigator.userAgent || '') &&
        !/Android|iPhone|iPad/.test(navigator.userAgent || '') &&
        !(/Macintosh/.test(navigator.userAgent || '') && navigator.maxTouchPoints > 1)) {
      await scarica(blob, filename);
      return;
    }
    if (typeof File === 'function' && typeof navigator.canShare === 'function' && typeof navigator.share === 'function') {
      try {
        const file = new File([blob], filename, { type: 'application/pdf' });
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], title: filename });
          return;
        }
      } catch (error) {
        if (error.name === 'AbortError') return;
        diagnostica('navigator.share / navigator.canShare', error);
        // Unsupported sharing / expired user activation: keep the download usable.
      }
    } else diagnostica(typeof File !== 'function' ? 'File' : typeof navigator.share !== 'function' ? 'navigator.share' : 'navigator.canShare');
    await scarica(blob, filename);
  }

  return { generaReport, nomeFile, salvaOCondividi, apri, scarica, prenotaFinestra, leggiArrayBuffer, descriviErrore, calcolaPuntoDivisioneGruppi, versioneLayout: VERSIONE_LAYOUT_REPORT,
    _test: {
      raccogliFotoConDidascalia,
      costruisciMappaNumeroDomanda,
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
      disegnaHeader,
      disegnaFooter,
      disegnaTabellaSezione
    }
  };
})();
