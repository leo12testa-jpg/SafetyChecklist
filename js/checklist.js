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
    // Firestore usa chiavi stringa: "12" e 12 identificano la stessa domanda della checklist.
    if (domandaId === null || domandaId === undefined) return undefined;
    const id = String(domandaId);
    return (sopralluogo.risposte || []).find((r) =>
      r && r.domanda_id !== null && r.domanda_id !== undefined && String(r.domanda_id) === id
    );
  }

  /**
   * Una domanda è compilata solo se contiene un valore effettivo.
   * Serve anche alle checklist "raccolta-dati": [] e oggetti con soli campi vuoti NON sono
   * risposte, mentre 0 è un valore valido.
   */
  function rispostaHaValore(valore) {
    if (valore === null || valore === undefined) return false;
    if (typeof valore === 'string') return valore.trim() !== '';
    if (Array.isArray(valore)) return valore.some((voce) => rispostaHaValore(voce));
    if (typeof valore === 'object') return Object.values(valore).some((voce) => rispostaHaValore(voce));
    return true;
  }

  function rispostaCompilata(risposta) {
    return Boolean(risposta && rispostaHaValore(risposta.risposta));
  }

  function validaChecklist(checklistId, dati, versioneAttesa = null) {
    if (!dati || dati.id !== checklistId) {
      throw new Error(`Checklist non valida o id non coerente: attesa "${checklistId}".`);
    }
    if (versioneAttesa && String(dati.versione || '') !== String(versioneAttesa)) {
      throw new Error(
        `Versione checklist non sincronizzata per "${checklistId}": attesa ${versioneAttesa}, trovata ${dati.versione || 'nessuna'}.`
      );
    }
    const ids = appiattisciDomande(dati).map((voce) => String(voce.domanda.id));
    if (ids.length !== new Set(ids).size) {
      throw new Error(`Checklist "${checklistId}" non valida: contiene id domanda duplicati.`);
    }
    return dati;
  }

  async function versioneCorrente(checklistId) {
    try {
      const response = await fetch('checklists/index.json', { cache: 'no-store' });
      if (!response.ok) return null;
      const voce = (await response.json()).checklists?.find((x) => x.id === checklistId);
      return voce?.versione || null;
    } catch (_) {
      return null;
    }
  }

  /**
   * Carica SEMPRE la revisione attesa della checklist. Online bypassa la cache HTTP e usa una
   * URL versionata; offline accetta la copia IndexedDB solo se ha la stessa versione del manifest
   * disponibile. In questo modo due dispositivi non possono compilare lo stesso sopralluogo con
   * due revisioni diverse della checklist.
   */
  async function carica(checklistId, versioneAttesa = null) {
    const versione = versioneAttesa || await versioneCorrente(checklistId);
    const suffisso = versione ? `?v=${encodeURIComponent(versione)}` : '';
    try {
      const response = await fetch(`checklists/${checklistId}.json${suffisso}`, { cache: 'no-store' });
      if (!response.ok) {
        throw new Error(`Checklist non trovata: ${checklistId}`);
      }
      const dati = validaChecklist(checklistId, await response.json(), versione);
      await db.salvaChecklistCache(dati);
      return dati;
    } catch (errore) {
      const dallaCache = await db.leggiChecklistCache(checklistId);
      if (dallaCache) {
        return validaChecklist(checklistId, dallaCache, versione);
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

    const primaSenzaRisposta = domande.findIndex((d) => !rispostaCompilata(trovaRisposta(d.domanda.id)));
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

  /** Salta a un indice domanda specifico (0-based), senza modificare alcun dato. */
  function vaiA(nuovoIndice) {
    if (!Number.isInteger(nuovoIndice) || nuovoIndice < 0 || nuovoIndice >= domande.length) {
      return false;
    }
    indice = nuovoIndice;
    return true;
  }

  /** Ritorna il sopralluogo attualmente in compilazione (serve a camera.js/pdf.js per l'id). */
  function sopralluogoCorrente() {
    return sopralluogo;
  }

  /**
   * Ricarica da IndexedDB il sopralluogo in compilazione, mantenendo invariati indice/domanda
   * corrente: usata da js/app.js quando arriva un aggiornamento via sync (js/sync.js,
   * onDatiAggiornati) mentre la schermata di Compilazione è già aperta, per riflettere risposte
   * date nel frattempo da un altro dispositivo. Non ridisegna la domanda a schermo: sta al
   * chiamante decidere cosa aggiornare, per non rischiare di sovrascrivere un campo che l'utente
   * sta compilando in quel momento.
   */
  async function ricaricaSopralluogoCorrente() {
    if (!sopralluogo) {
      return null;
    }
    const fresco = await db.leggiSopralluogo(sopralluogo.id);
    if (fresco) {
      sopralluogo = fresco;
    }
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
      const r = (sopralluogoDati.risposte || []).find((x) =>
        x && x.domanda_id != null && String(x.domanda_id) === String(domanda.id)
      );
      const valore = r ? r.risposta : null;

      if (!rispostaHaValore(valore)) {
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
    vaiA,
    sopralluogoCorrente,
    ricaricaSopralluogoCorrente,
    getChecklist,
    calcolaRiepilogo,
    rispostaHaValore,
    rispostaCompilata,
    _validaChecklist: validaChecklist
  };
})();
