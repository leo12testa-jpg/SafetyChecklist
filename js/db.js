/**
 * Wrapper Promise-based su IndexedDB per Safety Checklist.
 * Object store (PROJECT.md §6): sopralluoghi, foto, checklists_cache, impostazioni, pdf_report.
 */
const db = (() => {
  const DB_NAME = 'SafetyChecklistDB';
  const DB_VERSION = 2;

  let dbPromise = null;

  /**
   * Hook per js/sync.js: notificato dopo ogni mutazione locale di un sopralluogo, così la
   * sincronizzazione con Firestore può reagire senza che db.js debba conoscere Firebase.
   * Non notificato quando i dati arrivano DA remoto (vedi applicaSopralluogoRemoto), per
   * evitare di rimandare a Firestore ciò che si è appena scaricato.
   */
  let listenerCambiamento = null;

  function onCambiamento(callback) {
    listenerCambiamento = callback;
  }

  function notificaCambiamento(evento) {
    if (listenerCambiamento) {
      try {
        listenerCambiamento(evento);
      } catch (errore) {
        console.error('db.js: errore nel listener di sincronizzazione', errore);
      }
    }
  }

  function open() {
    if (dbPromise) {
      return dbPromise;
    }

    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const database = event.target.result;

        if (!database.objectStoreNames.contains('sopralluoghi')) {
          const store = database.createObjectStore('sopralluoghi', { keyPath: 'id' });
          store.createIndex('data', 'data');
        }

        if (!database.objectStoreNames.contains('foto')) {
          const store = database.createObjectStore('foto', { keyPath: 'id' });
          store.createIndex('sopralluogo_id', 'sopralluogo_id');
        }

        if (!database.objectStoreNames.contains('checklists_cache')) {
          database.createObjectStore('checklists_cache', { keyPath: 'id' });
        }

        if (!database.objectStoreNames.contains('impostazioni')) {
          database.createObjectStore('impostazioni', { keyPath: 'chiave' });
        }

        if (!database.objectStoreNames.contains('pdf_report')) {
          database.createObjectStore('pdf_report', { keyPath: 'sopralluogo_id' });
        }
      };

      request.onsuccess = (event) => resolve(event.target.result);
      request.onerror = (event) => reject(event.target.error);
    });

    return dbPromise;
  }

  function generaId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  async function transazione(storeName, mode) {
    const database = await open();
    return database.transaction(storeName, mode).objectStore(storeName);
  }

  function richiesta(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  /** Crea un nuovo sopralluogo con stato "in corso" e lo salva su DB. Ritorna il record creato. */
  async function creaSopralluogo({
    punto_vendita,
    indirizzo_punto_vendita,
    numero_dipendenti,
    tecnico,
    tecnico_2 = null,
    data_sopralluogo,
    responsabile_punto_vendita,
    area_manager = null,
    presenza_responsabile,
    presenza_rls,
    checklist_id
  }) {
    const store = await transazione('sopralluoghi', 'readwrite');
    const adesso = new Date().toISOString();
    const sopralluogo = {
      id: generaId(),
      punto_vendita,
      indirizzo_punto_vendita,
      numero_dipendenti,
      tecnico,
      tecnico_2: tecnico_2 || null,
      data_sopralluogo,
      responsabile_punto_vendita,
      // Ruolo distinto dal responsabile del punto vendita (un'area manager segue più punti
      // vendita): facoltativo, valorizzato tipicamente importando un sopralluogo dal formato
      // storico Coin (vedi js/pdf-import.js), che lo riporta in intestazione.
      area_manager,
      presenza_responsabile,
      presenza_rls,
      checklist_id,
      data: adesso,
      stato: 'in corso',
      risposte: [],
      altri_aspetti: null,
      altri_aspetti_foto: [],
      aggiornato_il: adesso
    };
    await richiesta(store.add(sopralluogo));
    notificaCambiamento({ tipo: 'upsert', sopralluogo });
    return sopralluogo;
  }

  /**
   * Duplica un sopralluogo esistente in uno nuovo (nuovo id, data odierna, stato "in corso"):
   * copia checklist_id e tutte le risposte già date (domanda per domanda, incluse le note),
   * ma NON le foto (restano solo sul sopralluogo originale, incluse quelle di "Altri aspetti")
   * né firma/stato/altri_aspetti.
   * "overrides" permette di aggiornare Cliente/Sede/Tecnico/Data prima della duplicazione
   * (il resto dei campi anagrafici è copiato dall'originale).
   */
  async function duplicaSopralluogo(sopralluogoOriginaleId, overrides = {}) {
    const store = await transazione('sopralluoghi', 'readwrite');
    const originale = await richiesta(store.get(sopralluogoOriginaleId));
    if (!originale) {
      throw new Error(`Sopralluogo non trovato: ${sopralluogoOriginaleId}`);
    }

    const adesso = new Date().toISOString();
    const nuovo = {
      id: generaId(),
      punto_vendita: overrides.punto_vendita ?? originale.punto_vendita,
      indirizzo_punto_vendita: overrides.indirizzo_punto_vendita ?? originale.indirizzo_punto_vendita,
      numero_dipendenti: originale.numero_dipendenti,
      tecnico: overrides.tecnico ?? originale.tecnico,
      tecnico_2: overrides.tecnico_2 ?? originale.tecnico_2 ?? null,
      data_sopralluogo: overrides.data_sopralluogo ?? originale.data_sopralluogo,
      responsabile_punto_vendita: originale.responsabile_punto_vendita,
      area_manager: originale.area_manager ?? null,
      presenza_responsabile: originale.presenza_responsabile,
      presenza_rls: originale.presenza_rls,
      checklist_id: originale.checklist_id,
      data: adesso,
      stato: 'in corso',
      risposte: (originale.risposte || []).map((risposta) => ({ ...risposta, foto: [] })),
      altri_aspetti: null,
      altri_aspetti_foto: [],
      aggiornato_il: adesso
    };

    await richiesta(store.add(nuovo));
    notificaCambiamento({ tipo: 'upsert', sopralluogo: nuovo });
    return nuovo;
  }

  /**
   * Sostituisce in blocco l'intero array di risposte di un sopralluogo (es. dopo un'importazione
   * da PDF: vedi js/pdf-import.js), invece dell'upsert singolo di salvaRisposta.
   */
  async function impostaRisposte(sopralluogoId, risposte) {
    const store = await transazione('sopralluoghi', 'readwrite');
    const sopralluogo = await richiesta(store.get(sopralluogoId));
    if (!sopralluogo) {
      throw new Error(`Sopralluogo non trovato: ${sopralluogoId}`);
    }

    sopralluogo.risposte = risposte;
    sopralluogo.aggiornato_il = new Date().toISOString();
    await richiesta(store.put(sopralluogo));
    notificaCambiamento({ tipo: 'upsert', sopralluogo });
    return sopralluogo;
  }

  /** Salva o aggiorna (upsert su domanda_id) la risposta a una domanda di un sopralluogo. */
  async function salvaRisposta(sopralluogoId, risposta) {
    const store = await transazione('sopralluoghi', 'readwrite');
    const sopralluogo = await richiesta(store.get(sopralluogoId));
    if (!sopralluogo) {
      throw new Error(`Sopralluogo non trovato: ${sopralluogoId}`);
    }

    const risposte = sopralluogo.risposte || [];
    const idx = risposte.findIndex((r) => r.domanda_id === risposta.domanda_id);
    if (idx >= 0) {
      risposte[idx] = { ...risposte[idx], ...risposta };
    } else {
      risposte.push(risposta);
    }
    sopralluogo.risposte = risposte;
    sopralluogo.aggiornato_il = new Date().toISOString();

    await richiesta(store.put(sopralluogo));
    notificaCambiamento({ tipo: 'upsert', sopralluogo });
    return sopralluogo;
  }

  /** Aggiorna campi di un sopralluogo esistente (es. stato: "completato", altri_aspetti). */
  async function aggiornaSopralluogo(sopralluogoId, cambiamenti) {
    const store = await transazione('sopralluoghi', 'readwrite');
    const sopralluogo = await richiesta(store.get(sopralluogoId));
    if (!sopralluogo) {
      throw new Error(`Sopralluogo non trovato: ${sopralluogoId}`);
    }

    Object.assign(sopralluogo, cambiamenti);
    sopralluogo.aggiornato_il = new Date().toISOString();
    await richiesta(store.put(sopralluogo));
    notificaCambiamento({ tipo: 'upsert', sopralluogo });
    return sopralluogo;
  }

  /** Salva una foto (blob) collegata a un sopralluogo e, opzionalmente, a una domanda. Ritorna l'id generato. */
  async function salvaFoto({ sopralluogo_id, domanda_id = null, blob }) {
    const store = await transazione('foto', 'readwrite');
    const foto = { id: generaId(), sopralluogo_id, domanda_id, blob };
    await richiesta(store.add(foto));
    return foto.id;
  }

  /** Legge una singola foto per id (contiene il blob). */
  async function leggiFoto(fotoId) {
    const store = await transazione('foto', 'readonly');
    return richiesta(store.get(fotoId));
  }

  /** Elimina una singola foto. Il chiamante aggiorna prima l'array che la referenzia. */
  async function eliminaFoto(fotoId) {
    const store = await transazione('foto', 'readwrite');
    await richiesta(store.delete(fotoId));
  }

  /** Legge un sopralluogo completo, con l'elenco delle foto collegate (indice sopralluogo_id). */
  async function leggiSopralluogo(sopralluogoId) {
    const storeSopralluoghi = await transazione('sopralluoghi', 'readonly');
    const sopralluogo = await richiesta(storeSopralluoghi.get(sopralluogoId));
    if (!sopralluogo) {
      return null;
    }

    const storeFoto = await transazione('foto', 'readonly');
    const foto = await richiesta(storeFoto.index('sopralluogo_id').getAll(sopralluogoId));

    return { ...sopralluogo, foto };
  }

  /** Elenca i sopralluoghi non nel cestino, ordinati per data decrescente. */
  async function elencaSopralluoghi() {
    const store = await transazione('sopralluoghi', 'readonly');
    const tutti = await richiesta(store.getAll());
    return tutti
      .filter((s) => !s.eliminato_il)
      .sort((a, b) => new Date(b.data) - new Date(a.data));
  }

  /** Elenca i sopralluoghi nel cestino, ordinati per data di eliminazione decrescente (i più recenti prima). */
  async function elencaCestino() {
    const store = await transazione('sopralluoghi', 'readonly');
    const tutti = await richiesta(store.getAll());
    return tutti
      .filter((s) => s.eliminato_il)
      .sort((a, b) => new Date(b.eliminato_il) - new Date(a.eliminato_il));
  }

  /** Elenca TUTTI i sopralluoghi (attivi e nel cestino), senza filtri: per il confronto di sync.js. */
  async function elencaTuttiSopralluoghi() {
    const store = await transazione('sopralluoghi', 'readonly');
    return richiesta(store.getAll());
  }

  /**
   * Scrive in locale un sopralluogo arrivato da Firestore, così com'è (nessuna modifica di
   * "aggiornato_il": è il valore deciso dal dispositivo che l'ha modificato). Non notifica
   * js/sync.js, per non rimandare a Firestore ciò che si è appena scaricato da lì.
   */
  async function applicaSopralluogoRemoto(sopralluogo) {
    const store = await transazione('sopralluoghi', 'readwrite');
    await richiesta(store.put(sopralluogo));
    return sopralluogo;
  }

  /**
   * Stato di chiusura amministrativa dello Storico ("Da completare"/"Chiusa"): del tutto
   * manuale, indipendente dal campo "stato" (in corso/completato, legato alla compilazione) e
   * dal conteggio di conformità/non conformità. I sopralluoghi esistenti non hanno questo campo:
   * vanno letti come "aperto" ovunque venga mostrato/valutato (mai scritto qui in massa, per non
   * toccare dati già salvati - vedi storicoScreen.isChiuso in app.js).
   */
  async function chiudiSopralluogo(sopralluogoId) {
    return aggiornaSopralluogo(sopralluogoId, { stato_chiusura: 'chiuso', chiuso_il: new Date().toISOString() });
  }

  /** Riporta un sopralluogo chiuso a "Da completare" (stato_chiusura: "aperto"). */
  async function riapriSopralluogo(sopralluogoId) {
    return aggiornaSopralluogo(sopralluogoId, { stato_chiusura: 'aperto' });
  }

  /** Sposta un sopralluogo nel cestino (soft-delete): marcato con "eliminato_il", resta in DB con le sue foto. */
  async function spostaNelCestino(sopralluogoId) {
    return aggiornaSopralluogo(sopralluogoId, { eliminato_il: new Date().toISOString() });
  }

  /** Ripristina un sopralluogo dal cestino, rimuovendo il campo "eliminato_il". */
  async function ripristinaSopralluogo(sopralluogoId) {
    const store = await transazione('sopralluoghi', 'readwrite');
    const sopralluogo = await richiesta(store.get(sopralluogoId));
    if (!sopralluogo) {
      throw new Error(`Sopralluogo non trovato: ${sopralluogoId}`);
    }

    delete sopralluogo.eliminato_il;
    sopralluogo.aggiornato_il = new Date().toISOString();
    await richiesta(store.put(sopralluogo));
    notificaCambiamento({ tipo: 'upsert', sopralluogo });
    return sopralluogo;
  }

  const GIORNI_CONSERVAZIONE_CESTINO = 30;

  /**
   * Elimina definitivamente (con foto e PDF collegati) i sopralluoghi nel cestino da più
   * dei giorni di conservazione previsti. Pensata per una chiamata silenziosa all'avvio dell'app
   * (va chiamata SOLO dopo una sincronizzazione riuscita: vedi app.js), quindi logga sempre
   * esplicitamente quando elimina qualcosa (quanti, quali id, da quando erano nel cestino) — in
   * modo da avere una traccia diretta in console invece di dover ricostruire tutto a posteriori
   * dai soli timestamp Firestore, se in futuro succede ancora qualcosa di inatteso.
   */
  async function pulisciCestino() {
    const cestino = await elencaCestino();
    const limiteMs = GIORNI_CONSERVAZIONE_CESTINO * 24 * 60 * 60 * 1000;
    const adesso = Date.now();

    const daEliminare = cestino.filter(
      (s) => adesso - new Date(s.eliminato_il).getTime() > limiteMs
    );

    if (daEliminare.length > 0) {
      console.warn(
        `[db.js] pulisciCestino: elimino definitivamente ${daEliminare.length} sopralluoghi ` +
        `(nel cestino da più di ${GIORNI_CONSERVAZIONE_CESTINO} giorni): ` +
        daEliminare.map((s) => `${s.id} ("${s.punto_vendita}", nel cestino dal ${s.eliminato_il})`).join('; ')
      );
    }

    for (const sopralluogo of daEliminare) {
      await eliminaSopralluogo(sopralluogo.id);
    }

    return daEliminare.length;
  }

  /** Cancella (via cursore, stessa transazione) tutte le foto collegate a un sopralluogo. */
  function eliminaFotoDiSopralluogo(storeFoto, sopralluogoId) {
    return new Promise((resolve, reject) => {
      const request = storeFoto.index('sopralluogo_id').openCursor(sopralluogoId);
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        } else {
          resolve();
        }
      };
      request.onerror = () => reject(request.error);
    });
  }

  /** Elimina fisicamente da IndexedDB un sopralluogo e i suoi dati collegati (foto, PDF). */
  async function eliminaSopralluogoInterno(sopralluogoId) {
    const storeSopralluoghi = await transazione('sopralluoghi', 'readwrite');
    await richiesta(storeSopralluoghi.delete(sopralluogoId));

    const storeFoto = await transazione('foto', 'readwrite');
    await eliminaFotoDiSopralluogo(storeFoto, sopralluogoId);

    const storePdf = await transazione('pdf_report', 'readwrite');
    await richiesta(storePdf.delete(sopralluogoId));
  }

  /**
   * Elimina un sopralluogo e tutti i dati collegati (foto e, se presente, il PDF salvato),
   * per non lasciare record orfani in IndexedDB. Notifica js/sync.js, che propaga
   * l'eliminazione anche su Firestore.
   */
  async function eliminaSopralluogo(sopralluogoId) {
    await eliminaSopralluogoInterno(sopralluogoId);
    notificaCambiamento({ tipo: 'delete', sopralluogoId, aggiornato_il: new Date().toISOString() });
  }

  /**
   * Come eliminaSopralluogo, ma senza notificare js/sync.js: usata quando l'eliminazione
   * definitiva arriva DA Firestore (un altro dispositivo l'ha già eliminato), per non
   * rimandare a Firestore ciò che si è appena applicato da lì.
   */
  async function eliminaSopralluogoSenzaNotifica(sopralluogoId) {
    await eliminaSopralluogoInterno(sopralluogoId);
  }

  /** Salva/aggiorna un'impostazione (chiave/valore libero: dati azienda, logo, preferenze). */
  async function salvaImpostazione(chiave, valore) {
    const store = await transazione('impostazioni', 'readwrite');
    await richiesta(store.put({ chiave, valore }));
  }

  /** Legge un'impostazione per chiave. Ritorna undefined se non presente. */
  async function leggiImpostazione(chiave) {
    const store = await transazione('impostazioni', 'readonly');
    const record = await richiesta(store.get(chiave));
    return record ? record.valore : undefined;
  }

  /** Salva (o aggiorna) in cache locale una checklist JSON, per l'uso offline. */
  async function salvaChecklistCache(checklist) {
    const store = await transazione('checklists_cache', 'readwrite');
    await richiesta(store.put(checklist));
  }

  /** Legge una checklist dalla cache locale per id. Ritorna undefined se non presente. */
  async function leggiChecklistCache(checklistId) {
    const store = await transazione('checklists_cache', 'readonly');
    return richiesta(store.get(checklistId));
  }

  /** Elenca tutte le checklist presenti in cache locale. */
  async function elencaChecklistCache() {
    const store = await transazione('checklists_cache', 'readonly');
    return richiesta(store.getAll());
  }

  /**
   * Salva (o sovrascrive) il PDF già generato di un sopralluogo, per poterlo riaprire/scaricare
   * senza rigenerarlo. "generato_il" permette di confrontarlo con l'"aggiornato_il" del
   * sopralluogo (es. dopo una modifica ai soli dati anagrafici) per capire se il PDF salvato è
   * ancora aggiornato o andrebbe rigenerato (vedi riepilogoScreen in app.js).
   */
  async function salvaPdfReport({ sopralluogo_id, blob, filename }) {
    const store = await transazione('pdf_report', 'readwrite');
    await richiesta(store.put({ sopralluogo_id, blob, filename, generato_il: new Date().toISOString() }));
  }

  /** Legge il PDF salvato di un sopralluogo. Ritorna undefined se non è mai stato generato/salvato. */
  async function leggiPdfReport(sopralluogoId) {
    const store = await transazione('pdf_report', 'readonly');
    return richiesta(store.get(sopralluogoId));
  }

  return {
    creaSopralluogo,
    duplicaSopralluogo,
    salvaRisposta,
    impostaRisposte,
    aggiornaSopralluogo,
    chiudiSopralluogo,
    riapriSopralluogo,
    salvaFoto,
    leggiFoto,
    eliminaFoto,
    leggiSopralluogo,
    elencaSopralluoghi,
    elencaCestino,
    elencaTuttiSopralluoghi,
    applicaSopralluogoRemoto,
    spostaNelCestino,
    ripristinaSopralluogo,
    pulisciCestino,
    eliminaSopralluogo,
    eliminaSopralluogoSenzaNotifica,
    onCambiamento,
    salvaImpostazione,
    leggiImpostazione,
    salvaChecklistCache,
    leggiChecklistCache,
    elencaChecklistCache,
    salvaPdfReport,
    leggiPdfReport
  };
})();
