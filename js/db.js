/**
 * Wrapper Promise-based su IndexedDB per Safety Checklist.
 * Object store (PROJECT.md §6): sopralluoghi, foto, checklists_cache, impostazioni.
 */
const db = (() => {
  const DB_NAME = 'SafetyChecklistDB';
  const DB_VERSION = 1;

  let dbPromise = null;

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
    data_sopralluogo,
    responsabile_punto_vendita,
    presenza_responsabile,
    presenza_rls,
    checklist_id
  }) {
    const store = await transazione('sopralluoghi', 'readwrite');
    const sopralluogo = {
      id: generaId(),
      punto_vendita,
      indirizzo_punto_vendita,
      numero_dipendenti,
      tecnico,
      data_sopralluogo,
      responsabile_punto_vendita,
      presenza_responsabile,
      presenza_rls,
      checklist_id,
      data: new Date().toISOString(),
      stato: 'in corso',
      risposte: [],
      altri_aspetti: null
    };
    await richiesta(store.add(sopralluogo));
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

    await richiesta(store.put(sopralluogo));
    return sopralluogo;
  }

  /** Aggiorna campi di un sopralluogo esistente (es. stato: "completato", firma). */
  async function aggiornaSopralluogo(sopralluogoId, cambiamenti) {
    const store = await transazione('sopralluoghi', 'readwrite');
    const sopralluogo = await richiesta(store.get(sopralluogoId));
    if (!sopralluogo) {
      throw new Error(`Sopralluogo non trovato: ${sopralluogoId}`);
    }

    Object.assign(sopralluogo, cambiamenti);
    await richiesta(store.put(sopralluogo));
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

  /** Elenca tutti i sopralluoghi salvati, ordinati per data decrescente. */
  async function elencaSopralluoghi() {
    const store = await transazione('sopralluoghi', 'readonly');
    const tutti = await richiesta(store.getAll());
    return tutti.sort((a, b) => new Date(b.data) - new Date(a.data));
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

  return {
    creaSopralluogo,
    salvaRisposta,
    aggiornaSopralluogo,
    salvaFoto,
    leggiFoto,
    leggiSopralluogo,
    elencaSopralluoghi,
    salvaImpostazione,
    leggiImpostazione,
    salvaChecklistCache,
    leggiChecklistCache,
    elencaChecklistCache
  };
})();
