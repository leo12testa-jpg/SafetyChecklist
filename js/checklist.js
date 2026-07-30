/**
 * Motore di compilazione checklist: caricamento JSON, navigazione domanda per domanda,
 * validazione risposte (PROJECT.md §5, §7.3). "NC" è un valore di risposta come gli altri:
 * nessun sotto-form o validazione speciale.
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

  /** Salva la risposta alla domanda corrente (autosalvataggio immediato su db.js). Note e foto sono opzionali per qualsiasi valore. */
  async function rispondi({ valore, note = null, foto = [] }) {
    const { domanda, sezione } = domande[indice];
    const risposta = { domanda_id: domanda.id, sezione, risposta: valore, note, foto };

    sopralluogo = await db.salvaRisposta(sopralluogo.id, risposta);
    return risposta;
  }

  /**
   * Rispondere è sempre facoltativo, per qualsiasi stile di checklist: una domanda può restare
   * senza risposta e venire compilata più tardi tornando indietro con "Indietro".
   */
  function puoAvanzare() {
    return Boolean(domandaCorrente());
  }

  /** Passa alla domanda successiva (la risposta non è obbligatoria). Ritorna false se già all'ultima domanda. */
  function avanti() {
    if (indice >= domande.length - 1) {
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
   * Calcola conteggi per stato (C/PC/NC/NA), numero di domande senza risposta ed elenco delle
   * Non Conformità, per una qualsiasi coppia checklist+sopralluogo (PROJECT.md §7.5). Itera su
   * tutte le domande della checklist (non solo sulle risposte salvate) così le domande mai
   * risposte vengono contate come "non risposte" invece di essere semplicemente ignorate.
   * Funzione pura: non dipende dallo stato interno del motore, così da poter rigenerare anche
   * report di sopralluoghi storici (Fase 7).
   */
  function calcolaRiepilogo(checklistDati, sopralluogoDati) {
    const domandeComplete = appiattisciDomande(checklistDati);
    const conteggi = { C: 0, PC: 0, NC: 0, NA: 0 };
    const nonConformita = [];
    let nonRisposte = 0;

    domandeComplete.forEach(({ sezione, domanda }) => {
      const r = (sopralluogoDati.risposte || []).find((x) => x.domanda_id === domanda.id);
      const valore = r ? r.risposta : null;

      if (!valore) {
        nonRisposte += 1;
        return;
      }

      if (conteggi[valore] !== undefined) {
        conteggi[valore] += 1;
      }
      if (valore === 'NC') {
        nonConformita.push({
          domanda_id: domanda.id,
          sezione,
          testo: domanda.testo,
          note: r.note || '',
          foto: r.foto || []
        });
      }
    });

    return { totale: domandeComplete.length, conteggi, nonRisposte, nonConformita };
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
