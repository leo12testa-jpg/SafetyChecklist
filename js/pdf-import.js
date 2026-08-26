/**
 * Importazione di un sopralluogo a partire da un PDF già esistente. Supporta due formati,
 * provati in quest'ordine:
 *
 * 1. "nostro" — il PDF generato da questa stessa app (js/pdf.js): tabella "DATI GENERALI" +
 *    tabelle sezione con colonne n./Descrizione attività/C/P.C/N.C/N.P/Note (vedi
 *    disegnaTabellaDatiGenerali e disegnaTabellaSezione).
 * 2. "storico" — un vecchio formato Coin (non generato da questa app): intestazione a tabella
 *    Negozio/Data del sopralluogo/Area Manager/Tecnico (2 righe x 2 coppie etichetta-valore),
 *    macro-sezioni "AUDIT DOCUMENTALE"/"SOPRALLUOGO AMBIENTI DI LAVORO" con numerazione delle
 *    domande "N)" che RIPARTE DA 1 a ogni macro-sezione, colonne C/PC/NC/NA/NOTE.
 *
 * In entrambi i casi usa pdf.js (Mozilla, vendorizzato in js/vendor/pdf.min.js) per estrarre il
 * testo di ogni pagina CON le coordinate x/y di ogni elemento (getTextContent), non il testo
 * grezzo: è dalla posizione che si ricostruisce a quale domanda/colonna appartiene ogni "X" o
 * nota, dato che il testo grezzo da solo non lo dice.
 *
 * Limiti noti (documentati anche per l'utente nell'interfaccia):
 * - Solo checklist con lo stesso layout "a stato" C/PC/NC/NA (non le checklist "stile":
 *   "raccolta-dati", che hanno un report diverso senza queste colonne, in nessuno dei due formati).
 * - Le foto non vengono mai importate (impossibile recuperarle in modo affidabile da un PDF
 *   già appiattito): il chiamante deve avvisare l'utente.
 * - Una riga è riconosciuta solo se ha ESATTAMENTE un segno "X" in una delle 4 colonne di
 *   stato: 0 o più di 1 marcatura trovata per la stessa riga => quella domanda resta senza
 *   risposta invece di essere indovinata.
 * - Formato storico: la mappatura numero-di-riga -> domanda della checklist presuppone che le
 *   sezioni della checklist selezionata corrispondano (per nome, non case-sensitive) alle due
 *   macro-sezioni note (vedi SEZIONI_GRUPPO_1/2); se non corrispondono affatto, la numerazione
 *   viene interpretata come un'unica sequenza continua (fallback), meno affidabile.
 * - Formato storico: le note molto lunghe possono avere la prima riga posizionata in modo
 *   irregolare rispetto alle righe successive (bullet list con indentazioni diverse): il testo
 *   viene comunque raccolto per intero, ma l'ordine esatto delle parole sulla stessa riga può
 *   in rari casi risultare leggermente diverso dall'originale.
 * - In generale, se il numero di domande riconosciute con certezza risulta troppo basso rispetto
 *   al totale (meno del 50%) per ENTRAMBI i formati, l'importazione viene rifiutata con un
 *   messaggio chiaro invece di restituire dati parziali senza dirlo.
 */
