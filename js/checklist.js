/**
 * Motore di compilazione checklist: caricamento JSON, navigazione domanda per domanda,
 * validazione risposte e gestione del sotto-form Non Conformità (PROJECT.md §5, §7.3, §7.4).
 */
const checklistEngine = (() => {
  let checklist = null;
  let sopralluogo = null;
  let domande = []; // flat: [{ sezione, domanda }]
  let indice = 0;

  function appiattisciDomande(cl) {
    const risultato = [];
    (cl.sezioni || []).forEach((sezione) => {
      (sezione.domande || []).forEach((domanda) => {
        risultato.push({ sezione: sezione.titolo, domanda });
      });
    });
    return risultato;
  }

  function trovaRisposta(domandaId) {
    return (sopralluogo.risposte || []).find((r) => r.domanda_id === domandaId);
  }

  function validaNCDettaglio(dettaglio) {
    return Boolean(dettaglio && dettaglio.descrizione && dettaglio.descrizione.trim() && dettaglio.priorita);
  }

  /**
   * Carica il JSON di una checklist da checklists/<id>.json (schema PROJECT.md §5),
   * salvandone una copia in checklists_cache. Se la rete non è disponibile, usa la cache.
   */
  async function carica(checklistId) {
    try {
      const response = await fetch(`checklists/${checklistId}.json`);
      if (!response.ok) {
        throw new Error(`Checklist non trovata: ${checklistId}`);
      }
      const dati = await response.json();
      await db.salvaChecklistCache(dati);
      return dati;
    } catch (errore) {
      const dallaCache = await db.leggiChecklistCache(checklistId);
      if (dallaCache) {
        return dallaCache;
      }
      throw errore;
    }
  }

  /**
   * Avvia la compilazione: collega la checklist caricata al sopralluogo corrente
   * e riprende dalla prima domanda senza risposta (o dall'ultima, se già tutte risposte).
   */
  function avvia(checklistCaricata, sopralluogoCorrente) {
    checklist = checklistCaricata;
    sopralluogo = sopralluogoCorrente;
    domande = appiattisciDomande(checklist);

    const primaSenzaRisposta = domande.findIndex((d) => !trovaRisposta(d.domanda.id));
    indice = primaSenzaRisposta === -1 ? domande.length - 1 : primaSenzaRisposta;
  }

  /** Stato della domanda corrente: testo, sezione, progresso ("indice"/"totale") ed eventuale risposta già salvata. */
  function domandaCorrente() {
    if (!domande.length) {
      return null;
    }
    const { sezione, domanda } = domande[indice];
    return {
      sezione,
      domanda,
      indice,
      totale: domande.length,
      risposta: trovaRisposta(domanda.id) || null
    };
  }

  /**
   * Salva la risposta alla domanda corrente (autosalvataggio immediato su db.js).
   * Se il valore è "NC", nc_dettaglio è obbligatorio con almeno descrizione e priorità (§7.4).
   */
  async function rispondi({ valore, note = null, foto = [], nc_dettaglio = null }) {
    const { domanda, sezione } = domande[indice];

    if (valore === 'NC' && !validaNCDettaglio(nc_dettaglio)) {
      throw new Error('Per una risposta "NC" sono obbligatorie Descrizione e Priorità.');
    }

    const risposta = {
      domanda_id: domanda.id,
      sezione,
      risposta: valore,
      note,
      foto,
      nc_dettaglio: valore === 'NC' ? nc_dettaglio : null
    };

    sopralluogo = await db.salvaRisposta(sopralluogo.id, risposta);
    return risposta;
  }

  /** True se la domanda corrente ha già una risposta valida e completa (obbligatoria per poter avanzare). */
  function puoAvanzare() {
    const corrente = domandaCorrente();
    if (!corrente || !corrente.risposta) {
      return false;
    }
    if (corrente.risposta.risposta === 'NC') {
      return validaNCDettaglio(corrente.risposta.nc_dettaglio);
    }
    return true;
  }

  /** Passa alla domanda successiva. Ritorna false (senza avanzare) se la domanda corrente non è ancora risposta. */
  function avanti() {
    if (!puoAvanzare() || indice >= domande.length - 1) {
      return false;
    }
    indice += 1;
    return true;
  }

  /** Torna alla domanda precedente, mantenendo le risposte già date. */
  function indietro() {
    if (indice === 0) {
      return false;
    }
    indice -= 1;
    return true;
  }

  /** Ritorna il sopralluogo attualmente in compilazione (serve a camera.js/pdf.js per l'id). */
  function sopralluogoCorrente() {
    return sopralluogo;
  }

  /** Ritorna la checklist attualmente caricata (serve a pdf.js per generare il report). */
  function getChecklist() {
    return checklist;
  }

  /**
   * Calcola conteggi per stato (C/PC/NC/NA) ed elenco delle Non Conformità per una qualsiasi
   * coppia checklist+sopralluogo (PROJECT.md §7.5). Funzione pura: non dipende dallo stato
   * interno del motore, così da poter rigenerare anche report di sopralluoghi storici (Fase 7).
   */
  function calcolaRiepilogo(checklistDati, sopralluogoDati) {
    const domandeComplete = appiattisciDomande(checklistDati);
    const conteggi = { C: 0, PC: 0, NC: 0, NA: 0 };
    const nonConformita = [];

    (sopralluogoDati.risposte || []).forEach((r) => {
      if (conteggi[r.risposta] !== undefined) {
        conteggi[r.risposta] += 1;
      }
      if (r.risposta === 'NC' && r.nc_dettaglio) {
        const info = domandeComplete.find((d) => d.domanda.id === r.domanda_id);
        nonConformita.push({
          domanda_id: r.domanda_id,
          sezione: r.sezione,
          testo: info ? info.domanda.testo : '',
          ...r.nc_dettaglio
        });
      }
    });

    return { totale: domandeComplete.length, conteggi, nonConformita };
  }

  return {
    carica,
    avvia,
    domandaCorrente,
    rispondi,
    puoAvanzare,
    avanti,
    indietro,
    sopralluogoCorrente,
    getChecklist,
    calcolaRiepilogo
  };
})();
