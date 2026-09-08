/**
 * Estrazione (SOLO estrazione: nessun abbinamento a una checklist qui, vedi js/import-matching.js)
 * di righe da un PDF di sopralluogo già compilato. Supporta due formati, provati in quest'ordine:
 *
 * 1. "nostro" — il PDF generato da questa stessa app (js/pdf.js): tabella "DATI GENERALI" +
 *    tabelle sezione con colonne n./Descrizione attività/C/P.C/N.C/N.P/Note (vedi
 *    disegnaTabellaDatiGenerali e disegnaTabellaSezione). La colonna "n." è l'id VERO della
 *    domanda (non un numero di riga), quindi ogni riga porta con sé un identificatore stabile.
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
  const TOLLERANZA_TITOLO_SEZIONE_PT = 14;

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
    'presenza_responsabile',
    'presenza_rls'
  ];

  const TESTI_HEAD_TABELLA_NOSTRO = ['n.', 'C', 'P.C', 'N.C', 'N.P', 'Note', 'Descrizione attività'];

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
        (it) => it.testo.trim() === 'X' && Math.abs(it.y - riga.y) <= TOLLERANZA_RIGA_PT
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
        righe.push(...estraiRighePaginaNostro(items, colonneCorrenti, sezioneCorrente));
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
    if (!eventi.length) {
      return { righe: righeProdotte, contesto };
    }

    if (contesto.ultimaRiga) {
      const primoEvento = eventi[0];
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
      const nellaRiga = (it) => it.y > yFine && it.y <= evento.y + 2;

      const marcature = items.filter((it) => it.testo.trim() === 'X' && nellaRiga(it));
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

    pagine.forEach((itemsGrezzi, indice) => {
      const numeroPagina = indice + 1;
      const limiteFooter = limiteFooterStorico(itemsGrezzi);
      const itemsFiltrati = itemsGrezzi.filter((it) => it.y > limiteFooter);
      const items = raggruppaFrammentiAdiacenti(itemsFiltrati);

      const colonne = trovaIntestazioniColonneStorico(items);
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

  /** Estrae solo le regioni fotografiche e le didascalie della pagina, senza persistenza. */
  async function estraiImmaginiPagina(pagina, items, numeroPagina, opzioni = {}) {
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
        // Known letterheads sit entirely in the top 115pt and are wider than tall.
        // Old Coin repeats them on every page; a portrait photo starting near the
        // top (e.g. Restage page 7) must still be imported.
        if (right - x < 20 || top - y < 20 || (y > pagina.view[3] - 115 && (numeroPagina === 1 || (right - x) / (top - y) > 1.5))) continue;
        regioni.push({ x, y, right, top, matrix: matrix.slice(), ref: args[0], inline: fn === OPS.paintInlineImageXObject });
      }
    }
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
        let img = region.inline ? region.ref : null;
        if (!img) {
          const store = String(region.ref).startsWith('g_') ? pagina.commonObjs : pagina.objs;
          img = await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('Immagine non disponibile')), 2000);
            store.get(region.ref, value => { clearTimeout(timer); resolve(value); });
          });
        }
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
      const pagine = [];
      const immagini = [];
      for (let numeroPagina = 1; numeroPagina <= documento.numPages; numeroPagina += 1) {
        const pagina = await documento.getPage(numeroPagina);
        const contenuto = await pagina.getTextContent();
        const items = contenuto.items
          .map((it) => ({ testo: it.str, x: it.transform[4], y: it.transform[5], w: it.width }))
          .filter((it) => it.testo.trim() !== '');
        pagine.push(items);
        immagini.push(...await estraiImmaginiPagina(pagina, items, numeroPagina, opzioni));
        pagina.cleanup();
      }

      const risultatoNostro = provaFormatoNostro(pagine);
      if (risultatoNostro.strutturaRiconosciuta && risultatoNostro.righe.length) {
        return {
          formatoRilevato: 'nostro',
          immagini,
          righe: risultatoNostro.righe,
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
      provaFormatoNostro,
      provaFormatoStorico,
      raggruppaFrammentiAdiacenti
    }
  };
})();
