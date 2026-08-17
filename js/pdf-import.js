/**
 * Importazione di un sopralluogo a partire da un PDF già generato da questa stessa app
 * (js/pdf.js, layout fisso: tabella "DATI GENERALI" + tabelle sezione con colonne
 * n./Descrizione attività/C/P.C/N.C/N.P/Note, vedi disegnaTabellaDatiGenerali e
 * disegnaTabellaSezione). Usa pdf.js (Mozilla, vendorizzato in js/vendor/pdf.min.js) per
 * estrarre il testo di ogni pagina CON le coordinate x/y di ogni elemento (getTextContent),
 * non il testo grezzo: è dalla posizione che si ricostruisce a quale domanda/colonna
 * appartiene ogni "X" o nota, dato che il testo grezzo da solo non lo dice.
 *
 * Limiti noti (documentati anche per l'utente nell'interfaccia):
 * - Solo checklist con lo stesso layout "a stato" C/P.C/N.C/N.P generato da pdf.js (non le
 *   checklist "stile": "raccolta-dati", che hanno un report diverso senza queste colonne).
 * - Le foto non vengono mai importate (impossibile recuperarle in modo affidabile da un PDF
 *   già appiattito): il chiamante deve avvisare l'utente.
 * - Una riga è riconosciuta solo se ha ESATTAMENTE un segno "X" in una delle 4 colonne di
 *   stato: 0 o più di 1 marcatura trovata per la stessa riga => quella domanda resta senza
 *   risposta invece di essere indovinata.
 * - Le note molto lunghe, se il loro blocco verticale arriva quasi a toccare la riga
 *   successiva, potrebbero in casi limite "rubare" qualche riga di testo alla nota della
 *   domanda adiacente (l'assegnazione è per vicinanza in y, non per bordi di cella espliciti,
 *   che il testo grezzo di un PDF non riporta).
 */
const pdfImport = (() => {
  if (typeof pdfjsLib !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'js/vendor/pdf.worker.min.js';
  }

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

  /**
   * Trova sulla pagina le intestazioni di colonna della tabella sezione ('n.', 'C', 'P.C',
   * 'N.C', 'N.P', 'Note') e ne ricava la coordinata x di riferimento. Le intestazioni si
   * ripetono a ogni tabella/sezione e a ogni pagina, sempre alla stessa x (layout fisso):
   * basta trovarne una sola occorrenza per ricavare le colonne dell'intera pagina.
   */
  function trovaIntestazioniColonne(items) {
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

  /** Ricompone il testo di una nota da più elementi (righe multiple per il wrapping): raggruppa per riga, unisce per x. */
  function ricomponiTesto(parti) {
    const ordinate = [...parti].sort((a, b) => b.y - a.y);
    const righe = [];
    ordinate.forEach((parte) => {
      const ultima = righe[righe.length - 1];
      if (ultima && Math.abs(ultima.y - parte.y) <= TOLLERANZA_RIGA_PT) {
        ultima.parti.push(parte);
      } else {
        righe.push({ y: parte.y, parti: [parte] });
      }
    });
    return righe
      .map((riga) => riga.parti.sort((a, b) => a.x - b.x).map((p) => p.testo).join(' '))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** Estrae risposte/note dalle righe della tabella sezione presenti in questa pagina. Aggiorna `risultatiPerId`. */
  function estraiRisposteDiPagina(items, colonne, idValidi, risultatiPerId) {
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
    const parolePerRiga = new Map();

    candidatiNota.forEach((candidato) => {
      let rigaVicina = null;
      let distanzaMinima = Infinity;
      righe.forEach((riga) => {
        const distanza = Math.abs(candidato.y - riga.y);
        if (distanza < distanzaMinima) {
          distanzaMinima = distanza;
          rigaVicina = riga;
        }
      });
      if (!rigaVicina || distanzaMinima > TOLLERANZA_RIGA_NOTA_PT) {
        return;
      }
      if (!parolePerRiga.has(rigaVicina.id)) {
        parolePerRiga.set(rigaVicina.id, []);
      }
      parolePerRiga.get(rigaVicina.id).push(candidato);
    });

    parolePerRiga.forEach((parti, id) => {
      const voce = risultatiPerId.get(id);
      if (voce) {
        voce.note = ricomponiTesto(parti) || null;
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
  function estraiDatiGenerali(items) {
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

    const valoriOrdinati = zonaTabella.filter((it) => it.x >= sogliaValore).sort((a, b) => b.y - a.y);
    const righeValore = [];
    valoriOrdinati.forEach((it) => {
      const ultima = righeValore[righeValore.length - 1];
      if (ultima && Math.abs(ultima.y - it.y) <= TOLLERANZA_RIGA_MULTILINEA_PT) {
        ultima.parti.push(it);
      } else {
        righeValore.push({ y: it.y, parti: [it] });
      }
    });

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

  /**
   * Analizza il file PDF selezionato e ricostruisce le risposte alla checklist indicata.
   * Ritorna { risposte, anagrafica, totaleDomande, domandeRiconosciute }. Le risposte non
   * riconosciute con certezza sono semplicemente assenti dall'array (nessuna voce = nessuna
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

    const risultatiPerId = new Map();
    let anagrafica = {};
    let colonneCorrenti = null;
    let titoloRilevato = null;

    for (let numeroPagina = 1; numeroPagina <= documento.numPages; numeroPagina += 1) {
      const pagina = await documento.getPage(numeroPagina);
      const contenuto = await pagina.getTextContent();
      const items = contenuto.items
        .map((it) => ({ testo: it.str, x: it.transform[4], y: it.transform[5] }))
        .filter((it) => it.testo.trim() !== '');

      const intestazioni = trovaIntestazioniColonne(items);
      if (intestazioni) {
        colonneCorrenti = intestazioni;
      }

      if (numeroPagina === 1) {
        anagrafica = estraiDatiGenerali(items);
        // Il titolo della checklist è il primo testo disegnato nell'intestazione (vedi
        // disegnaIntestazione): confrontarlo con quello scelto dall'utente individua l'errore più
        // pericoloso possibile, cioè importare un PDF con la checklist SBAGLIATA. In quel caso i
        // numeri di riga combaciano comunque (entrambe le checklist numerano le domande da 1), e
        // senza questo controllo l'importazione sembrerebbe riuscita con dati completamente errati.
        titoloRilevato = items.length ? items[0].testo.trim() : null;
      }

      if (colonneCorrenti) {
        estraiRisposteDiPagina(items, colonneCorrenti, idValidi, risultatiPerId);
      }
    }

    if (titoloRilevato && checklist.titolo && titoloRilevato !== checklist.titolo.trim()) {
      throw new Error(
        `Il PDF sembra generato per la checklist "${titoloRilevato}", non "${checklist.titolo}". ` +
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
      domandeRiconosciute: risposte.length
    };
  }

  return { importaDaFile };
})();
