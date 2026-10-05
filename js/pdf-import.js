/**
 * Estrazione (SOLO estrazione: nessun abbinamento a una checklist qui, vedi js/import-matching.js)
 * di righe da un PDF di sopralluogo già compilato. Supporta due formati, provati in quest'ordine:
 *
 * 1. "nostro" — il PDF generato da questa stessa app (js/pdf.js): tabella "DATI GENERALI" +
 *    tabelle sezione con colonne n./Descrizione attività/C/P.C/N.C/N.P/Note (vedi
 *    disegnaTabellaDatiGenerali e disegnaTabellaSezione). Nei PDF legacy la colonna "n." era
 *    l'id stabile; nei PDF attuali è il numero progressivo visibile 1..N. Il matching conserva
 *    il numero letto e lo valida con il testo, quindi entrambi i formati restano importabili.
 * 2. "storico" — un vecchio formato Coin (non generato da questa app): intestazione a tabella
 *    Negozio/Data del sopralluogo/Area Manager/Tecnico (2 righe x 2 coppie etichetta-valore),
 *    macro-sezioni "AUDIT DOCUMENTALE"/"SOPRALLUOGO AMBIENTI DI LAVORO" con numerazione delle
 *    domande "N)" che RIPARTE DA 1 a ogni macro-sezione, colonne C/PC/NC/NA (o NP)/NOTE. Nessun
 *    id: solo un numero locale + il testo della domanda, entrambi preservati per il matching.
 *
 * In entrambi i casi usa pdf.js (Mozilla, vendorizzato in js/vendor/pdf.min.js) per estrarre il
 * testo di ogni pagina CON le coordinate x/y di ogni elemento (getTextContent), non il testo
 * grezzo: è dalla posizione che si ricostruisce a quale domanda/colonna appartiene ogni "X" o
 * nota, dato che il testo grezzo da solo non lo dice.
 *
 * IMPORTANTE — separazione dei compiti: questo modulo NON sa nulla della checklist scelta
 * dall'utente né decide a quale domanda appartenga una riga. Produce esclusivamente righe grezze
 * con i dati COSÌ COME LETTI dal PDF (numero_originale, sezione_originale, testo_originale,
 * stato_originale, nota_originale, id_originale se disponibile): è js/import-matching.js che,
 * dato un elenco di checklist candidate, rileva quale sia la più probabile e abbina ogni riga
 * alle sue domande. Questo permette di riconoscere cliente/checklist DAL CONTENUTO del PDF invece
 * di doverli assumere a priori da un menu selezionato prima di importare.
 *
 * Limiti noti (documentati anche per l'utente nell'interfaccia):
 * - Solo checklist con lo stesso layout "a stato" C/PC/NC/NA (non le checklist "stile":
 *   "raccolta-dati", che hanno un report diverso senza queste colonne, in nessuno dei due formati).
 * - Le immagini vengono estratte in memoria come XObject decodificati o crop della regione.
 *   La scelta e il salvataggio definitivo spettano all'anteprima di importazione.
 * - Una riga è riconosciuta solo se ha ESATTAMENTE un segno "X" in una delle 4 colonne di
 *   stato: 0 o più di 1 marcatura trovata per la stessa riga => stato_originale resta null
 *   invece di essere indovinato.
 * - Formato storico: le note molto lunghe possono avere la prima riga posizionata in modo
 *   irregolare rispetto alle righe successive (bullet list con indentazioni diverse): il testo
 *   viene comunque raccolto per intero, ma l'ordine esatto delle parole sulla stessa riga può
 *   in rari casi risultare leggermente diverso dall'originale.
 * - Se nessuna struttura di colonne nota viene trovata in NESSUna pagina per NESSUno dei due
 *   formati, il file viene rifiutato subito con un errore chiaro: non è un PDF di sopralluogo
 *   riconoscibile (né "nostro" né "storico"), non ha senso proseguire con un rilevamento cliente.
 */