const pdfImport = (() => {
  if (typeof pdfjsLib !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'js/vendor/pdf.worker.min.js';
  }

  const SOGLIA_RICONOSCIMENTO = 0.5;

  /** Stessa logica di appiattimento di checklist.js (non esportata da lì): [{ sezione, domanda }] nell'ordine del JSON. */
  function appiattisciDomande(checklist) {
    const risultato = [];
    (checklist.sezioni || []).forEach((sezione) => {
      (sezione.domande || []).forEach((domanda) => {
        risultato.push({ sezione: sezione.titolo, domanda });
      });
    });
    return risultato;
  }

  // ======================================================================================
  // FORMATO "NOSTRO" (generato da js/pdf.js)
  // ======================================================================================

  const TOLLERANZA_RIGA_PT = 3;
  const TOLLERANZA_COLONNA_ID_PT = 10;
  const TOLLERANZA_RIGA_NOTA_PT = 40;
  const TOLLERANZA_RIGA_MULTILINEA_PT = 12;

  const ETICHETTE_DATI_GENERALI = [
    'punto_vendita',
    'numero_dipendenti',
    'tecnico',
    'data_sopralluogo',
    'responsabile_punto_vendita',
    'presenza_responsabile',
    'presenza_rls'
  ];

  /**
   * Trova sulla pagina le intestazioni di colonna della tabella sezione ('n.', 'C', 'P.C',
   * 'N.C', 'N.P', 'Note') e ne ricava la coordinata x di riferimento. Le intestazioni si
   * ripetono a ogni tabella/sezione e a ogni pagina, sempre alla stessa x (layout fisso):
   * basta trovarne una sola occorrenza per ricavare le colonne dell'intera pagina.
   */
  function trovaIntestazioniColonneNostro(items) {
    const trova = (testo) => items.find((it) => it.testo.trim() === testo);
    const idH = trova('n.');
    const cH = trova('C');
    const pcH = trova('P.C');
    const ncH = trova('N.C');
    const npH = trova('N.P');
    const noteH = trova('Note');

    if (!idH || !cH || !pcH || !ncH || !npH || !noteH) {
      return null;
    }

    return {
      idX: idH.x,
      C: cH.x,
      PC: pcH.x,
      NC: ncH.x,
      NA: npH.x,
      noteX: noteH.x,
      // La soglia NON è il punto medio fra le due intestazioni: "Note" è centrata nella sua
      // colonna (larga, quindi centrata molto più a destra), mentre il testo delle note nel
      // corpo della tabella è allineato a sinistra, subito dopo la colonna N.P. Un margine fisso
      // dopo la x della colonna N.P individua correttamente l'inizio della colonna Note.
      sogliaNota: npH.x + 20
    };
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

  /** Raggruppa una lista di elementi testo in righe (per y, tolleranza) ordinate dall'alto in basso: [{ y, parti }]. */
  function raggruppaInLinee(items, tolleranza) {
    const ordinati = [...items].sort((a, b) => b.y - a.y);
    const linee = [];
    ordinati.forEach((parte) => {
      const ultima = linee[linee.length - 1];
      if (ultima && Math.abs(ultima.y - parte.y) <= tolleranza) {
        ultima.parti.push(parte);
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
   * Assegna dei candidati di testo (già filtrati a una colonna) alla riga più vicina in y, entro
   * una tolleranza: stessa tecnica usata sia per le note (colonna a destra) sia, qui sotto, per il
   * testo della domanda (colonna centrale) — il testo di una riga può sforare in y rispetto
   * all'ancora numerica quando va su più righe, quindi non basta un confronto diretto sulla y del
   * numero. Ritorna Map<id, testo ricomposto>.
   */
  function assegnaTestoAllaRigaPiuVicina(candidati, righe, tolleranza) {
    const parolePerRiga = new Map();
    candidati.forEach((candidato) => {
      let rigaVicina = null;
      let distanzaMinima = Infinity;
      righe.forEach((riga) => {
        const distanza = Math.abs(candidato.y - riga.y);
        if (distanza < distanzaMinima) {
          distanzaMinima = distanza;
          rigaVicina = riga;
        }
      });
      if (!rigaVicina || distanzaMinima > tolleranza) {
        return;
      }
      if (!parolePerRiga.has(rigaVicina.id)) {
        parolePerRiga.set(rigaVicina.id, []);
      }
      parolePerRiga.get(rigaVicina.id).push(candidato);
    });

    const testoPerId = new Map();
    parolePerRiga.forEach((parti, id) => {
      const testo = ricomponiTesto(raggruppaInLinee(parti, TOLLERANZA_RIGA_PT));
      if (testo) {
        testoPerId.set(id, testo);
      }
    });
    return testoPerId;
  }

  /**
   * Estrae risposte/note dalle righe della tabella sezione presenti in questa pagina. Aggiorna
   * `risultatiPerId` e, per ogni riga trovata, registra anche il testo della colonna "Descrizione
   * attività" in `testoDomandaPerId` (chiave: id di riga) — non per compilare nulla, ma perché è
   * il modo per accertarsi che il PDF appartenga davvero alla checklist selezionata (vedi
   * verificaCorrispondenzaChecklist: da quando non c'è più un titolo unico in cima al documento,
   * ogni tabella/sezione porta solo la propria intestazione, quindi il confronto va fatto domanda
   * per domanda, non su un singolo "titolo").
   */
  function estraiRisposteDiPaginaNostro(items, colonne, idValidi, risultatiPerId, testoDomandaPerId) {
    const righe = items
      .filter((it) => /^\d+$/.test(it.testo.trim()) && Math.abs(it.x - colonne.idX) < TOLLERANZA_COLONNA_ID_PT)
      .map((it) => ({ id: parseInt(it.testo.trim(), 10), y: it.y }))
      .filter((riga) => idValidi.has(riga.id));

    if (!righe.length) {
      return;
    }

    righe.forEach((riga) => {
      if (!risultatiPerId.has(riga.id)) {
        risultatiPerId.set(riga.id, { risposta: null, note: null });
      }
      const voce = risultatiPerId.get(riga.id);

      const marcature = items.filter(
        (it) => it.testo.trim() === 'X' && Math.abs(it.y - riga.y) <= TOLLERANZA_RIGA_PT
      );
      if (marcature.length === 1) {
        voce.risposta = colonnaStatoPiuVicina(marcature[0].x, colonne);
      }
      // 0 marcature o più di una: risposta lasciata null, non si indovina (vedi limiti noti).
    });

    const candidatiNota = items.filter((it) => it.x > colonne.sogliaNota && it.testo.trim() !== 'Note');
    assegnaTestoAllaRigaPiuVicina(candidatiNota, righe, TOLLERANZA_RIGA_NOTA_PT).forEach((testo, id) => {
      const voce = risultatiPerId.get(id);
      if (voce) {
        voce.note = testo;
      }
    });

    // Colonna "Descrizione attività": subito dopo l'id (con margine, per non riassorbire la
    // cifra stessa) e prima della colonna "C" (con margine, per restare fuori dalle "X" di stato).
    const candidatiDomanda = items.filter(
      (it) =>
        it.x > colonne.idX + TOLLERANZA_COLONNA_ID_PT &&
        it.x < colonne.C - TOLLERANZA_COLONNA_ID_PT &&
        it.testo.trim() !== 'Descrizione attività'
    );
    assegnaTestoAllaRigaPiuVicina(candidatiDomanda, righe, TOLLERANZA_RIGA_NOTA_PT).forEach((testo, id) => {
      if (!testoDomandaPerId.has(id)) {
        testoDomandaPerId.set(id, testo);
      }
    });
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
      TOLLERANZA_RIGA_MULTILINEA_PT
    );

    const risultato = {};
    ETICHETTE_DATI_GENERALI.forEach((chiave, indice) => {
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

  /** Confronto testi tollerante a differenze di spaziatura/a-capo (l'a-capo nel PDF dipende dal wrap di autoTable, diverso da quello nel JSON della checklist). */
  function normalizzaTestoConfronto(testo) {
    return String(testo || '')
      .toLowerCase()
      .replace(/\s+/g, '')
      .trim();
  }

  /**
   * Da quando il documento non ha più un titolo unico in cima (ogni sezione porta solo la propria
   * intestazione di tabella), l'unico modo affidabile per accertarsi che il PDF appartenga alla
   * checklist selezionata è confrontare, domanda per domanda, il testo estratto dalla colonna
   * "Descrizione attività" con quello della checklist (stesso id di riga). I numeri di riga da
   * soli non bastano: coincidono comunque fra checklist diverse (sono una sequenza 1..N), quindi
   * con la checklist sbagliata selezionata le risposte finirebbero comunque su "qualche" domanda,
   * solo sbagliata. Ritorna null se il campione è troppo piccolo per pronunciarsi.
   */
  function verificaCorrispondenzaChecklist(testoDomandaPerId, domande) {
    let confrontate = 0;
    let corrispondenti = 0;
    domande.forEach(({ domanda }) => {
      const estratto = testoDomandaPerId.get(domanda.id);
      if (!estratto) {
        return;
      }
      confrontate += 1;
      if (normalizzaTestoConfronto(estratto) === normalizzaTestoConfronto(domanda.testo)) {
        corrispondenti += 1;
      }
    });
    if (confrontate === 0) {
      return null;
    }
    return { confrontate, corrispondenti };
  }

  /**
   * Prova il formato "nostro" sull'intero documento (pagine già estratte). Ritorna
   * { risposte, anagrafica, totaleDomande, domandeRiconosciute, strutturaRiconosciuta }.
   * Lancia un errore SOLO se le intestazioni di colonna nostre sono state trovate (quindi il
   * PDF sembra davvero generato da questa app) ma il testo delle domande non corrisponde alla
   * checklist scelta (vedi verificaCorrispondenzaChecklist).
   */
  function provaFormatoNostro(pagine, checklist, domande, idValidi) {
    const risultatiPerId = new Map();
    const testoDomandaPerId = new Map();
    let anagrafica = {};
    let colonneCorrenti = null;
    let strutturaRiconosciuta = false;

    pagine.forEach((itemsGrezzi, indice) => {
      const numeroPagina = indice + 1;
      const items = itemsGrezzi.filter((it) => !REGEX_LEGENDA_PIE_PAGINA.test(it.testo.trim()));
      const intestazioni = trovaIntestazioniColonneNostro(items);
      if (intestazioni) {
        colonneCorrenti = intestazioni;
        strutturaRiconosciuta = true;
      }

      if (numeroPagina === 1) {
        anagrafica = estraiDatiGeneraliNostro(items);
      }

      if (colonneCorrenti) {
        estraiRisposteDiPaginaNostro(items, colonneCorrenti, idValidi, risultatiPerId, testoDomandaPerId);
      }
    });

    const corrispondenza = verificaCorrispondenzaChecklist(testoDomandaPerId, domande);
    if (strutturaRiconosciuta && corrispondenza && corrispondenza.corrispondenti / corrispondenza.confrontate < SOGLIA_RICONOSCIMENTO) {
      throw new Error(
        `Il contenuto di questo PDF non corrisponde alla checklist "${checklist.titolo}" selezionata ` +
        `(solo ${corrispondenza.corrispondenti} domande su ${corrispondenza.confrontate} confrontate combaciano). ` +
        'Seleziona la checklist corretta e riprova: con quella sbagliata i numeri di riga combaciano comunque, ma le risposte finirebbero sulle domande sbagliate.'
      );
    }

    const risposte = [];
    domande.forEach(({ sezione, domanda }) => {
      const trovata = risultatiPerId.get(domanda.id);
      if (trovata && trovata.risposta) {
        risposte.push({
          domanda_id: domanda.id,
          sezione,
          risposta: trovata.risposta,
          note: trovata.note || null,
          foto: []
        });
      }
    });

    return {
      risposte,
      anagrafica,
      totaleDomande: domande.length,
      domandeRiconosciute: risposte.length,
      strutturaRiconosciuta
    };
  }

  // ======================================================================================
  // FORMATO "STORICO" (vecchio formato Coin, non generato da questa app)
  // ======================================================================================

  const TOLLERANZA_FRAMMENTO_ADIACENTE_PT = 1.2;
  const CENTRO_COLONNA_ID_STORICO = 32;
  const TOLLERANZA_COLONNA_ID_STORICO_PT = 20;
  const REGEX_RIGA_STORICO = /^(\d+)[.)]?$/;
  const INTESTAZIONI_STORICO = ['C', 'PC', 'NC', 'NA', 'NOTE'];

  const ETICHETTE_STORICO = [
    { chiave: 'punto_vendita', etichetta: 'Negozio' },
    { chiave: 'data_sopralluogo', etichetta: 'Data del sopralluogo' },
    { chiave: 'area_manager', etichetta: 'Area Manager' },
    { chiave: 'tecnico', etichetta: 'Tecnico' }
  ];

  const BANNER_GRUPPO_1_STORICO = ['AUDIT DOCUMENTALE', 'ANALISI DOCUMENTALE'];
  const BANNER_GRUPPO_2_STORICO = ['SOPRALLUOGO AMBIENTI DI LAVORO'];

  // Stessa mappatura concettuale di GRUPPI_SEZIONI in js/pdf.js: nel formato storico la
  // numerazione delle domande RIPARTE DA 1 a ogni cambio di queste due macro-sezioni.
  const SEZIONI_GRUPPO_1_STORICO = [
    'Adempimenti Formali',
    'Documento di Valutazione del Rischio',
    "Gestione dell'Emergenza",
    'Attività di Formazione',
    'Documentazione Procedurale'
  ];
  const SEZIONI_GRUPPO_2_STORICO = [
    'Antincendio / Mezzi di Emergenza e Cartellonistica',
    'Vie di Esodo',
    'Locali di Lavoro / Struttura',
    'Macchine / Attrezzature'
  ];

  /**
   * Normalizza il titolo di una sezione per confronti case/punteggiatura/spazi-insensitive.
   * Riduce anche le vocali accentate alla forma base (à->a ecc.): il JSON delle checklist scrive
   * i titoli in MAIUSCOLO senza accenti, sostituendo l'accento con un apostrofo dopo la vocale
   * (es. "ATTIVITA' DI FORMAZIONE"), mentre l'elenco di riferimento qui sotto usa l'accento vero
   * ("Attività di Formazione"): senza questo passo i due non risulterebbero mai uguali.
   */
  function normalizzaTitoloSezione(testo) {
    return String(testo || '')
      .toLowerCase()
      .replace(/[àáâã]/g, 'a')
      .replace(/[èéêë]/g, 'e')
      .replace(/[ìíîï]/g, 'i')
      .replace(/[òóôõ]/g, 'o')
      .replace(/[ùúûü]/g, 'u')
      .replace(/[^a-z0-9]+/g, '');
  }

  /** Divide le domande (già appiattite) nei due gruppi noti in base al nome della sezione. Eventuali sezioni non mappate finiscono nel gruppo più vicino nell'ordine del JSON. */
  function suddividiPerGruppoStorico(domande) {
    const norm1 = SEZIONI_GRUPPO_1_STORICO.map(normalizzaTitoloSezione);
    const norm2 = SEZIONI_GRUPPO_2_STORICO.map(normalizzaTitoloSezione);
    const gruppo1 = [];
    const gruppo2 = [];
    const resto = [];
    domande.forEach((d) => {
      const norm = normalizzaTitoloSezione(d.sezione);
      if (norm1.includes(norm)) {
        gruppo1.push(d);
      } else if (norm2.includes(norm)) {
        gruppo2.push(d);
      } else {
        resto.push(d);
      }
    });
    return { gruppo1, gruppo2, resto };
  }

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

  /** Trova sulla pagina le intestazioni di colonna C/PC/NC/NA/NOTE (dopo l'unione dei frammenti adiacenti, "N"+"A" è già diventato "NA"). */
  function trovaIntestazioniColonneStorico(items) {
    const trova = (testo) => items.find((it) => it.testo.trim() === testo);
    const cH = trova('C');
    const pcH = trova('PC');
    const ncH = trova('NC');
    const naH = trova('NA');
    const noteH = trova('NOTE');
    if (!cH || !pcH || !ncH || !naH || !noteH) {
      return null;
    }
    return {
      C: cH.x,
      PC: pcH.x,
      NC: ncH.x,
      NA: naH.x,
      // Come nel formato nostro: "NOTE" è centrata nella sua colonna (molto più a destra),
      // mentre il testo delle note è allineato a sinistra subito dopo la colonna NA.
      sogliaNota: naH.x + 20
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
        eventi.push({ tipo: 'banner', gruppo: 1, y: it.y });
      } else if (BANNER_GRUPPO_2_STORICO.includes(testo)) {
        eventi.push({ tipo: 'banner', gruppo: 2, y: it.y });
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
   * dall'alto in basso: per ogni riga, cerca la "X" di stato e il testo di nota nell'intervallo
   * y fra questo evento e il successivo (non un punto fisso: in questo formato "X" e note non
   * sono allineate alla stessa y della riga, ma cadono comunque nel suo intervallo verticale).
   * Gestisce anche il caso in cui una nota prosegua oltre l'interruzione di pagina: il testo
   * "orfano" trovato prima del primo evento di una pagina viene aggiunto alla nota dell'ultima
   * domanda elaborata nella pagina precedente.
   */
  function elaboraEventiPaginaStorico(items, colonne, contesto, gruppo1, gruppo2, risultatiPerId, usaGruppi) {
    const eventi = trovaEventiPaginaStorico(items);
    if (!eventi.length) {
      return contesto;
    }

    if (contesto.idInCorso !== null) {
      const primoEvento = eventi[0];
      const orfani = items.filter(
        (it) => it.y > primoEvento.y && it.x > colonne.sogliaNota && !INTESTAZIONI_STORICO.includes(it.testo.trim())
      );
      if (orfani.length) {
        const voce = risultatiPerId.get(contesto.idInCorso);
        if (voce) {
          const testoOrfano = ricomponiTesto(raggruppaInLinee(orfani, TOLLERANZA_RIGA_PT));
          if (testoOrfano) {
            voce.note = voce.note ? `${voce.note} ${testoOrfano}` : testoOrfano;
          }
        }
      }
    }

    let elencoAttivo = contesto.elencoAttivo;
    let idInCorso = contesto.idInCorso;

    eventi.forEach((evento, indice) => {
      if (evento.tipo === 'banner') {
        if (usaGruppi) {
          elencoAttivo = evento.gruppo === 1 ? gruppo1 : gruppo2;
        }
        idInCorso = null; // un cambio di macro-sezione non porta con sé una nota in sospeso
        return;
      }

      const yFine = eventi[indice + 1] ? eventi[indice + 1].y : -Infinity;
      const domandaCorrispondente = elencoAttivo[evento.numeroLocale - 1];
      if (!domandaCorrispondente) {
        return; // numero fuori range per il gruppo attivo: non si indovina
      }
      const idReale = domandaCorrispondente.domanda.id;
      idInCorso = idReale;

      if (!risultatiPerId.has(idReale)) {
        risultatiPerId.set(idReale, { risposta: null, note: null });
      }
      const voce = risultatiPerId.get(idReale);

      const nellaRiga = (it) => it.y > yFine && it.y <= evento.y + 2;

      const marcature = items.filter((it) => it.testo.trim() === 'X' && nellaRiga(it));
      if (marcature.length === 1) {
        voce.risposta = colonnaStatoPiuVicina(marcature[0].x, colonne);
      }

      const candidatiNota = items.filter(
        (it) => it.x > colonne.sogliaNota && nellaRiga(it) && !INTESTAZIONI_STORICO.includes(it.testo.trim())
      );
      if (candidatiNota.length) {
        const testoNota = ricomponiTesto(raggruppaInLinee(candidatiNota, TOLLERANZA_RIGA_PT));
        if (testoNota) {
          voce.note = voce.note ? `${voce.note} ${testoNota}` : testoNota;
        }
      }
    });

    return { elencoAttivo, idInCorso };
  }

  /**
   * Prova il formato "storico" sull'intero documento (pagine già estratte). Ritorna
   * { risposte, anagrafica, totaleDomande, domandeRiconosciute, strutturaRiconosciuta }.
   */
  function provaFormatoStorico(pagine, checklist, domande) {
    const { gruppo1, gruppo2, resto } = suddividiPerGruppoStorico(domande);
    const usaGruppi = gruppo1.length > 0 || gruppo2.length > 0;
    const elencoIniziale = usaGruppi ? gruppo1 : [...gruppo1, ...gruppo2, ...resto];

    const risultatiPerId = new Map();
    let anagrafica = {};
    let strutturaRiconosciuta = false;
    let contesto = { elencoAttivo: elencoIniziale, idInCorso: null };

    pagine.forEach((itemsGrezzi, indice) => {
      const numeroPagina = indice + 1;
      const limiteFooter = limiteFooterStorico(itemsGrezzi);
      const itemsFiltrati = itemsGrezzi.filter((it) => it.y > limiteFooter);
      const items = raggruppaFrammentiAdiacenti(itemsFiltrati);

      const colonne = trovaIntestazioniColonneStorico(items);
      if (colonne) {
        strutturaRiconosciuta = true;
      }

      if (numeroPagina === 1) {
        anagrafica = estraiDatiGeneraliStorico(items);
      }

      if (colonne) {
        contesto = elaboraEventiPaginaStorico(items, colonne, contesto, gruppo1, gruppo2, risultatiPerId, usaGruppi);
      }
    });

    const risposte = [];
    domande.forEach(({ sezione, domanda }) => {
      const trovata = risultatiPerId.get(domanda.id);
      if (trovata && trovata.risposta) {
        risposte.push({
          domanda_id: domanda.id,
          sezione,
          risposta: trovata.risposta,
          note: trovata.note || null,
          foto: []
        });
      }
    });

    return {
      risposte,
      anagrafica,
      totaleDomande: domande.length,
      domandeRiconosciute: risposte.length,
      strutturaRiconosciuta
    };
  }

  // ======================================================================================
  // Punto di ingresso comune
  // ======================================================================================

  function riconoscimentoSufficiente(risultato) {
    return Boolean(
      risultato &&
      risultato.strutturaRiconosciuta &&
      risultato.totaleDomande > 0 &&
      risultato.domandeRiconosciute / risultato.totaleDomande >= SOGLIA_RICONOSCIMENTO
    );
  }

  /**
   * Analizza il file PDF selezionato e ricostruisce le risposte alla checklist indicata,
   * provando prima il formato "nostro" e poi, se insufficiente, quello "storico". Ritorna
   * { risposte, anagrafica, totaleDomande, domandeRiconosciute, formatoRilevato }. Le risposte
   * non riconosciute con certezza sono semplicemente assenti dall'array (nessuna voce = nessuna
   * risposta, come una domanda mai compilata).
   */
  async function importaDaFile(file, checklist) {
    if (typeof pdfjsLib === 'undefined') {
      throw new Error('Libreria di lettura PDF non disponibile.');
    }

    const domande = appiattisciDomande(checklist);
    const idValidi = new Set(domande.map((d) => d.domanda.id));

    const buffer = await file.arrayBuffer();
    const documento = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;

    const pagine = [];
    for (let numeroPagina = 1; numeroPagina <= documento.numPages; numeroPagina += 1) {
      const pagina = await documento.getPage(numeroPagina);
      const contenuto = await pagina.getTextContent();
      const items = contenuto.items
        .map((it) => ({ testo: it.str, x: it.transform[4], y: it.transform[5], w: it.width }))
        .filter((it) => it.testo.trim() !== '');
      pagine.push(items);
    }

    let risultatoNostro = null;
    let erroreNostro = null;
    try {
      risultatoNostro = provaFormatoNostro(pagine, checklist, domande, idValidi);
    } catch (errore) {
      erroreNostro = errore;
    }

    if (riconoscimentoSufficiente(risultatoNostro)) {
      return { ...risultatoNostro, formatoRilevato: 'nostro' };
    }

    const risultatoStorico = provaFormatoStorico(pagine, checklist, domande);
    if (riconoscimentoSufficiente(risultatoStorico)) {
      return { ...risultatoStorico, formatoRilevato: 'storico' };
    }

    // Nessuno dei due formati ha riconosciuto una percentuale sufficiente di domande: meglio
    // segnalarlo chiaramente che importare dati parziali senza dirlo (vedi limiti noti).
    if (erroreNostro) {
      throw erroreNostro;
    }

    const migliore = [risultatoNostro, risultatoStorico]
      .filter((r) => r && r.strutturaRiconosciuta)
      .sort((a, b) => b.domandeRiconosciute - a.domandeRiconosciute)[0];

    if (migliore) {
      const percentuale = Math.round((migliore.domandeRiconosciute / migliore.totaleDomande) * 100);
      throw new Error(
        `Solo ${migliore.domandeRiconosciute} domande su ${migliore.totaleDomande} (${percentuale}%) sono state ` +
        'riconosciute con certezza in questo PDF: percentuale troppo bassa per fidarsi dell\'importazione. ' +
        'Verifica di aver selezionato la checklist corretta.'
      );
    }

    throw new Error(
      `Formato PDF non riconosciuto per la checklist "${checklist.titolo}": non sembra né il formato generato ` +
      'da questa app né il formato storico Coin supportato. Verifica il file o la checklist selezionata.'
    );
  }

  return { importaDaFile };
})();