const pdfImport = (() => {
  if (typeof pdfjsLib !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'js/vendor/pdf.worker.min.js';
  }

  // ======================================================================================
  // FORMATO "NOSTRO" (generato da js/pdf.js)
  // ======================================================================================

  const TOLLERANZA_RIGA_PT = 3;
  const TOLLERANZA_COLONNA_ID_PT = 10;
  const TOLLERANZA_RIGA_NOTA_PT = 40;
  const TOLLERANZA_RIGA_MULTILINEA_PT = 12;
  const TOLLERANZA_TITOLO_SEZIONE_PT = 18;
  // Alcuni PDF Interparking legacy contengono due numeri sovrapposti nella colonna "n.":
  // il vecchio id stabile viene disegnato per primo e il numero progressivo visibile viene
  // sovrapposto dopo. PDF.js restituisce entrambi gli elementi testo, anche se a video se ne vede
  // uno solo. Li consideriamo la stessa posizione fisica e teniamo l'ultimo elemento disegnato.
  const TOLLERANZA_ID_SOVRAPPOSTO_X_PT = 3;
  const TOLLERANZA_ID_SOVRAPPOSTO_Y_PT = 8;

  /**
   * Gap (in pt) oltre il quale due righe consecutive di testo (colonna Note o Descrizione
   * attività) NON sono più considerate parte dello stesso blocco/nota, ma appartengono a una
   * domanda diversa: deve stare fra l'interlinea normale DENTRO una nota multi-riga e il distacco
   * minimo FRA due note di righe adiacenti. In js/pdf.js: FONT_SIZE_TABELLA_SEZIONE=7.5pt con
   * l'interlinea di default di jsPDF (~1.15) dà un'interlinea reale di ~8.6pt entro la stessa
   * nota; PADDING_VERTICALE_NOTA=3.5mm sopra E sotto ogni blocco nota dà un distacco minimo di
   * almeno 2*3.5mm ≈ 19.8pt fra il blocco di una riga e quello della riga successiva (mai meno,
   * anche se la riga è più alta per via della sola Descrizione attività: il testo nota resta
   * comunque centrato nella sua stessa altezza di riga). 14pt sta a metà, con margine da entrambi.
   */
  const SOGLIA_GAP_BLOCCO_PT = 14;

  const ETICHETTE_DATI_GENERALI = [
    'punto_vendita',
    'numero_dipendenti',
    'tecnico',
    'data_sopralluogo',
    'responsabile_punto_vendita',
    'area_manager',
    'presenza_responsabile',
    'presenza_rls'
  ];

  const TESTI_HEAD_TABELLA_NOSTRO = ['n.', 'C', 'P.C', 'N.C', 'N.P', 'Note', 'Descrizione attività'];

  // ======================================================================================
  // TESTO VISIBILE — PDF COMPOSITI / FORM XOBJECT
  // ======================================================================================

  function intersezioneRettangoli(a, b) {
    if (!a || !b) return null;
    const left = Math.max(a.left, b.left);
    const top = Math.max(a.top, b.top);
    const right = Math.min(a.right, b.right);
    const bottom = Math.min(a.bottom, b.bottom);
    return right > left && bottom > top ? { left, top, right, bottom } : null;
  }

  function areaRettangolo(r) {
    return r ? Math.max(0, r.right - r.left) * Math.max(0, r.bottom - r.top) : 0;
  }

  function puntoNelRettangolo(x, y, r, margine = 0) {
    return !!r && x >= r.left - margine && x <= r.right + margine &&
      y >= r.top - margine && y <= r.bottom + margine;
  }

  function trasformaPuntoCanvas(matrix, x, y) {
    return {
      x: matrix.a * x + matrix.c * y + matrix.e,
      y: matrix.b * x + matrix.d * y + matrix.f
    };
  }

  function rettangoloCanvasDaPath(ctx, x, y, w, h) {
    const m = ctx.getTransform();
    const punti = [
      trasformaPuntoCanvas(m, x, y),
      trasformaPuntoCanvas(m, x + w, y),
      trasformaPuntoCanvas(m, x, y + h),
      trasformaPuntoCanvas(m, x + w, y + h)
    ];
    return {
      left: Math.min(...punti.map((p) => p.x)),
      top: Math.min(...punti.map((p) => p.y)),
      right: Math.max(...punti.map((p) => p.x)),
      bottom: Math.max(...punti.map((p) => p.y))
    };
  }

  function unioneRettangoli(rettangoli) {
    if (!rettangoli || !rettangoli.length) return null;
    return {
      left: Math.min(...rettangoli.map((r) => r.left)),
      top: Math.min(...rettangoli.map((r) => r.top)),
      right: Math.max(...rettangoli.map((r) => r.right)),
      bottom: Math.max(...rettangoli.map((r) => r.bottom))
    };
  }

  /**
   * Ricompatta le chiamate Canvas fillText/strokeText (PDF.js spesso disegna un glifo alla volta)
   * in frammenti testuali simili a quelli restituiti da getTextContent. Le colonne restano
   * separate: un gap orizzontale ampio apre un nuovo frammento.
   */
  function consolidaTestoRenderizzato(registrati, viewport) {
    const convertiti = (registrati || []).map((r) => {
      const origine = viewport.convertToPdfPoint(r.baseline.x, r.baseline.y);
      const fine = viewport.convertToPdfPoint(r.end.x, r.end.y);
      return {
        testo: String(r.testo || ''),
        x: Math.min(origine[0], fine[0]),
        y: origine[1],
        w: Math.max(0.1, Math.abs(fine[0] - origine[0])),
        ordine: r.ordine
      };
    }).filter((r) => r.testo !== '');

    // Doppio fill/stroke sullo stesso glifo: tenerne uno solo.
    const deduplicati = [];
    [...convertiti].sort((a, b) => a.ordine - b.ordine).forEach((r) => {
      const duplicato = deduplicati.findLast
        ? deduplicati.findLast((p) =>
            p.testo === r.testo && Math.abs(p.x - r.x) <= 0.7 &&
            Math.abs(p.y - r.y) <= 0.7 && Math.abs(p.w - r.w) <= 1.2)
        : [...deduplicati].reverse().find((p) =>
            p.testo === r.testo && Math.abs(p.x - r.x) <= 0.7 &&
            Math.abs(p.y - r.y) <= 0.7 && Math.abs(p.w - r.w) <= 1.2);
      if (!duplicato) deduplicati.push(r);
    });

    const linee = [];
    [...deduplicati].sort((a, b) => b.y - a.y || a.x - b.x).forEach((item) => {
      let linea = linee.find((l) => Math.abs(l.y - item.y) <= 1.6);
      if (!linea) {
        linea = { y: item.y, items: [] };
        linee.push(linea);
      }
      linea.items.push(item);
    });

    const risultato = [];
    linee.forEach((linea) => {
      const items = linea.items.sort((a, b) => a.x - b.x);
      let run = null;
      const chiudi = () => {
        if (!run) return;
        run.testo = run.testo.replace(/\s+/g, ' ').trim();
        if (run.testo) risultato.push(run);
        run = null;
      };
      items.forEach((item) => {
        const testo = item.testo.replace(/\s+/g, ' ');
        if (!testo) return;
        if (!run) {
          run = { testo, x: item.x, y: linea.y, w: item.w, ordine: item.ordine };
          return;
        }
        const fineRun = run.x + run.w;
        const gap = item.x - fineRun;
        if (gap > 8 || item.x < run.x - 1) {
          chiudi();
          run = { testo, x: item.x, y: linea.y, w: item.w, ordine: item.ordine };
          return;
        }
        const separatore = gap > 0.9 && !/\s$/.test(run.testo) && !/^\s/.test(testo) ? ' ' : '';
        run.testo += separatore + testo;
        run.w = Math.max(run.w, item.x + item.w - run.x);
        run.ordine = Math.max(run.ordine, item.ordine);
      });
      chiudi();
    });
    return risultato;
  }

  /**
   * PDF.js getTextContent include anche il testo di Form XObject fuori dal loro BBox e il testo
   * poi coperto da rettangoli opachi disegnati successivamente. Nei PDF Interparking legacy
   * questo produce righe fantasma e note sovrapposte pur con una pagina visivamente corretta.
   *
   * Qui sfruttiamo il renderer Canvas di PDF.js come fonte della verità VISIVA: intercettiamo
   * fillText/strokeText, rispettiamo i clip applicati dal renderer e cancelliamo dal modello
   * testuale gli elementi poi coperti da rettangoli opachi. Nessun OCR: il testo resta quello
   * vettoriale del PDF, ma filtrato con la stessa sequenza grafica usata per disegnare la pagina.
   */
  async function estraiTestoVisibileRenderizzato(pagina) {
    if (typeof document === 'undefined' || !document.createElement) return null;

    const viewport = pagina.getViewport({ scale: 1 });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.ceil(viewport.width));
    canvas.height = Math.max(1, Math.ceil(viewport.height));
    const ctx = canvas.getContext('2d');
    if (!ctx || typeof ctx.getTransform !== 'function') return null;

    const originali = {};
    const nomi = ['save','restore','beginPath','rect','clip','fill','stroke','fillRect','clearRect','fillText','strokeText'];
    for (const nome of nomi) {
      if (typeof ctx[nome] !== 'function') return null;
      originali[nome] = ctx[nome].bind(ctx);
    }

    const fullClip = { left: 0, top: 0, right: canvas.width, bottom: canvas.height };
    let clip = { ...fullClip };
    const stackClip = [];
    let pathRects = [];
    let ordine = 0;
    let testi = [];
    let rettangoliVisibili = [];

    const clipRect = (r) => intersezioneRettangoli(r, clip);
    const centro = (r) => ({ x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 });

    const rimuoviCoperti = (r) => {
      if (!r || areaRettangolo(r) < 12) return;
      testi = testi.filter((t) => {
        const inter = intersezioneRettangoli(t.bbox, r);
        if (!inter) return true;
        const ratio = areaRettangolo(inter) / Math.max(1, areaRettangolo(t.bbox));
        return ratio < 0.62;
      });
      rettangoliVisibili = rettangoliVisibili.filter((vecchio) => {
        const c = centro(vecchio);
        return !puntoNelRettangolo(c.x, c.y, r, 0.5);
      });
    };

    const registraRettangolo = (r, opaco) => {
      const visibile = clipRect(r);
      if (!visibile || areaRettangolo(visibile) < 12) return;
      if (opaco) rimuoviCoperti(visibile);
      const larghezza = visibile.right - visibile.left;
      const altezza = visibile.bottom - visibile.top;
      // Solo rettangoli utili come celle/bordi: niente sfondo pagina intera o micro-elementi.
      if (larghezza >= 8 && altezza >= 3 &&
          larghezza < canvas.width * 0.97 && altezza < canvas.height * 0.75) {
        rettangoliVisibili.push(visibile);
      }
    };

    const registraTesto = (testo, x, y) => {
      const valore = String(testo ?? '');
      if (!valore) return;
      const m = ctx.getTransform();
      const metriche = ctx.measureText(valore);
      const larghezza = Math.max(0.5, metriche.width || valore.length * 3);
      const fontPx = Math.max(6, Number.parseFloat(String(ctx.font || '').match(/[\d.]+/)?.[0] || '10'));
      const salita = metriche.actualBoundingBoxAscent || fontPx * 0.78;
      const discesa = metriche.actualBoundingBoxDescent || fontPx * 0.22;
      let xSinistra = x;
      if (ctx.textAlign === 'center') xSinistra -= larghezza / 2;
      else if (ctx.textAlign === 'right' || ctx.textAlign === 'end') xSinistra -= larghezza;
      const punti = [
        trasformaPuntoCanvas(m, xSinistra, y - salita),
        trasformaPuntoCanvas(m, xSinistra + larghezza, y - salita),
        trasformaPuntoCanvas(m, xSinistra, y + discesa),
        trasformaPuntoCanvas(m, xSinistra + larghezza, y + discesa)
      ];
      const bbox = {
        left: Math.min(...punti.map((p) => p.x)),
        top: Math.min(...punti.map((p) => p.y)),
        right: Math.max(...punti.map((p) => p.x)),
        bottom: Math.max(...punti.map((p) => p.y))
      };
      const inter = intersezioneRettangoli(bbox, clip);
      if (!inter || areaRettangolo(inter) / Math.max(1, areaRettangolo(bbox)) < 0.18) return;

      const baseline = trasformaPuntoCanvas(m, xSinistra, y);
      const end = trasformaPuntoCanvas(m, xSinistra + larghezza, y);
      testi.push({ testo: valore, bbox, baseline, end, ordine: ordine += 1 });
    };

    ctx.save = (...args) => {
      stackClip.push({ ...clip });
      return originali.save(...args);
    };
    ctx.restore = (...args) => {
      const valore = originali.restore(...args);
      clip = stackClip.pop() || { ...fullClip };
      pathRects = [];
      return valore;
    };
    ctx.beginPath = (...args) => {
      pathRects = [];
      return originali.beginPath(...args);
    };
    ctx.rect = (x, y, w, h) => {
      pathRects.push(rettangoloCanvasDaPath(ctx, x, y, w, h));
      return originali.rect(x, y, w, h);
    };
    ctx.clip = (...args) => {
      if (pathRects.length) {
        const areaPath = unioneRettangoli(pathRects);
        const nuova = intersezioneRettangoli(clip, areaPath);
        if (nuova) clip = nuova;
      }
      const valore = originali.clip(...args);
      pathRects = [];
      return valore;
    };
    ctx.fill = (...args) => {
      const opaco = (ctx.globalAlpha ?? 1) >= 0.96 && (!ctx.globalCompositeOperation || ctx.globalCompositeOperation === 'source-over');
      pathRects.forEach((r) => registraRettangolo(r, opaco));
      const valore = originali.fill(...args);
      pathRects = [];
      return valore;
    };
    ctx.stroke = (...args) => {
      pathRects.forEach((r) => registraRettangolo(r, false));
      const valore = originali.stroke(...args);
      pathRects = [];
      return valore;
    };
    ctx.fillRect = (x, y, w, h) => {
      const r = rettangoloCanvasDaPath(ctx, x, y, w, h);
      const opaco = (ctx.globalAlpha ?? 1) >= 0.96 && (!ctx.globalCompositeOperation || ctx.globalCompositeOperation === 'source-over');
      registraRettangolo(r, opaco);
      return originali.fillRect(x, y, w, h);
    };
    ctx.clearRect = (x, y, w, h) => {
      rimuoviCoperti(clipRect(rettangoloCanvasDaPath(ctx, x, y, w, h)));
      return originali.clearRect(x, y, w, h);
    };
    ctx.fillText = (testo, x, y, ...resto) => {
      registraTesto(testo, x, y);
      return originali.fillText(testo, x, y, ...resto);
    };
    ctx.strokeText = (testo, x, y, ...resto) => {
      registraTesto(testo, x, y);
      return originali.strokeText(testo, x, y, ...resto);
    };

    try {
      await pagina.render({ canvasContext: ctx, viewport }).promise;
      const items = consolidaTestoRenderizzato(testi, viewport);
      const segmenti = [];
      rettangoliVisibili.forEach((r) => {
        const p1 = viewport.convertToPdfPoint(r.left, r.top);
        const p2 = viewport.convertToPdfPoint(r.right, r.bottom);
        const x1 = Math.min(p1[0], p2[0]);
        const x2 = Math.max(p1[0], p2[0]);
        const y1 = Math.min(p1[1], p2[1]);
        const y2 = Math.max(p1[1], p2[1]);
        segmenti.push({ x1, x2, y: y1 }, { x1, x2, y: y2 });
      });
      return { items, bordi: consolidaBordiOrizzontali(segmenti) };
    } finally {
      canvas.width = canvas.height = 0;
    }
  }

  async function paginaHaFormClippatoGrande(pagina) {
    try {
      const ops = await pagina.getOperatorList();
      const O = pdfjsLib.OPS;
      const larghezzaPagina = Math.abs(pagina.view[2] - pagina.view[0]);
      const altezzaPagina = Math.abs(pagina.view[3] - pagina.view[1]);
      for (let i = 0; i < ops.fnArray.length; i += 1) {
        if (ops.fnArray[i] !== O.paintFormXObjectBegin) continue;
        const args = ops.argsArray[i] || [];
        const bbox = args[1];
        if (!Array.isArray(bbox) || bbox.length < 4) continue;
        const w = Math.abs(bbox[2] - bbox[0]);
        const h = Math.abs(bbox[3] - bbox[1]);
        if (w >= larghezzaPagina * 0.72 && h >= Math.max(35, altezzaPagina * 0.04)) return true;
      }
    } catch (_) {
      // Il percorso tradizionale getTextContent resta sempre disponibile come fallback.
    }
    return false;
  }

  /**
   * Trova sulla pagina le intestazioni di colonna della tabella sezione ('n.', 'C', 'P.C',
   * 'N.C', 'N.P', 'Note') e ne ricava la coordinata x di riferimento. Le intestazioni si
   * ripetono a ogni tabella/sezione e a ogni pagina, sempre alla stessa x (layout fisso):
   * basta trovarne una sola occorrenza per ricavare le colonne dell'intera pagina.
   */
  function trovaIntestazioniColonneNostro(items) {
    // Non usare il primo "C" trovato nel flusso PDF: il footer può essere disegnato prima della
    // tabella e contenere a sua volta "C / P.C / N.C / N.P". Le intestazioni vere devono stare
    // sulla stessa riga geometrica di "n." e nell'ordine orizzontale atteso.
    const idCandidates = items.filter((it) => it.testo.trim() === 'n.');
    for (const idH of idCandidates) {
      const vicino = (testo) => items.find((it) =>
        it.testo.trim() === testo &&
        Math.abs(it.y - idH.y) <= 5 &&
        it.x > idH.x
      );
      const cH = vicino('C');
      const pcH = vicino('P.C');
      const ncH = vicino('N.C');
      const npH = vicino('N.P');
      const noteH = vicino('Note');
      if (!cH || !pcH || !ncH || !npH || !noteH) continue;
      if (!(cH.x < pcH.x && pcH.x < ncH.x && ncH.x < npH.x && npH.x < noteH.x)) continue;

      return {
        idX: idH.x,
        C: cH.x,
        PC: pcH.x,
        NC: ncH.x,
        NA: npH.x,
        noteX: noteH.x,
        // La soglia NON è il punto medio fra le due intestazioni: "Note" è centrata nella sua
        // colonna larga, mentre il testo delle note parte subito dopo N.P. Nei PDF Interparking
        // reali la prima parola della nota può iniziare circa 18-20 pt dopo la x dell'etichetta
        // N.P.; usare +20 con confronto stretto ">" perdeva proprio la prima parola. +12 resta
        // oltre qualunque X della colonna N.P ma include integralmente il testo della nota.
        sogliaNota: npH.x + 12
      };
    }
    return null;
  }

  /** Tutte le occorrenze dell'intestazione 'n.' sulla pagina: una per ogni tabella di sezione presente. */
  function trovaTutteIntestazioniN(items, colonne) {
    return items
      .filter((it) => it.testo.trim() === 'n.' && Math.abs(it.x - colonne.idX) < TOLLERANZA_COLONNA_ID_PT)
      .map((it) => ({ y: it.y }))
      .sort((a, b) => b.y - a.y);
  }

  /**
   * Titolo della tabella di sezione appena sopra una data intestazione "n." (best-effort, solo
   * dato informativo preservato in sezione_originale: il matching per il formato "nostro" non
   * dipende mai da questo, si affida all'id — vedi js/import-matching.js). Ritorna null se non
   * trovato, senza far fallire nulla: sezione_originale resta semplicemente vuoto per quella riga.
   */
  function trovaTitoloSezione(items, headerN, colonne) {
    const candidati = items.filter(
      (it) =>
        it.y > headerN.y &&
        it.y <= headerN.y + TOLLERANZA_TITOLO_SEZIONE_PT &&
        it.x >= colonne.idX - 5 &&
        it.x < colonne.C - TOLLERANZA_COLONNA_ID_PT &&
        !TESTI_HEAD_TABELLA_NOSTRO.includes(it.testo.trim())
    );
    if (!candidati.length) {
      return null;
    }
    return ricomponiTesto(raggruppaInLinee(candidati, TOLLERANZA_RIGA_PT)) || null;
  }

  /** Colonna di stato più vicina in x a una "X" trovata (le colonne sono spaziate a sufficienza da non creare ambiguità). */
  function colonnaStatoPiuVicina(x, colonne) {
    const candidate = [
      ['C', colonne.C],
      ['PC', colonne.PC],
      ['NC', colonne.NC],
      ['NA', colonne.NA]
    ];
    candidate.sort((a, b) => Math.abs(x - a[1]) - Math.abs(x - b[1]));
    return candidate[0][0];
  }

  /** Una marcatura di stato è valida sia come "X" sia come "x": nei PDF reali esistono entrambe. */
  function eMarcaturaStato(item) {
    return String(item && item.testo != null ? item.testo : '').trim().toUpperCase() === 'X';
  }

  /**
   * Elimina esclusivamente i numeri della colonna "n." che occupano praticamente la stessa
   * posizione. È un artefatto del livello testo di alcuni PDF Interparking: sotto al numero
   * progressivo visibile resta il vecchio id stabile. L'ordine degli elementi di getTextContent()
   * segue l'ordine di disegno, quindi l'ultimo è il valore effettivamente sovrapposto e visibile.
   *
   * La deduplicazione è volutamente geometrica e limitata alla sola colonna id: non tocca numeri
   * presenti nel testo delle domande o nelle note e non fonde due righe reali adiacenti.
   */
  function filtraIdRigaSovrapposti(items, colonne) {
    if (!colonne || !Number.isFinite(colonne.idX)) return items;

    const candidati = items
      .map((it, indice) => ({ it, indice }))
      .filter(({ it }) =>
        /^\d+$/.test(String(it.testo || '').trim()) &&
        Math.abs(it.x - colonne.idX) < TOLLERANZA_COLONNA_ID_PT
      );

    const gruppi = [];
    candidati.forEach((candidato) => {
      let gruppo = gruppi.find((g) =>
        Math.abs(candidato.it.x - g.x) <= TOLLERANZA_ID_SOVRAPPOSTO_X_PT &&
        Math.abs(candidato.it.y - g.y) <= TOLLERANZA_ID_SOVRAPPOSTO_Y_PT
      );
      if (!gruppo) {
        gruppo = { x: candidato.it.x, y: candidato.it.y, voci: [] };
        gruppi.push(gruppo);
      }
      gruppo.voci.push(candidato);
    });

    const indiciDaScartare = new Set();
    gruppi.forEach((gruppo) => {
      if (gruppo.voci.length < 2) return;
      const daTenere = gruppo.voci.reduce(
        (ultimo, voce) => (voce.indice > ultimo.indice ? voce : ultimo),
        gruppo.voci[0]
      );
      gruppo.voci.forEach((voce) => {
        if (voce.indice !== daTenere.indice) indiciDaScartare.add(voce.indice);
      });
    });

    return indiciDaScartare.size
      ? items.filter((_, indice) => !indiciDaScartare.has(indice))
      : items;
  }

  /**
   * Ricostruisce i possibili numeri presenti nella cella "n.". Alcuni PDF Interparking reali
   * hanno DUE livelli testo sovrapposti (id stabile + progressivo) e, in alcuni casi, PDF.js
   * spezza un numero a due cifre in due frammenti distinti (es. "5" + "1"). Qui ogni baseline
   * viene ricomposta in un numero candidato senza creare righe fantasma 1/5/6 ecc.
   */
  function numeriCandidatiCellaNostro(cella, idX) {
    const numerici = cella.filter((it) =>
      /^\d+$/.test(String(it.testo || '').trim()) &&
      it.x >= idX - TOLLERANZA_COLONNA_ID_PT &&
      it.x <= idX + TOLLERANZA_COLONNA_ID_PT + 6
    );
    if (!numerici.length) return [];

    const linee = [];
    [...numerici].sort((a, b) => b.y - a.y || a.x - b.x).forEach((it) => {
      let linea = linee.find((l) => Math.abs(l.y - it.y) <= 0.8);
      if (!linea) {
        linea = { y: it.y, parti: [] };
        linee.push(linea);
      }
      linea.parti.push(it);
    });

    const valori = [];
    linee.forEach((linea) => {
      const parti = linea.parti.sort((a, b) => a.x - b.x);
      const completi = parti.filter((p) => String(p.testo).trim().length > 1);
      let testoNumero;
      if (completi.length) {
        testoNumero = String(completi.sort((a, b) => String(b.testo).length - String(a.testo).length)[0].testo).trim();
      } else {
        testoNumero = parti.map((p) => String(p.testo).trim()).join('');
      }
      const numero = Number(testoNumero);
      if (Number.isInteger(numero) && numero > 0 && !valori.includes(numero)) valori.push(numero);
    });
    return valori;
  }

  /**
   * Sceglie fra gli eventuali numeri sovrapposti quello coerente con la sequenza fisica letta
   * fin qui. Questo rende equivalenti i PDF Interparking che mostrano i vecchi progressivi e
   * quelli che mostrano gli id stabili: la riga logica resta una sola e l'ordine resta corretto.
   */
  function scegliNumeroCella(candidati, contesto) {
    if (!candidati || !candidati.length) return null;
    const precedente = Number(contesto && contesto.ultimoNumeroLetto);
    if (Number.isInteger(precedente)) {
      const atteso = precedente + 1;
      if (candidati.includes(atteso)) return atteso;
    }
    return candidati[0];
  }

  /** Più X nella stessa colonna valgono come una sola marcatura; colonne diverse restano ambigue. */
  function statoDaMarcature(marcature, colonne) {
    const stati = Array.from(new Set((marcature || []).map((it) => colonnaStatoPiuVicina(it.x, colonne))));
    return stati.length === 1 ? stati[0] : null;
  }

  /**
   * Raggruppa una lista di elementi testo in righe (per y, tolleranza) ordinate dall'alto in
   * basso: [{ y, parti }]. Con `ancoraScorrevole` la tolleranza si applica all'ultima riga
   * effettivamente aggiunta al gruppo (non alla prima incontrata): necessario per il valore della
   * riga "Tecnico" di DATI GENERALI (vedi estraiDatiGeneraliNostro), che con Interparking può
   * estendersi fino a 4 righe — con l'ancora fissa la 3ª/4ª riga si allontanerebbe troppo dalla
   * prima e romperebbe erroneamente il gruppo, disallineando tutti i campi successivi. Il
   * comportamento di default (ancora fissa) resta invariato per tutti gli altri usi di questa
   * funzione, che raggruppano solo frammenti della STESSA riga visiva.
   */
  function raggruppaInLinee(items, tolleranza, ancoraScorrevole = false) {
    const ordinati = [...items].sort((a, b) => b.y - a.y);
    const linee = [];
    ordinati.forEach((parte) => {
      const ultima = linee[linee.length - 1];
      if (ultima && Math.abs(ultima.y - parte.y) <= tolleranza) {
        ultima.parti.push(parte);
        if (ancoraScorrevole) {
          ultima.y = parte.y;
        }
      } else {
        linee.push({ y: parte.y, parti: [parte] });
      }
    });
    return linee;
  }

  /** Ricompone il testo di più righe (già raggruppate da raggruppaInLinee) unendo per x poi per riga. */
  function ricomponiTesto(linee) {
    return linee
      .map((riga) => riga.parti.sort((a, b) => a.x - b.x).map((p) => p.testo).join(' '))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Raggruppa delle righe di testo già ordinate dall'alto in basso (vedi raggruppaInLinee) in
   * "blocchi" di righe contigue: una riga entra nel blocco corrente se il gap dalla riga
   * precedente è inferiore a SOGLIA_GAP_BLOCCO_PT (interlinea normale dentro una nota multi-
   * riga), altrimenti apre un blocco nuovo (il gap più ampio segnala il passaggio a una nota/
   * domanda diversa). Ritorna [{ y, testo }], con `y` pari alla MEDIA delle y di tutte le righe
   * del blocco — non alla y di una singola riga.
   */
  function raggruppaInBlocchi(linee) {
    const blocchi = [];
    linee.forEach((riga) => {
      const blocco = blocchi[blocchi.length - 1];
      const ultimaRiga = blocco && blocco.righe[blocco.righe.length - 1];
      if (ultimaRiga && ultimaRiga.y - riga.y < SOGLIA_GAP_BLOCCO_PT) {
        blocco.righe.push(riga);
      } else {
        blocchi.push({ righe: [riga] });
      }
    });
    return blocchi.map((blocco) => ({
      y: blocco.righe.reduce((somma, r) => somma + r.y, 0) / blocco.righe.length,
      testo: ricomponiTesto(blocco.righe)
    }));
  }

  /**
   * Assegna dei candidati di testo (già filtrati a una colonna) alla riga più vicina in y, entro
   * una tolleranza: stessa tecnica usata sia per le note (colonna a destra) sia, qui sotto, per il
   * testo della domanda (colonna centrale). L'assegnazione avviene per BLOCCO di righe contigue
   * (vedi raggruppaInBlocchi), non riga per riga: sia il testo nota sia il numero "n." sono
   * disegnati centrati verticalmente nella stessa altezza di riga della tabella (styles.valign:
   * 'middle' in js/pdf.js), quindi la y MEDIA di un intero blocco coincide con la y del numero
   * "n." della domanda a cui appartiene molto più precisamente della y di una sua singola riga —
   * che, specie nell'ultima riga di una nota lunga (5+ righe), può ricadere numericamente più
   * vicina al numero della domanda SUCCESSIVA se questa ha una riga più corta o senza nota,
   * "rubandole" quella riga (bug osservato concretamente con note lunghe su domande consecutive:
   * l'assegnazione riga-per-riga spezzava a metà l'ultima riga di una nota fra la domanda giusta
   * e quella dopo). Ritorna Map<id, testo ricomposto>.
   */
  function assegnaTestoAllaRigaPiuVicina(candidati, righe, tolleranza) {
    const linee = raggruppaInLinee(candidati, TOLLERANZA_RIGA_PT);
    const blocchi = raggruppaInBlocchi(linee);

    const testoPerId = new Map();
    blocchi.forEach((blocco) => {
      if (!blocco.testo) {
        return;
      }
      let rigaVicina = null;
      let distanzaMinima = Infinity;
      righe.forEach((riga) => {
        const distanza = Math.abs(blocco.y - riga.y);
        if (distanza < distanzaMinima) {
          distanzaMinima = distanza;
          rigaVicina = riga;
        }
      });
      if (!rigaVicina || distanzaMinima > tolleranza) {
        return;
      }
      const precedente = testoPerId.get(rigaVicina.id);
      testoPerId.set(rigaVicina.id, precedente ? `${precedente} ${blocco.testo}` : blocco.testo);
    });
    return testoPerId;
  }

  /**
   * Consolida i segmenti orizzontali in veri bordi di riga. I PDF Interparking possono contenere
   * una seconda tabella/testo invisibile che disegna piccoli segmenti SOLO dentro la cella "n.":
   * se quei segmenti vengono scambiati per bordi di riga, una singola domanda viene spezzata in
   * più celle. Un bordo reale, invece, copre complessivamente una parte sostanziale della tabella
   * (anche quando AutoTable lo disegna come 7 segmenti adiacenti, uno per colonna).
   */
  function consolidaBordiOrizzontali(segmenti) {
    if (!segmenti || !segmenti.length) return [];
    const gruppi = [];
    [...segmenti].sort((a, b) => b.y - a.y).forEach((segmento) => {
      let gruppo = gruppi.find((g) => Math.abs(g.y - segmento.y) <= 0.8);
      if (!gruppo) {
        gruppo = { y: segmento.y, segmenti: [] };
        gruppi.push(gruppo);
      }
      gruppo.segmenti.push(segmento);
    });

    const misurati = gruppi.map((gruppo) => {
      const intervalli = gruppo.segmenti
        .map((x) => [Math.min(x.x1, x.x2), Math.max(x.x1, x.x2)])
        .sort((a, b) => a[0] - b[0]);
      const uniti = [];
      intervalli.forEach(([x1, x2]) => {
        const ultimo = uniti[uniti.length - 1];
        if (ultimo && x1 <= ultimo[1] + 1) ultimo[1] = Math.max(ultimo[1], x2);
        else uniti.push([x1, x2]);
      });
      const copertura = uniti.reduce((somma, [x1, x2]) => somma + (x2 - x1), 0);
      const x1 = Math.min(...uniti.map((x) => x[0]));
      const x2 = Math.max(...uniti.map((x) => x[1]));
      return { y: gruppo.y, x1, x2, copertura };
    });
    const coperturaMassima = Math.max(...misurati.map((x) => x.copertura));
    const soglia = Math.max(80, coperturaMassima * 0.35);
    return misurati
      .filter((x) => x.copertura >= soglia)
      .map(({ x1, x2, y }) => ({ x1, x2, y }));
  }

  /** Bordi orizzontali reali delle celle, in coordinate PDF (prima del viewport). */
  async function estraiBordiTabella(pagina) {
    const ops = await pagina.getOperatorList(), O = pdfjsLib.OPS;
    let matrix = [1, 0, 0, 1, 0, 0];
    const stack = [], segmenti = [];
    const punto = (x, y) => pdfjsLib.Util.applyTransform([x, y], matrix);
    const segmento = (a, b) => {
      if (Math.abs(a[1] - b[1]) < 0.5 && Math.abs(a[0] - b[0]) > 5)
        segmenti.push({ x1: Math.min(a[0], b[0]), x2: Math.max(a[0], b[0]), y: (a[1] + b[1]) / 2 });
    };
    for (let i = 0; i < ops.fnArray.length; i++) {
      const fn = ops.fnArray[i], args = ops.argsArray[i];
      if (fn === O.save || fn === O.paintFormXObjectBegin) {
        stack.push(matrix.slice());
        if (fn === O.paintFormXObjectBegin && args[0]) matrix = pdfjsLib.Util.transform(matrix, args[0]);
      } else if (fn === O.restore || fn === O.paintFormXObjectEnd) matrix = stack.pop() || [1,0,0,1,0,0];
      else if (fn === O.transform) matrix = pdfjsLib.Util.transform(matrix, args);
      else if (fn === O.constructPath) {
        const codes = args[0], values = args[1]; let k = 0, last = null, start = null;
        for (const code of codes) {
          if (code === O.rectangle) {
            const x=values[k++], y=values[k++], w=values[k++], h=values[k++];
            segmento(punto(x,y), punto(x+w,y)); segmento(punto(x,y+h), punto(x+w,y+h));
          } else if (code === O.moveTo) { last=punto(values[k++],values[k++]); start=last; }
          else if (code === O.lineTo) { const next=punto(values[k++],values[k++]); if(last) segmento(last,next); last=next; }
          else if (code === O.closePath) { if(last && start) segmento(last,start); last=start; }
          else if (code === O.curveTo) { k+=6; last=null; }
          else if (code === O.curveTo2 || code === O.curveTo3) { k+=4; last=null; }
        }
      }
    }
    return consolidaBordiOrizzontali(segmenti);
  }

  /** Una cella/riga sorgente contiene insieme domanda, stato e nota, anche tra pagine. */
  function righeDaCelle(items, colonne, bordi, contesto, formato) {
    if (!bordi || !bordi.length) return null;
    const storico = formato === 'storico';
    const idX = storico ? CENTRO_COLONNA_ID_STORICO : colonne.idX;
    const limiti = Array.from(new Set(bordi.filter(b => b.x1 <= idX + 3 && b.x2 >= idX).map(b => Math.round(b.y * 10) / 10))).sort((a,b) => b-a);
    if (limiti.length < 2) return null;
    const risultato = [];
    let sezione = contesto.titolo || null;
    for (let i=0; i<limiti.length-1; i++) {
      const top=limiti[i], bottom=limiti[i+1];
      const cella=items.filter(it => it.y < top && it.y > bottom);
      if (!cella.length) continue;
      const header=cella.some(it => storico ? INTESTAZIONI_STORICO.includes(it.testo.trim()) : it.testo.trim()==='n.');
      const banner=cella.find(it => /^(AUDIT DOCUMENTALE|ANALISI DOCUMENTALE|SOPRALLUOGO AMBIENTI DI LAVORO)$/.test(it.testo.trim()));
      if (banner) { sezione=banner.testo; contesto.ultimaRiga=null; continue; }
      if (header) {
        if (!storico) {
          const h=cella.find(it => it.testo.trim()==='n.');
          const titolo=h && trovaTitoloSezione(items,h,colonne);
          if (titolo && titolo!==sezione) { sezione=titolo; contesto.ultimaRiga=null; }
        }
        continue;
      }
      const ancoreStorico = storico
        ? cella.filter(it => Math.abs(it.x-idX)<20 && /^\d+\)$/.test(it.testo.trim()))
        : [];
      const candidatiNumero = storico
        ? ancoreStorico.map((it) => parseInt(it.testo, 10)).filter(Number.isInteger)
        : numeriCandidatiCellaNostro(cella, idX);
      const numero = storico
        ? (candidatiNumero.length === 1 ? candidatiNumero[0] : null)
        : scegliNumeroCella(candidatiNumero, contesto);
      const testo=ricomponiTesto(raggruppaInLinee(cella.filter(it => it.x>idX+(storico ? MARGINE_TESTO_DOMANDA_STORICO_PT : 10) && it.x<colonne.C-10),3));
      const nota=ricomponiTesto(raggruppaInLinee(cella.filter(it => it.x>colonne.sogliaNota),3));
      const marks=cella.filter(it => eMarcaturaStato(it) && it.x>=colonne.C-10 && it.x<colonne.sogliaNota);
      if (numero != null) {
        const riga={ formato, numero_originale:numero, id_originale:storico ? null : numero,
          sezione_originale:sezione, testo_originale:testo, stato_originale:statoDaMarcature(marks,colonne), nota_originale:nota || null };
        // AutoTable may repeat the identifier on a split row on the next page.
        const precedente=contesto.ultimaRiga;
        if (!risultato.length && precedente && precedente.numero_originale===numero && precedente.sezione_originale===sezione) {
          precedente.testo_originale=[precedente.testo_originale,testo].filter(Boolean).join(' ');
          precedente.nota_originale=[precedente.nota_originale,nota].filter(Boolean).join(' ') || null;
        } else {
          risultato.push(riga);
          contesto.ultimaRiga=riga;
          if (!storico) contesto.ultimoNumeroLetto=numero;
        }
      } else if (!candidatiNumero.length && (nota || testo) && contesto.ultimaRiga && !risultato.length) {
        const precedente=contesto.ultimaRiga;
        precedente.testo_originale=[precedente.testo_originale,testo].filter(Boolean).join(' ');
        precedente.nota_originale=[precedente.nota_originale,nota].filter(Boolean).join(' ') || null;
      }
    }
    contesto.titolo=sezione;
    return risultato;
  }

  /**
   * Estrae le righe grezze della tabella sezione presenti in questa pagina, con TUTTI i dati
   * originali preservati (id/numero/testo/stato/nota) — nessun filtro su quali id siano "validi"
   * per una checklist: questo modulo non conosce ancora la checklist target. `sezioneCorrente` è
   * lo stato mutabile (oggetto con proprietà `titolo`) tracciato dal chiamante fra una pagina e
   * l'altra: se una tabella prosegue su più pagine senza un nuovo titolo, le righe ereditano
   * l'ultimo titolo di sezione visto.
   */
  function estraiRighePaginaNostro(items, colonne, sezioneCorrente) {
    const intestazioniN = trovaTutteIntestazioniN(items, colonne);
    intestazioniN.forEach((headerN) => {
      const titolo = trovaTitoloSezione(items, headerN, colonne);
      if (titolo) {
        sezioneCorrente.titolo = titolo;
      }
    });

    const righe = items
      .filter((it) => /^\d+$/.test(it.testo.trim()) && Math.abs(it.x - colonne.idX) < TOLLERANZA_COLONNA_ID_PT)
      .map((it) => ({ id: parseInt(it.testo.trim(), 10), y: it.y }));

    if (!righe.length) {
      return [];
    }

    // Titolo di sezione per riga: quello dell'ultima intestazione "n." incontrata SOPRA (y
    // maggiore) la riga stessa, o quello ereditato dalla pagina precedente se la riga precede
    // ogni intestazione trovata su questa pagina (tabella proseguita senza titolo ripetuto).
    const titoloPerRiga = (rigaY) => {
      const precedente = [...intestazioniN].reverse().find((h) => h.y >= rigaY);
      return precedente ? (trovaTitoloSezione(items, precedente, colonne) || sezioneCorrente.titolo) : sezioneCorrente.titolo;
    };

    const marcaturePerRiga = new Map();
    righe.forEach((riga) => {
      const marcature = items.filter(
        (it) => eMarcaturaStato(it) && Math.abs(it.y - riga.y) <= TOLLERANZA_RIGA_PT
      );
      if (marcature.length === 1) {
        marcaturePerRiga.set(riga.id, colonnaStatoPiuVicina(marcature[0].x, colonne));
      }
      // 0 marcature o più di una: stato_originale resta null, non si indovina.
    });

    const candidatiNota = items.filter((it) => it.x > colonne.sogliaNota && it.testo.trim() !== 'Note');
    const notePerRiga = assegnaTestoAllaRigaPiuVicina(candidatiNota, righe, TOLLERANZA_RIGA_NOTA_PT);

    // Colonna "Descrizione attività": subito dopo l'id (con margine, per non riassorbire la
    // cifra stessa) e prima della colonna "C" (con margine, per restare fuori dalle "X" di stato).
    const candidatiDomanda = items.filter(
      (it) =>
        it.x > colonne.idX + TOLLERANZA_COLONNA_ID_PT &&
        it.x < colonne.C - TOLLERANZA_COLONNA_ID_PT &&
        it.testo.trim() !== 'Descrizione attività'
    );
    const testoPerRiga = assegnaTestoAllaRigaPiuVicina(candidatiDomanda, righe, TOLLERANZA_RIGA_NOTA_PT);

    return righe.map((riga) => ({
      formato: 'nostro',
      id_originale: riga.id,
      numero_originale: riga.id,
      sezione_originale: titoloPerRiga(riga.y),
      testo_originale: testoPerRiga.get(riga.id) || '',
      stato_originale: marcaturePerRiga.get(riga.id) || null,
      nota_originale: notePerRiga.get(riga.id) || null
    }));
  }

  /**
   * Estrae i campi della tabella "DATI GENERALI" (solo pagina 1): individua la fascia y della
   * tabella (dal titolo "DATI GENERALI" alla prima intestazione "n." della prima tabella
   * sezione), poi separa etichette e valori in base al distacco orizzontale più ampio tra gli
   * elementi di quella fascia (le due colonne della tabella), infine associa ogni gruppo di
   * righe-valore, nell'ordine dall'alto in basso, alla riga corrispondente (l'ordine delle 7
   * righe è fisso, sempre lo stesso: vedi disegnaTabellaDatiGenerali).
   */
  function estraiDatiGeneraliNostro(items) {
    const headerDati = items.find((it) => it.testo.trim() === 'DATI GENERALI');
    if (!headerDati) {
      return {};
    }
    const primaIntestazioneSezione = items.find((it) => it.testo.trim() === 'n.');

    const yMax = headerDati.y - 1;
    const yMin = primaIntestazioneSezione ? primaIntestazioneSezione.y : -Infinity;
    const zonaTabella = items.filter((it) => it.y < yMax && it.y > yMin);
    if (!zonaTabella.length) {
      return {};
    }

    const xOrdinati = [...new Set(zonaTabella.map((it) => it.x))].sort((a, b) => a - b);
    let sogliaValore = null;
    let scartoMassimo = 0;
    for (let i = 1; i < xOrdinati.length; i += 1) {
      const scarto = xOrdinati[i] - xOrdinati[i - 1];
      if (scarto > scartoMassimo) {
        scartoMassimo = scarto;
        sogliaValore = (xOrdinati[i] + xOrdinati[i - 1]) / 2;
      }
    }
    if (sogliaValore === null) {
      return {};
    }

    const righeValore = raggruppaInLinee(
      zonaTabella.filter((it) => it.x >= sogliaValore),
      TOLLERANZA_RIGA_MULTILINEA_PT,
      true
    );

    const risultato = {};
    // Dipendenti e Area Manager sono righe opzionali: ricostruisci l'ordine reale
    // guardando le etichette presenti, così vecchi PDF e nuovi PDF restano entrambi importabili.
    const contieneDipendenti = zonaTabella.some(it => /numero.*dipendenti/i.test(it.testo));
    const contieneAreaManager = zonaTabella.some(it => /^area manager$/i.test(it.testo.trim()));
    const etichette = ETICHETTE_DATI_GENERALI.filter((chiave) => {
      if (chiave === 'numero_dipendenti') return contieneDipendenti;
      if (chiave === 'area_manager') return contieneAreaManager;
      return true;
    });
    etichette.forEach((chiave, indice) => {
      const riga = righeValore[indice];
      if (!riga) {
        return;
      }
      const parti = riga.parti.sort((a, b) => b.y - a.y);
      if (chiave === 'punto_vendita' && parti.length >= 2) {
        risultato.punto_vendita = parti[0].testo.trim();
        risultato.indirizzo_punto_vendita = parti.slice(1).map((p) => p.testo.trim()).join(' ').trim();
      } else {
        risultato[chiave] = parti.map((p) => p.testo.trim()).join(' ').trim();
      }
    });

    return risultato;
  }

  // Legenda di piè di pagina ("C = Conforme; P.C = Parzialmente conforme; ..."), ripetuta su
  // OGNI pagina dal generatore PDF (vedi js/pdf.js, legenda via didDrawPage): capita di essere il
  // primo elemento di testo restituito da pdf.js per una pagina (l'ordine di getTextContent segue
  // l'ordine di disegno nello stream, non la posizione verticale), quindi va sempre esclusa a
  // priori da qualunque lettura strutturale — non è mai un titolo, una domanda o una nota.
  const REGEX_LEGENDA_PIE_PAGINA = /^C\s*=\s*Conforme/i;
  const REGEX_NUMERO_PAGINA = /^Pag\.\s*\d+\s+di\s+\d+$/i;

  /**
   * Prova il formato "nostro" sull'intero documento (pagine già estratte). Ritorna
   * { righe, anagrafica, strutturaRiconosciuta } — righe grezze, nessun abbinamento a domande.
   */
  function provaFormatoNostro(pagine) {
    const righe = [];
    let anagrafica = {};
    let colonneCorrenti = null;
    let strutturaRiconosciuta = false;
    const sezioneCorrente = { titolo: null };

    pagine.forEach((itemsGrezzi, indice) => {
      const numeroPagina = indice + 1;
      let items = itemsGrezzi.filter((it) =>
        !REGEX_LEGENDA_PIE_PAGINA.test(it.testo.trim()) &&
        !REGEX_NUMERO_PAGINA.test(it.testo.trim())
      );
      const intestazioni = trovaIntestazioniColonneNostro(items);
      if (intestazioni) {
        colonneCorrenti = intestazioni;
        strutturaRiconosciuta = true;
      }

      if (numeroPagina === 1) {
        anagrafica = estraiDatiGeneraliNostro(items);
      }

      if (colonneCorrenti) {
        // Se esistono i bordi reali della tabella, la cella è la fonte autorevole. Non mischiare
        // il fallback per numero: nei PDF Interparking legacy id invisibili e cifre spezzate
        // generavano righe fantasma che contaminavano domande, stati e note di pagine diverse.
        const daCelle = righeDaCelle(items, colonneCorrenti, itemsGrezzi.bordi, sezioneCorrente, 'nostro');
        if (daCelle === null) {
          const itemsFallback = filtraIdRigaSovrapposti(items, colonneCorrenti);
          righe.push(...estraiRighePaginaNostro(itemsFallback, colonneCorrenti, sezioneCorrente));
        } else {
          righe.push(...daCelle);
        }
      }
    });

    return { righe, anagrafica, strutturaRiconosciuta };
  }

  // ======================================================================================
  // FORMATO "STORICO" (vecchio formato Coin, non generato da questa app)
  // ======================================================================================

  const TOLLERANZA_FRAMMENTO_ADIACENTE_PT = 1.2;
  const CENTRO_COLONNA_ID_STORICO = 32;
  const TOLLERANZA_COLONNA_ID_STORICO_PT = 20;
  /**
   * Margine (più stretto di TOLLERANZA_COLONNA_ID_STORICO_PT) fra il marcatore "N)" e l'inizio
   * del testo della domanda: su un PDF storico reale il testo inizia subito dopo il marcatore
   * (~17pt di distanza dal suo centro, es. "1)" a x=31 e il testo a x=49), non con lo stesso
   * margine usato per riconoscere il marcatore stesso — un margine troppo largo qui tagliava
   * silenziosamente le prime righe di ogni domanda multi-riga (bug osservato importando un PDF
   * storico reale: solo l'ultima riga di testo, quella più a destra del rientro, superava la
   * soglia, tutte le precedenti venivano scartate).
   */
  const MARGINE_TESTO_DOMANDA_STORICO_PT = 10;
  const REGEX_RIGA_STORICO = /^(\d+)[.)]?$/;
  const INTESTAZIONI_STORICO = ['C', 'PC', 'NC', 'NA', 'NP', 'NOTE'];
  /**
   * Etichette alternative accettate per la 4a colonna di stato: l'app usa internamente sempre il
   * codice "NA" (vedi js/pdf.js, segnoRisposta/COLORE_COLONNA_STATO — anche se l'etichetta
   * stampata è "N.P"/"Non pertinente"), ma un vecchio PDF non generato da questa app potrebbe
   * intestare quella colonna letteralmente "NP" invece di "NA". Si riconoscono entrambe le forme
   * e si registra QUALE delle due è stata trovata (vedi provaFormatoStorico ->
   * conversioneStatoRilevata), così l'anteprima può segnalare esplicitamente l'eventuale
   * conversione invece di applicarla alla cieca senza dirlo (nessun'altra conversione di
   * vocabolario è necessaria: l'app non usa altri codici oltre a C/PC/NC/NA).
   */
  const ALIAS_QUARTA_COLONNA_STORICO = ['NA', 'NP'];

  const ETICHETTE_STORICO = [
    { chiave: 'punto_vendita', etichetta: 'Negozio' },
    { chiave: 'data_sopralluogo', etichetta: 'Data del sopralluogo' },
    { chiave: 'area_manager', etichetta: 'Area Manager' },
    { chiave: 'tecnico', etichetta: 'Tecnico' }
  ];

  const BANNER_GRUPPO_1_STORICO = ['AUDIT DOCUMENTALE', 'ANALISI DOCUMENTALE'];
  const BANNER_GRUPPO_2_STORICO = ['SOPRALLUOGO AMBIENTI DI LAVORO'];

  /**
   * Vero per un elemento che è (o potrebbe essere scambiato per) un marcatore di riga numerata
   * ("N)") o un banner di macro-sezione: questi vanno protetti dall'unione dei frammenti
   * adiacenti (vedi sotto), perché in alcune righe di questo PDF il marcatore "N)" non ha un
   * vero spazio prima del testo della domanda (es. "10)" seguito a scarto ~0 da "Le
   * scaffalature..."): senza questa protezione verrebbero uniti in un unico frammento che non
   * corrisponde più a nessuna riga numerata, perdendo silenziosamente quella domanda.
   */
  function eMarcatoreProtetto(it) {
    const testo = it.testo.trim();
    if (BANNER_GRUPPO_1_STORICO.includes(testo) || BANNER_GRUPPO_2_STORICO.includes(testo)) {
      return true;
    }
    return Math.abs(it.x - CENTRO_COLONNA_ID_STORICO) < TOLLERANZA_COLONNA_ID_STORICO_PT && REGEX_RIGA_STORICO.test(testo);
  }

  /**
   * Unisce elementi di testo praticamente adiacenti (scarto orizzontale minimo, stessa riga):
   * questo formato (diverso da jsPDF) a volte spezza in più elementi una singola parola o frase
   * continua (es. "N" + "A" invece di "NA", o una frase lunga tagliata a metà) SENZA un vero
   * spazio fra i pezzi. Un vero spazio fra parole lascia invece uno scarto ben più ampio (il
   * carattere spazio stesso, anche se già filtrato altrove, misura ~1.7pt o più). Si uniscono i
   * frammenti senza aggiungere spazi; le parole separate da un vero spazio restano elementi
   * distinti (lo spazio verrà reinserito ricomponendo il testo altrove). Non unisce mai un
   * marcatore di riga/banner (vedi eMarcatoreProtetto).
   */
  function raggruppaFrammentiAdiacenti(items) {
    const ordinati = [...items].sort((a, b) => (b.y - a.y) || (a.x - b.x));
    const risultato = [];
    ordinati.forEach((it) => {
      const precedente = risultato[risultato.length - 1];
      const scarto = precedente ? it.x - (precedente.x + precedente.w) : null;
      const puoUnire =
        precedente &&
        Math.abs(precedente.y - it.y) < 0.5 &&
        scarto !== null &&
        Math.abs(scarto) < TOLLERANZA_FRAMMENTO_ADIACENTE_PT &&
        !eMarcatoreProtetto(precedente) &&
        !eMarcatoreProtetto(it);
      if (puoUnire) {
        precedente.testo += it.testo;
        precedente.w = it.x + it.w - precedente.x;
      } else {
        risultato.push({ ...it });
      }
    });
    return risultato;
  }

  /** Trova la riga "Pag." di piè di pagina/intestazione ripetuta: tutto ciò che sta alla sua y o sotto va escluso dal contenuto (la sua y non è fissa fra le pagine). */
  function limiteFooterStorico(items) {
    const pag = items.find((it) => it.testo.trim() === 'Pag.');
    return pag ? pag.y + 5 : -Infinity;
  }

  /**
   * Trova sulla pagina le intestazioni di colonna C/PC/NC/(NA o NP)/NOTE (dopo l'unione dei
   * frammenti adiacenti, "N"+"A" è già diventato "NA"). Ritorna anche `etichettaQuartaColonna`
   * (letteralmente 'NA' o 'NP', quale sia stata trovata) per il confronto col vocabolario interno.
   */
  function trovaIntestazioniColonneStorico(items) {
    const trova = (testo) => items.find((it) => it.testo.trim() === testo);
    const cH = trova('C');
    const pcH = trova('PC');
    const ncH = trova('NC');
    const quartaTrovata = ALIAS_QUARTA_COLONNA_STORICO.map((etichetta) => ({ etichetta, item: trova(etichetta) })).find((x) => x.item);
    const noteH = trova('NOTE');
    if (!cH || !pcH || !ncH || !quartaTrovata || !noteH) {
      return null;
    }
    return {
      C: cH.x,
      PC: pcH.x,
      NC: ncH.x,
      NA: quartaTrovata.item.x,
      etichettaQuartaColonna: quartaTrovata.etichetta,
      // Come nel formato nostro: "NOTE" è centrata nella sua colonna (molto più a destra),
      // mentre il testo delle note è allineato a sinistra subito dopo la colonna NA/NP.
      sogliaNota: quartaTrovata.item.x + 20
    };
  }

  /**
   * Estrae i 4 campi dell'intestazione storica (Negozio/Data del sopralluogo/Area Manager/
   * Tecnico), disposti su 2 righe x 2 coppie etichetta-valore (a differenza della nostra "DATI
   * GENERALI", 1 coppia per riga). Ritorna {} se non tutte e 4 le etichette sono state trovate
   * (evita di restituire un'anagrafica a metà).
   */
  function estraiDatiGeneraliStorico(items) {
    const trovaEtichetta = (testo) => items.find((it) => it.testo.trim() === testo);
    const trovate = ETICHETTE_STORICO
      .map((campo) => ({ campo, item: trovaEtichetta(campo.etichetta) }))
      .filter((x) => x.item);
    if (trovate.length < ETICHETTE_STORICO.length) {
      return {};
    }

    const yRighe = [];
    trovate.forEach(({ item }) => {
      if (!yRighe.some((y) => Math.abs(y - item.y) <= 4)) {
        yRighe.push(item.y);
      }
    });
    yRighe.sort((a, b) => b - a);

    const rigaDi = (y) => yRighe.find((r) => Math.abs(r - y) <= 4);
    const righeMappa = new Map(yRighe.map((y) => [y, []]));
    trovate.forEach((voce) => righeMappa.get(rigaDi(voce.item.y)).push(voce));

    // Per l'ULTIMA riga dell'intestazione non c'è una riga successiva della stessa tabella da
    // usare come limite inferiore: senza un limite, il valore "assorbirebbe" tutto il contenuto
    // sottostante (banner, tabelle sezione...). Il banner della prima macro-sezione (o, in sua
    // assenza, un margine fisso) fa da limite di sicurezza.
    const banner = items.find(
      (it) => BANNER_GRUPPO_1_STORICO.includes(it.testo.trim()) || BANNER_GRUPPO_2_STORICO.includes(it.testo.trim())
    );
    const limiteInferioreAssoluto = banner ? banner.y : Math.min(...yRighe) - 40;

    const risultato = {};
    yRighe.forEach((y, indiceRiga) => {
      const ordinateXRiga = [...righeMappa.get(y)].sort((a, b) => a.item.x - b.item.x);
      const yLimiteInferiore = Math.max(yRighe[indiceRiga + 1] ?? -Infinity, limiteInferioreAssoluto);

      ordinateXRiga.forEach(({ campo, item }, indice) => {
        const xInizio = item.x + item.w + 2;
        const xFine = ordinateXRiga[indice + 1] ? ordinateXRiga[indice + 1].item.x : Infinity;

        const candidati = items.filter(
          (it) => it.x >= xInizio && it.x < xFine && it.y > yLimiteInferiore && it.y <= y + 4
        );
        if (!candidati.length) {
          return;
        }

        const linee = raggruppaInLinee(candidati, 3).map((riga) => ({
          y: riga.y,
          testo: riga.parti.sort((a, b) => a.x - b.x).map((p) => p.testo).join(' ')
        }));

        if (campo.chiave === 'punto_vendita' && linee.length >= 2) {
          risultato.punto_vendita = linee[0].testo.trim();
          risultato.indirizzo_punto_vendita = linee.slice(1).map((l) => l.testo).join(' ').trim();
        } else {
          risultato[campo.chiave] = linee.map((l) => l.testo).join(' ').trim();
        }
      });
    });

    return risultato;
  }

  /** Trova, in ordine dall'alto in basso, gli "eventi" di una pagina: banner di macro-sezione e righe numerate. */
  function trovaEventiPaginaStorico(items) {
    const eventi = [];
    items.forEach((it) => {
      const testo = it.testo.trim();
      if (BANNER_GRUPPO_1_STORICO.includes(testo)) {
        eventi.push({ tipo: 'banner', gruppo: 1, etichetta: testo, y: it.y });
      } else if (BANNER_GRUPPO_2_STORICO.includes(testo)) {
        eventi.push({ tipo: 'banner', gruppo: 2, etichetta: testo, y: it.y });
      } else if (Math.abs(it.x - CENTRO_COLONNA_ID_STORICO) < TOLLERANZA_COLONNA_ID_STORICO_PT) {
        const m = testo.match(REGEX_RIGA_STORICO);
        if (m) {
          eventi.push({ tipo: 'riga', numeroLocale: parseInt(m[1], 10), y: it.y });
        }
      }
    });
    eventi.sort((a, b) => b.y - a.y);
    return eventi;
  }

  /**
   * Elabora gli eventi (banner + righe numerate) di una pagina, nell'ordine in cui compaiono
   * dall'alto in basso: per ogni riga, cerca la "X" di stato, il testo della domanda e la nota
   * nell'intervallo y fra questo evento e il successivo (non un punto fisso: in questo formato
   * "X", testo e note non sono allineati alla stessa y della riga, ma cadono comunque nel suo
   * intervallo verticale). Gestisce anche il caso in cui una nota prosegua oltre l'interruzione
   * di pagina: il testo "orfano" trovato prima del primo evento di una pagina viene aggiunto alla
   * nota dell'ultima riga elaborata nella pagina precedente. Ritorna { righe, contesto } — righe
   * grezze prodotte su questa pagina + il contesto aggiornato da passare alla pagina successiva.
   */
  function elaboraEventiPaginaStorico(items, colonne, contesto) {
    const eventi = trovaEventiPaginaStorico(items);
    const righeProdotte = [];
    if (contesto.ultimaRiga) {
      const primoEvento = eventi[0] || { y: -Infinity };
      const orfani = items.filter(
        (it) => it.y > primoEvento.y && it.x > colonne.sogliaNota && !INTESTAZIONI_STORICO.includes(it.testo.trim())
      );
      if (orfani.length) {
        const testoOrfano = ricomponiTesto(raggruppaInLinee(orfani, TOLLERANZA_RIGA_PT));
        if (testoOrfano) {
          contesto.ultimaRiga.nota_originale = contesto.ultimaRiga.nota_originale
            ? `${contesto.ultimaRiga.nota_originale} ${testoOrfano}`
            : testoOrfano;
        }
      }
    }

    let sezioneAttiva = contesto.sezioneAttiva;
    let ultimaRiga = contesto.ultimaRiga;

    eventi.forEach((evento, indice) => {
      if (evento.tipo === 'banner') {
        sezioneAttiva = evento.etichetta;
        ultimaRiga = null; // un cambio di macro-sezione non porta con sé una nota in sospeso
        return;
      }

      const yFine = eventi[indice + 1] ? eventi[indice + 1].y : -Infinity;
      const nellaRiga = (it) => it.y > yFine + 2 && it.y <= evento.y + 2;

      const marcature = items.filter((it) => eMarcaturaStato(it) && nellaRiga(it));
      const stato = marcature.length === 1 ? colonnaStatoPiuVicina(marcature[0].x, colonne) : null;

      const candidatiTesto = items.filter(
        (it) => it.x > CENTRO_COLONNA_ID_STORICO + MARGINE_TESTO_DOMANDA_STORICO_PT && it.x < colonne.C - TOLLERANZA_COLONNA_ID_STORICO_PT && nellaRiga(it)
      );
      const testoDomanda = ricomponiTesto(raggruppaInLinee(candidatiTesto, TOLLERANZA_RIGA_PT));

      const candidatiNota = items.filter(
        (it) => it.x > colonne.sogliaNota && nellaRiga(it) && !INTESTAZIONI_STORICO.includes(it.testo.trim())
      );
      const testoNota = ricomponiTesto(raggruppaInLinee(candidatiNota, TOLLERANZA_RIGA_PT)) || null;

      const riga = {
        formato: 'storico',
        id_originale: null,
        numero_originale: evento.numeroLocale,
        sezione_originale: sezioneAttiva,
        testo_originale: testoDomanda,
        stato_originale: stato,
        nota_originale: testoNota
      };
      righeProdotte.push(riga);
      ultimaRiga = riga;
    });

    return { righe: righeProdotte, contesto: { sezioneAttiva, ultimaRiga } };
  }

  /**
   * Prova il formato "storico" sull'intero documento (pagine già estratte). Ritorna
   * { righe, anagrafica, strutturaRiconosciuta, conversioneStatoRilevata }.
   */
  function provaFormatoStorico(pagine) {
    const righe = [];
    let anagrafica = {};
    let strutturaRiconosciuta = false;
    let conversioneStatoRilevata = null;
    let contesto = { sezioneAttiva: null, ultimaRiga: null };
    let colonnePrecedenti = null;
    const celleContesto = { titolo: null, ultimaRiga: null };

    pagine.forEach((itemsGrezzi, indice) => {
      const numeroPagina = indice + 1;
      const limiteFooter = limiteFooterStorico(itemsGrezzi);
      const itemsFiltrati = itemsGrezzi.filter((it) => it.y > limiteFooter);
      const items = raggruppaFrammentiAdiacenti(itemsFiltrati);

      const colonne = trovaIntestazioniColonneStorico(items) || colonnePrecedenti;
      colonnePrecedenti = colonne;
      if (colonne) {
        strutturaRiconosciuta = true;
        if (colonne.etichettaQuartaColonna !== 'NA' && !conversioneStatoRilevata) {
          conversioneStatoRilevata = { letta: colonne.etichettaQuartaColonna, applicata: 'NA' };
        }
      }

      if (numeroPagina === 1) {
        anagrafica = estraiDatiGeneraliStorico(items);
      }

      if (colonne) {
        const daCelle = righeDaCelle(items, colonne, itemsGrezzi.bordi, celleContesto, 'storico');
        if (daCelle !== null) { righe.push(...daCelle); return; }
        const esito = elaboraEventiPaginaStorico(items, colonne, contesto);
        righe.push(...esito.righe);
        contesto = esito.contesto;
      }
    });

    return { righe, anagrafica, strutturaRiconosciuta, conversioneStatoRilevata };
  }

  // ======================================================================================
  // Punto di ingresso comune
  // ======================================================================================

  async function regioniImmagine(pagina) {
    const ops = await pagina.getOperatorList();
    const OPS = pdfjsLib.OPS;
    const stack = [];
    let matrix = [1, 0, 0, 1, 0, 0];
    const regioni = [];
    for (let i = 0; i < ops.fnArray.length; i++) {
      const fn = ops.fnArray[i], args = ops.argsArray[i];
      if (fn === OPS.save) stack.push(matrix.slice());
      else if (fn === OPS.restore) matrix = stack.pop() || [1, 0, 0, 1, 0, 0];
      else if (fn === OPS.transform) matrix = pdfjsLib.Util.transform(matrix, args);
      else if (fn === OPS.paintFormXObjectBegin) {
        stack.push(matrix.slice());
        if (args[0]) matrix = pdfjsLib.Util.transform(matrix, args[0]);
      } else if (fn === OPS.paintFormXObjectEnd) matrix = stack.pop() || [1, 0, 0, 1, 0, 0];
      else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject) {
        const corners = [[0, 0], [1, 0], [0, 1], [1, 1]].map(p => pdfjsLib.Util.applyTransform(p, matrix));
        const x = Math.min(...corners.map(p => p[0])), y = Math.min(...corners.map(p => p[1]));
        const right = Math.max(...corners.map(p => p[0])), top = Math.max(...corners.map(p => p[1]));
        if (right - x < 1 || top - y < 1) continue;
        regioni.push({ x, y, right, top, indice: i, matrix: matrix.slice(), ref: args[0], inline: fn === OPS.paintInlineImageXObject });
      }
    }
    return regioni;
  }

  async function leggiImmagine(pagina, region) {
    if (region.inline) return region.ref;
    const store = String(region.ref).startsWith('g_') ? pagina.commonObjs : pagina.objs;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Immagine non disponibile')), 2000);
      store.get(region.ref, value => { clearTimeout(timer); resolve(value); });
    });
  }

  // Hash all decoded pixels, not the PDF.js page-local name (img_p0_1 etc.).
  // Those names can differ for identical XObjects, or collide across pages.
  async function improntaImmagine(pagina, region) {
    const img = await leggiImmagine(pagina, region);
    if (!img || !img.width || !img.height || img.width * img.height > 24000000) return null;
    let data = img.data;
    let canvas;
    try {
      if (img.bitmap) {
        canvas = document.createElement('canvas');
        canvas.width = img.width; canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img.bitmap, 0, 0);
        data = ctx.getImageData(0, 0, img.width, img.height).data;
      }
      if (!data) return null;
      let a = 2166136261, b = 5381;
      for (let i = 0; i < data.length; i++) {
        a = Math.imul(a ^ data[i], 16777619);
        b = Math.imul(b, 33) ^ data[i];
      }
      return `${img.width}:${img.height}:${data.length}:${a >>> 0}:${b >>> 0}`;
    } finally { if (canvas) canvas.width = canvas.height = 0; }
  }

  function classificaHeader(candidati) {
    const esclusi = new Map();
    const escludi = r => {
      if (!esclusi.has(r.pagina)) esclusi.set(r.pagina, new Set());
      esclusi.get(r.pagina).add(r.indice);
    };
    for (const r of candidati) {
      // Repetition needs both image identity and stable geometry on another page.
      // A reused photo in the body, a unique image or a moved image is retained.
      if (r.impronta && candidati.some(s => s.pagina !== r.pagina && s.impronta === r.impronta &&
          ['x', 'distanzaTop'].every(k => Math.abs(r[k] - s[k]) <= 16) &&
          ['larghezza', 'altezza'].every(k => Math.abs(r[k] - s[k]) <= 3))) escludi(r);
      // Some formats have a letterhead only on page 1. Recognize the paired
      // graphics above the explicit general-data block, never just an aspect ratio.
      if (r.pagina === 1 && r.sopraDati && !r.didascaliaFoto && candidati.some(s =>
          s.pagina === 1 && s !== r && s.sopraDati && !s.didascaliaFoto &&
          ((r.right < r.larghezzaPagina * 0.4 && s.x > r.larghezzaPagina * 0.6) ||
           (s.right < r.larghezzaPagina * 0.4 && r.x > r.larghezzaPagina * 0.6)) &&
          Math.abs((r.y + r.top) / 2 - (s.y + s.top) / 2) <= 24)) escludi(r);
      // Alcuni report Interparking incorporano Colligo + cliente in un'unica immagine
      // orizzontale sopra DATI GENERALI: è intestazione, non una foto del sopralluogo.
      if (r.pagina === 1 && r.sopraDati && !r.didascaliaFoto &&
          r.larghezza >= r.larghezzaPagina * 0.45 && r.altezza <= 90) escludi(r);
    }
    return esclusi;
  }

  async function analizzaHeader(documento) {
    const candidati = [];
    for (let n = 1; n <= documento.numPages; n++) {
      const pagina = await documento.getPage(n);
      try {
        const regioni = await regioniImmagine(pagina);
        const items = n === 1 ? (await pagina.getTextContent()).items : [];
        const titolo = items.find(it => /^DATI\s+GENERALI$/i.test(it.str.trim()));
        const limiteDati = titolo ? titolo.transform[5] + Math.abs(titolo.transform[3]) : null;
        for (const r of regioni) {
          // This is only a candidate zone, not an exclusion criterion.
          if (pagina.view[3] - r.y > Math.min(180, (pagina.view[3] - pagina.view[1]) * 0.23)) continue;
          let impronta = null;
          try { impronta = await improntaImmagine(pagina, r); } catch (_) { /* No identity: retain unique images. */ }
          candidati.push({ ...r, pagina: n, impronta, distanzaTop: pagina.view[3] - r.top,
            larghezza: r.right - r.x, altezza: r.top - r.y, larghezzaPagina: pagina.view[2],
            sopraDati: limiteDati !== null && r.y > limiteDati,
            didascaliaFoto: items.some(it => /^Foto\s+\d/i.test(it.str.trim()) &&
              it.transform[5] < r.y && it.transform[5] > r.y - 40 &&
              it.transform[4] >= r.x - 10 && it.transform[4] <= r.right)
          });
        }
      } finally { pagina.cleanup(); }
    }
    return classificaHeader(candidati);
  }

  /** Estrae solo le regioni fotografiche e le didascalie della pagina, senza persistenza. */
  async function estraiImmaginiPagina(pagina, items, numeroPagina, opzioni = {}) {
    const esclusi = opzioni.headerEsclusi && opzioni.headerEsclusi.get(numeroPagina);
    const regioni = (await regioniImmagine(pagina)).filter(r =>
      r.right - r.x >= 20 && r.top - r.y >= 20 && (!esclusi || !esclusi.has(r.indice)));
    const immagini = [];
    for (const region of regioni) {
      // Limit caption search to this column and stop at the next image below it.
      const below = regioni.filter(r => r !== region && r.top <= region.y && r.right > region.x && r.x < region.right);
      const minY = Math.max(region.y - 120, ...below.map(r => r.top));
      const center = (region.x + region.right) / 2;
      const neighbors = regioni.filter(r => r !== region && r.y < region.top && r.top > region.y);
      const leftCenters = neighbors.map(r => (r.x + r.right) / 2).filter(x => x < center);
      const rightCenters = neighbors.map(r => (r.x + r.right) / 2).filter(x => x > center);
      const left = leftCenters.length ? (Math.max(...leftCenters) + center) / 2 : region.x - 35;
      const right = rightCenters.length ? (Math.min(...rightCenters) + center) / 2 : region.right + 35;
      // Assign each text fragment to one column using its center, never overlap.
      const nearby = items.filter(it => it.y < region.y + 2 && it.y > minY && it.x + it.w / 2 >= left && it.x + it.w / 2 < right && !/^(Pag\.|C = Conforme)/i.test(it.testo));
      nearby.sort((a, b) => Math.abs(a.y - b.y) > 3 ? b.y - a.y : a.x - b.x);
      const didascalia = nearby.map(it => it.testo).join(' ').trim();
      const canvas = document.createElement('canvas');
      let metodo = 'originale';
      try {
        if (opzioni.forzaCrop || region.matrix[1] || region.matrix[2] || region.matrix[0] < 0 || region.matrix[3] < 0) throw new Error('Trasformazione: usa crop');
        const img = await leggiImmagine(pagina, region);
        if (!img || !img.width || !img.height || img.width * img.height > 24000000) throw new Error('Immagine troppo grande');
        canvas.width = img.width; canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (img.bitmap) ctx.drawImage(img.bitmap, 0, 0);
        else {
          const pixels = ctx.createImageData(img.width, img.height);
          const source = img.data;
          if (!source) throw new Error('Pixel non disponibili');
          if (img.kind === pdfjsLib.ImageKind.RGBA_32BPP) pixels.data.set(source);
          else if (img.kind === pdfjsLib.ImageKind.RGB_24BPP) {
            for (let p = 0, q = 0; p < source.length; p += 3, q += 4) {
              pixels.data[q] = source[p]; pixels.data[q + 1] = source[p + 1]; pixels.data[q + 2] = source[p + 2]; pixels.data[q + 3] = 255;
            }
          } else if (img.kind === pdfjsLib.ImageKind.GRAYSCALE_1BPP) {
            const stride = Math.ceil(img.width / 8);
            for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
              const p = (y * img.width + x) * 4;
              const v = source[y * stride + (x >> 3)] & (128 >> (x & 7)) ? 255 : 0;
              pixels.data[p] = pixels.data[p + 1] = pixels.data[p + 2] = v; pixels.data[p + 3] = 255;
            }
          } else throw new Error('Formato pixel non supportato');
          ctx.putImageData(pixels, 0, 0);
        }
      } catch (_) {
        metodo = 'crop';
        const scale = Math.min(2, 1600 / Math.max(region.right - region.x, region.top - region.y));
        const viewport = pagina.getViewport({ scale });
        const rect = viewport.convertToViewportRectangle([region.x, region.y, region.right, region.top]);
        const x = Math.min(rect[0], rect[2]), y = Math.min(rect[1], rect[3]);
        canvas.width = Math.max(1, Math.ceil(Math.abs(rect[2] - rect[0])));
        canvas.height = Math.max(1, Math.ceil(Math.abs(rect[3] - rect[1])));
        await pagina.render({ canvasContext: canvas.getContext('2d'), viewport, transform: [1, 0, 0, 1, -x, -y] }).promise;
      }
      const anteprima = canvas.toDataURL('image/png');
      const bytes = Uint8Array.from(atob(anteprima.split(',')[1]), c => c.charCodeAt(0));
      immagini.push({ pagina: numeroPagina, didascalia, anteprima, blob: new Blob([bytes], { type: 'image/png' }), metodo, larghezza: canvas.width, altezza: canvas.height });
      canvas.width = canvas.height = 0;
    }
    return immagini;
  }

  /**
   * I PDF generati dall'app possono spezzare una riga di AutoTable fra due pagine. Alcune versioni
   * legacy ripetevano il numero della domanda sulla pagina successiva: l'estrazione vede quindi
   * due righe con lo stesso numero/id, anche se nel PDF logico è UNA sola domanda. Prima del
   * matching consolidiamo questi frammenti. Nel formato "nostro" il numero/id è globale e univoco,
   * quindi una ripetizione è sempre una continuazione/duplicazione della stessa riga.
   */
  function consolidaRigheNostre(righe) {
    const risultato = [];
    const unisciTesto = (a, b) => {
      const primo = String(a || '').replace(/\s+/g, ' ').trim();
      const secondo = String(b || '').replace(/\s+/g, ' ').trim();
      if (!primo) return secondo || null;
      if (!secondo) return primo || null;
      const normalizza = (v) => v.toLowerCase().replace(/[^a-z0-9à-ÿ]+/gi, ' ').replace(/\s+/g, ' ').trim();
      const na = normalizza(primo), nb = normalizza(secondo);
      if (na.includes(nb)) return primo;
      if (nb.includes(na)) return secondo;
      return (primo + ' ' + secondo).replace(/\s+/g, ' ').trim();
    };

    (righe || []).forEach((riga) => {
      if (!riga || riga.formato !== 'nostro') { risultato.push(riga); return; }
      const raw = riga.id_originale ?? riga.numero_originale;
      const numero = Number(raw);
      if (!Number.isInteger(numero)) { risultato.push(riga); return; }

      // Una vera continuazione AutoTable è adiacente alla propria prima metà. Non consolidare
      // tutte le occorrenze dello stesso numero sparse nel documento.
      const precedente = risultato[risultato.length - 1];
      const numeroPrecedente = precedente && Number(precedente.id_originale ?? precedente.numero_originale);
      const stessaRiga = precedente && precedente.formato === 'nostro' && numeroPrecedente === numero &&
        precedente.sezione_originale === riga.sezione_originale;
      if (!stessaRiga) {
        risultato.push({ ...riga });
        return;
      }

      precedente.testo_originale = unisciTesto(precedente.testo_originale, riga.testo_originale);
      precedente.nota_originale = unisciTesto(precedente.nota_originale, riga.nota_originale);
      const stati = [precedente.stato_originale, riga.stato_originale].filter(Boolean);
      const unici = Array.from(new Set(stati));
      if (unici.length === 1) precedente.stato_originale = unici[0];
      else if (unici.length > 1) {
        precedente.stato_originale = null;
        precedente.da_verificare = true;
        precedente.avviso = 'La stessa riga del PDF è stata spezzata fra pagine con marcature discordanti: verifica lo stato.';
      }
      precedente.duplicati_consolidati = (precedente.duplicati_consolidati || 0) + 1;
    });
    return risultato;
  }

  /**
   * Estrae le righe grezze da un PDF, provando prima il formato "nostro" e poi (se la struttura
   * non viene riconosciuta) quello "storico". NON prende in input nessuna checklist: l'abbinamento
   * a domande specifiche è compito di js/import-matching.js, a valle del rilevamento cliente.
   * Ritorna { formatoRilevato, righe, anagrafica, conversioneStatoRilevata, immagini }. Lancia un errore
   * solo se NESSUNA struttura nota (né nostro né storico) viene trovata in nessuna pagina: in
   * quel caso non è affatto un PDF di sopralluogo riconoscibile, non ha senso proseguire.
   */
  async function estraiRighe(file, opzioni = {}) {
    if (typeof pdfjsLib === 'undefined' || typeof pdfjsLib.getDocument !== 'function') {
      throw new Error('Libreria di lettura PDF non disponibile.');
    }

    const buffer = await pdf.leggiArrayBuffer(file);
    const documento = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;
    try {
      const headerEsclusi = await analizzaHeader(documento);
      const pagine = [];
      const immagini = [];
      for (let numeroPagina = 1; numeroPagina <= documento.numPages; numeroPagina += 1) {
        const pagina = await documento.getPage(numeroPagina);
        const contenuto = await pagina.getTextContent();
        let items = contenuto.items
          .map((it, ordine) => ({ testo: it.str, x: it.transform[4], y: it.transform[5], w: it.width, ordine }))
          .filter((it) => it.testo.trim() !== '');
        let bordi = null;

        // I PDF compositi creati da vecchie versioni possono contenere pagine intere dentro
        // Form XObject ritagliati: getTextContent ne restituisce anche il testo FUORI dal ritaglio
        // e quello successivamente coperto. In quelle sole pagine usiamo il testo effettivamente
        // renderizzato e i bordi visibili, mantenendo il percorso veloce tradizionale altrove.
        if (await paginaHaFormClippatoGrande(pagina)) {
          try {
            const visibile = await estraiTestoVisibileRenderizzato(pagina);
            if (visibile && visibile.items && visibile.items.length >= 5) {
              items = visibile.items;
              bordi = visibile.bordi;
            }
          } catch (erroreVisivo) {
            console.warn('Import PDF: fallback al testo grezzo per la pagina', numeroPagina, erroreVisivo);
          }
        }

        items.bordi = bordi && bordi.length ? bordi : await estraiBordiTabella(pagina);
        pagine.push(items);
        immagini.push(...await estraiImmaginiPagina(pagina, items, numeroPagina, { ...opzioni, headerEsclusi }));
        pagina.cleanup();
      }

      const risultatoNostro = provaFormatoNostro(pagine);
      if (risultatoNostro.strutturaRiconosciuta && risultatoNostro.righe.length) {
        return {
          formatoRilevato: 'nostro',
          immagini,
          righe: consolidaRigheNostre(risultatoNostro.righe),
          anagrafica: risultatoNostro.anagrafica,
          conversioneStatoRilevata: null
        };
      }

      const risultatoStorico = provaFormatoStorico(pagine);
      if (risultatoStorico.strutturaRiconosciuta && risultatoStorico.righe.length) {
        return {
          formatoRilevato: 'storico',
          immagini,
          righe: risultatoStorico.righe,
          anagrafica: risultatoStorico.anagrafica,
          conversioneStatoRilevata: risultatoStorico.conversioneStatoRilevata
        };
      }

      throw new Error(
        'Formato PDF non riconosciuto: non sembra né il formato generato da questa app né il formato ' +
        'storico Coin supportato (nessuna tabella con colonne C/P.C/N.C/N.P riconosciuta in nessuna pagina). ' +
        'Verifica di aver selezionato il file giusto.'
      );
    } finally { await documento.destroy(); }
  }

  return {
    estraiRighe,
    estraiImmaginiPagina,
    _test: {
      classificaHeader,
      analizzaHeader,
      provaFormatoNostro,
      provaFormatoStorico,
      consolidaRigheNostre,
      raggruppaFrammentiAdiacenti,
      estraiDatiGeneraliNostro,
      consolidaBordiOrizzontali,
      consolidaTestoRenderizzato,
      estraiTestoVisibileRenderizzato,
      paginaHaFormClippatoGrande
    }
  };
})();
