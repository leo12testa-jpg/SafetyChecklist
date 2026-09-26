/**
 * Local-first synchronization: IndexedDB commits before any cloud request. Firestore is
 * the live transport, Supabase stores photo blobs. Missing remote documents are uploaded,
 * never interpreted as a deletion. Transactions merge individual questions, photo IDs and
 * timestamped metadata; snapshot application does not emit local mutation notifications.
 */
const sync = (() => {
  const COLLECTION = 'sopralluoghi';

  let firestoreDb = null;
  let statoAttuale = 'offline';
  const listenerStato = [];
  const listenerDatiAggiornati = [];

  function online() {
    return navigator.onLine;
  }

  /** Riusa l'unica istanza Firestore preparata da firebase-config.js prima di Auth. */
  function inizializzaFirebase() {
    if (firestoreDb) return firestoreDb;
    if (typeof firebase === 'undefined' || typeof firebaseConfig === 'undefined') {
      console.warn('Sync: SDK Firebase o firebase-config.js non caricati, sincronizzazione disabilitata.');
      return null;
    }
    if (typeof firebaseClient !== 'undefined' && firebaseClient?.firestore) {
      firestoreDb = firebaseClient.firestore();
      return firestoreDb;
    }
    // Fallback solo per harness/test isolati che caricano sync.js senza firebase-config.js.
    if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
    firestoreDb = firebase.firestore();
    return firestoreDb;
  }

  function impostaStato(nuovo) {
    statoAttuale = nuovo;
    listenerStato.forEach((callback) => callback(statoAttuale));
  }

  function onCambioStato(callback) {
    listenerStato.push(callback);
  }

  function onDatiAggiornati(callback) {
    listenerDatiAggiornati.push(callback);
  }

  function notificaDatiAggiornati() {
    listenerDatiAggiornati.forEach((callback) => callback());
  }

  function timestampDi(sopralluogo) {
    return new Date(sopralluogo.aggiornato_il || sopralluogo.data || 0).getTime() || 0;
  }

  // --- Funzioni pure di conversione/merge (nessuna chiamata a IndexedDB/Firestore: testabili in isolamento) ---

  /**
   * Converte "risposte" nel formato mappa domanda_id -> risposta usato per il confronto/merge.
   * Il formato locale atteso è un Array (IndexedDB, vedi db.js), ma alcuni sopralluoghi scaricati
   * da Firestore per la prima volta (db.applicaSopralluogoRemoto, che salva il record così com'è)
   * finiscono con "risposte" già in formato mappa: qui si accetta anche quel caso, riusando le
   * chiavi (domanda_id) così come sono invece di ricostruirle con Object.values, per non perdere
   * l'associazione domanda_id se una risposta ne fosse priva. null/undefined diventano mappa
   * vuota; un tipo realmente inatteso viene segnalato (console.warn) e trattato come vuoto, senza
   * interrompere la sincronizzazione.
   */
  function arrayRisposteInMappa(risposte) {
    if (risposte == null) {
      return {};
    }
    if (Array.isArray(risposte)) {
      const mappa = {};
      risposte.forEach((risposta) => {
        mappa[risposta.domanda_id] = risposta;
      });
      return mappa;
    }
    if (typeof risposte === 'object') {
      return { ...risposte };
    }
    console.warn('Sync: formato "risposte" inatteso, ignorato:', typeof risposte, risposte);
    return {};
  }

  function mappaRisposteInArray(risposteMappa) {
    return Object.values(risposteMappa || {});
  }

  function timestampRisposta(risposta, fallback) {
    if (!risposta) {
      return -Infinity;
    }
    const t = risposta.aggiornato_il ? Date.parse(risposta.aggiornato_il) : NaN;
    return Number.isNaN(t) ? fallback : t;
  }

  /**
   * Unisce le risposte locali (array, formato IndexedDB) con quelle remote (mappa domanda_id ->
   * risposta, formato Firestore) domanda per domanda: le domande presenti da un solo lato si
   * tengono comunque, quelle presenti da entrambi i lati sono decise dal "aggiornato_il" più
   * recente della singola risposta ("fallbackLocale"/"fallbackRemoto" coprono le risposte
   * pre-esistenti a questa modifica, senza ancora un aggiornato_il proprio: trattate come vecchie
   * quanto il documento — locale o remoto — che le conteneva).
   *
   * Ritorna { array, daScrivereRemoto, cambiatoLocale }: "array" è l'elenco unito nel formato
   * locale; "daScrivereRemoto" è la (sola) mappa delle voci dove ha vinto il lato locale con un
   * valore diverso da quello remoto attuale (da scrivere su Firestore); "cambiatoLocale" indica
   * se il locale ha bisogno di essere aggiornato con "array".
   */
  function unisciRisposte(risposteLocaliArray, risposteRemoteMappa, fallbackLocale, fallbackRemoto) {
    const localiMappa = arrayRisposteInMappa(risposteLocaliArray);
    const remoteMappa = arrayRisposteInMappa(risposteRemoteMappa);
    const tuttiId = new Set([...Object.keys(localiMappa), ...Object.keys(remoteMappa)]);

    const mappaUnita = {};
    const daScrivereRemoto = {};
    let cambiatoLocale = false;

    tuttiId.forEach((id) => {
      const loc = localiMappa[id];
      const rem = remoteMappa[id];

      if (loc && !rem) {
        mappaUnita[id] = loc;
        daScrivereRemoto[id] = loc;
        return;
      }
      if (!loc && rem) {
        mappaUnita[id] = rem;
        cambiatoLocale = true;
        return;
      }

      const tsLoc = timestampRisposta(loc, fallbackLocale);
      const tsRem = timestampRisposta(rem, fallbackRemoto);
      if (tsLoc > tsRem || (tsLoc === tsRem && stabile(loc) >= stabile(rem))) {
        mappaUnita[id] = loc;
        if (stabile(loc) !== stabile(rem)) {
          daScrivereRemoto[id] = loc;
        }
      } else {
        mappaUnita[id] = rem;
        cambiatoLocale = true;
      }
    });

    return { array: mappaRisposteInArray(mappaUnita), daScrivereRemoto, cambiatoLocale };
  }

  /**
   * Unisce foto_url locale e remoto (mappa fotoId -> {url, path}) per semplice unione delle
   * chiavi: a differenza delle risposte, non serve un confronto per timestamp perché ogni fotoId
   * è generato localmente (crypto.randomUUID, vedi db.salvaFoto) e non può mai collidere fra due
   * dispositivi diversi.
   */
  function unisciFotoUrl(fotoUrlLocale, fotoUrlRemoto) {
    const locale = fotoUrlLocale || {};
    const remoto = fotoUrlRemoto || {};
    const mappa = { ...remoto, ...locale };

    const daScrivereRemoto = {};
    Object.keys(locale).forEach((id) => {
      if (!(id in remoto)) {
        daScrivereRemoto[id] = locale[id];
      }
    });

    let cambiatoLocale = false;
    Object.keys(remoto).forEach((id) => {
      if (!(id in locale)) {
        cambiatoLocale = true;
      }
    });

    return { mappa, daScrivereRemoto, cambiatoLocale };
  }

  /** Campi "whole-value" di un sopralluogo (tutto tranne risposte/foto_url, gestiti a parte con un merge per chiave, e foto, mai presente su Firestore). */
  function estraiMetadati(sopralluogo) {
    const { foto, risposte, foto_url, ...resto } = sopralluogo;
    return resto;
  }

  // Stable comparison also makes equal-timestamp conflicts converge on every device.
  function stabile(value) {
    if (Array.isArray(value)) return '[' + value.map(stabile).join(',') + ']';
    if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + stabile(value[k])).join(',') + '}';
    return JSON.stringify(value);
  }

  function unisciDocumenti(locale, remoto) {
    if (!locale) return { ...remoto, risposte: mappaRisposteInArray(arrayRisposteInMappa(remoto.risposte)) };
    if (!remoto) return { ...locale };
    const risultato = { ...locale };
    const tempi = { ...(locale.campi_aggiornati || {}) };
    const esclusi = new Set(['foto', 'risposte', 'foto_url', 'campi_aggiornati', '_sync_rev']);
    for (const k of new Set([...Object.keys(locale), ...Object.keys(remoto)])) {
      if (esclusi.has(k)) continue;
      const tl = Date.parse(locale.campi_aggiornati?.[k] || locale.aggiornato_il || locale.data) || 0;
      const tr = Date.parse(remoto.campi_aggiornati?.[k] || remoto.aggiornato_il || remoto.data) || 0;
      if (k in remoto && (!(k in locale) || tr > tl || (tr === tl && stabile(remoto[k]) > stabile(locale[k])))) {
        risultato[k] = remoto[k];
        tempi[k] = remoto.campi_aggiornati?.[k] || remoto.aggiornato_il || remoto.data || new Date(0).toISOString();
      } else if (k in locale) {
        tempi[k] = locale.campi_aggiornati?.[k] || locale.aggiornato_il || locale.data || new Date(0).toISOString();
      }
    }
    risultato.campi_aggiornati = tempi;
    const risposteConTempi = s => Object.fromEntries(Object.entries(arrayRisposteInMappa(s.risposte)).map(([id, r]) => [id, {
      ...r, domanda_id: r.domanda_id ?? (Number.isNaN(Number(id)) ? id : Number(id)),
      aggiornato_il: r.aggiornato_il || s.aggiornato_il || s.data || new Date(0).toISOString()
    }]));
    risultato.risposte = unisciRisposte(risposteConTempi(locale), risposteConTempi(remoto), 0, 0).array;
    risultato.foto_url = unisciFotoUrl(locale.foto_url, remoto.foto_url).mappa;
    return risultato;
  }

  function datiCloud(s) {
    const { foto, _sync_rev, ...record } = s;
    return JSON.parse(JSON.stringify({ ...record, risposte: arrayRisposteInMappa(s.risposte) }));
  }

  // Exact per-question fields: never replace the complete answers/photos map.
  function differenze(unito, remoto) {
    const patch = {}, campi = [];
    for (const [k, v] of Object.entries(datiCloud(unito))) {
      if (['risposte', 'foto_url', 'campi_aggiornati'].includes(k)) {
        for (const [id, valore] of Object.entries(v || {})) {
          if (stabile(valore) === stabile(remoto?.[k]?.[id])) continue;
          (patch[k] ||= {})[id] = valore;
          campi.push(new firebase.firestore.FieldPath(k, id));
        }
      } else if (stabile(v) !== stabile(remoto?.[k])) {
        patch[k] = v;
        campi.push(new firebase.firestore.FieldPath(k));
      }
    }
    return { patch, campi };
  }

  let sincronizzazioneInCorso = null;
  let completoInCorso = null;
  let unsubscribe = null;
  let inizializzato = false;
  let datiVerificati = false;
  let attesaFoto = 0;
  let erroreDati = false;
  let retry = null;
  const pendenti = new Map();
  const invii = new Map();
  let codaSnapshot = Promise.resolve();

  function elementiInAttesa() { return pendenti.size + attesaFoto + (erroreDati ? 1 : 0); }
  function aggiornaStato() {
    impostaStato(!online() ? 'offline' : completoInCorso || sincronizzazioneInCorso || invii.size ? 'sincronizzando'
      : elementiInAttesa() || !datiVerificati ? 'parziale' : 'sincronizzato');
  }
  function riprovaDopo() {
    if (retry || !online()) return;
    retry = setTimeout(() => { retry = null; sincronizzaCompleto(); }, 15000);
  }
  function conScadenza(promise, ms = 12000) {
    let timer;
    return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Timeout sincronizzazione')), ms); })]).finally(() => clearTimeout(timer));
  }

  async function applicaRemoto(remoto) {
    // Read + conservative merge + put share one IDB transaction, including concurrent edits.
    const esito = await db.unisciSopralluogoRemoto(remoto, unisciDocumenti);
    if (esito.cambiato) notificaDatiAggiornati();
    return esito.record;
  }

  function invia(id) {
    if (invii.has(id)) return invii.get(id);
    if (!online() || !inizializzaFirebase()) { aggiornaStato(); return Promise.resolve(false); }
    const lavoro = (async () => {
      try {
        let ancora;
        do {
          const locale = await db.leggiSopralluogo(id);
          if (!locale) return true;
          const rev = locale._sync_rev;
          const ref = firestoreDb.collection(COLLECTION).doc(id);
          const unito = await conScadenza(firestoreDb.runTransaction(async tx => {
            const snap = await tx.get(ref);
            const remoto = snap.exists ? { ...snap.data(), id } : null;
            const record = unisciDocumenti(locale, remoto);
            const { patch, campi } = differenze(record, remoto);
            if (campi.length) tx.set(ref, patch, { mergeFields: campi });
            return record;
          }));
          await applicaRemoto(unito);
          await db.confermaSincronizzato(id, rev);
          const attuale = await db.leggiSopralluogo(id);
          ancora = !!attuale?._sync_rev;
          if (!ancora) pendenti.delete(id);
        } while (ancora && online());
        return !ancora;
      } catch (errore) {
        pendenti.set(id, true);
        console.warn('Sync: dati conservati sul dispositivo, invio da ritentare', id, errore);
        riprovaDopo();
        return false;
      }
    })();
    invii.set(id, lavoro);
    aggiornaStato();
    lavoro.then(ok => {
      invii.delete(id); aggiornaStato();
      if (ok && pendenti.has(id)) invia(id);
    });
    return lavoro;
  }

  function alCambiamentoLocale(evento) {
    const id = evento.sopralluogoId || evento.sopralluogo?.id;
    if (!id) return;
    pendenti.set(id, true);
    invia(id);
  }

  // Server documents as last delivered by the live listener. While it is aligned, a full sync
  // reuses it instead of re-reading the whole collection on every focus/visibility change.
  const remotiRealtime = new Map();
  let realtimeAllineato = false;

  function fermaRealtime() {
    if (unsubscribe) unsubscribe();
    unsubscribe = null;
    realtimeAllineato = false;
    remotiRealtime.clear();
  }

  function avviaRealtime() {
    if (unsubscribe || !online()) return;
    const fdb = inizializzaFirebase();
    if (!fdb) return;
    unsubscribe = fdb.collection(COLLECTION).onSnapshot({ includeMetadataChanges: true }, snapshot => {
      // docChanges() is relative to the previous snapshot: skipping a whole snapshot would lose
      // its remote changes. Every change is applied (the merge is idempotent); only the
      // "aligned with the server" flag waits for a snapshot that is not served from cache.
      const cambi = snapshot.docChanges();
      const daServer = !snapshot.metadata.fromCache;
      codaSnapshot = codaSnapshot.then(async () => {
        for (const change of cambi) {
          const id = change.doc.id;
          // Absence/removal on the server NEVER deletes a local inspection: it is re-uploaded.
          if (change.type === 'removed') {
            remotiRealtime.delete(id);
            const locale = await db.leggiSopralluogo(id);
            if (locale) { pendenti.set(locale.id, true); invia(locale.id); }
            continue;
          }
          const remoto = { ...change.doc.data(), id };
          remotiRealtime.set(id, remoto);
          await applicaRemoto(remoto);
        }
        if (daServer && !realtimeAllineato) {
          realtimeAllineato = true;
          // First aligned snapshot: upload anything local the server does not have yet.
          const locali = await db.elencaTuttiSopralluoghi();
          for (const locale of locali) {
            if (locale._sync_rev || !remotiRealtime.has(locale.id)) { pendenti.set(locale.id, true); invia(locale.id); }
          }
        }
        aggiornaStato();
      }).catch(errore => { erroreDati = true; aggiornaStato(); riprovaDopo(); console.warn('Sync snapshot', errore); });
    }, errore => {
      fermaRealtime();
      erroreDati = true;
      aggiornaStato();
      riprovaDopo();
      console.warn('Sync realtime da riconnettere', errore);
    });
  }

  /**
   * verificaServer=false only for the second pass inside sincronizzaCompleto: every explicit
   * trigger re-reads the server, so a silently stalled listener can never hide a document
   * that disappeared from Firestore (it is re-uploaded).
   */
  function sincronizzaTutto({ verificaServer = true } = {}) {
    if (sincronizzazioneInCorso) return sincronizzazioneInCorso;
    sincronizzazioneInCorso = (async () => {
      if (!online() || !inizializzaFirebase()) { datiVerificati = false; return false; }
      try {
        // ALL local records first, including legacy entries and the trash.
        const locali = await db.elencaTuttiSopralluoghi();
        locali.filter(s => s._sync_rev).forEach(s => pendenti.set(s.id, true));
        let remoti, nonApplicati = 0;
        if (!verificaServer && realtimeAllineato && unsubscribe) {
          // The listener already applied every server document it delivered.
          await codaSnapshot;
          remoti = new Map(remotiRealtime);
        } else {
          const snapshot = await conScadenza(firestoreDb.collection(COLLECTION).get({ source: 'server' }));
          remoti = new Map();
          snapshot.forEach(doc => remoti.set(doc.id, { ...doc.data(), id: doc.id }));
          // One malformed remote document must never prevent local records from uploading.
          for (const remoto of remoti.values()) {
            try { await applicaRemoto(remoto); } catch (errore) { nonApplicati++; console.warn('Sync: documento remoto non applicato', remoto.id, errore); }
          }
        }
        const esiti = [];
        for (const locale of locali) {
          try {
            const corrente = await db.leggiSopralluogo(locale.id);
            if (corrente && (!remoti.has(locale.id) || corrente._sync_rev || differenze(corrente, remoti.get(locale.id)).campi.length)) {
              pendenti.set(locale.id, true);
              esiti.push(invia(locale.id));
              if (esiti.length % 8 === 0) await Promise.all(esiti);
            }
          } catch (errore) {
            // Never skip the remaining records; this one stays pending and is retried.
            pendenti.set(locale.id, true);
            esiti.push(Promise.resolve(false));
            console.warn('Sync: confronto locale/cloud non riuscito, record conservato', locale.id, errore);
          }
        }
        datiVerificati = true;
        erroreDati = nonApplicati > 0;
        avviaRealtime();
        return (await Promise.all(esiti)).every(Boolean) && !nonApplicati;
      } catch (errore) {
        erroreDati = true;
        console.warn('Sync: cloud non disponibile, dati locali conservati', errore);
        riprovaDopo();
        return false;
      }
    })().finally(() => { sincronizzazioneInCorso = null; aggiornaStato(); });
    aggiornaStato();
    return sincronizzazioneInCorso;
  }

  function sincronizzaCompleto() {
    if (completoInCorso) return completoInCorso;
    completoInCorso = (async () => {
      const primo = await sincronizzaTutto();
      if (typeof fotoSync !== 'undefined') await conScadenza(fotoSync.riprovaInSospeso());
      const secondo = await sincronizzaTutto({ verificaServer: false });
      if (typeof fotoSync !== 'undefined') await conScadenza(fotoSync.recuperaFotoMancanti());
      attesaFoto = (await db.elencaFotoSenzaUrl()).length;
      return primo && secondo && !elementiInAttesa();
    })().catch(errore => {
      erroreDati = true;
      console.warn('Sync parziale, dati locali conservati', errore);
      return false;
    }).finally(() => {
      completoInCorso = null;
      aggiornaStato();
      if (elementiInAttesa()) riprovaDopo();
    });
    aggiornaStato();
    return completoInCorso;
  }

  function init() {
    if (inizializzato) return sincronizzaCompleto();
    inizializzato = true;
    db.onCambiamento(alCambiamentoLocale);
    const riprendi = () => { avviaRealtime(); sincronizzaCompleto(); };
    window.addEventListener('online', riprendi);
    window.addEventListener('offline', () => {
      fermaRealtime();
      aggiornaStato();
    });
    window.addEventListener('focus', riprendi);
    window.addEventListener('pagehide', () => {
      fermaRealtime();
      // Close the streaming channel before iOS/WebKit suspends or replaces the document.
      if (firestoreDb) firestoreDb.disableNetwork().catch(() => {});
    });
    window.addEventListener('pageshow', event => {
      if (event.persisted && firestoreDb) firestoreDb.enableNetwork().then(riprendi).catch(() => riprovaDopo());
    });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') riprendi(); });
    if (typeof fotoSync !== 'undefined') fotoSync.onCambioStato(async () => {
      attesaFoto = (await db.elencaFotoSenzaUrl()).length;
      aggiornaStato();
      if (attesaFoto) riprovaDopo();
    });
    return sincronizzaCompleto();
  }

  return {
    init, sincronizzaTutto, sincronizzaCompleto, onCambioStato, onDatiAggiornati,
    elementiInAttesa, statoAttuale: () => statoAttuale,
    _test: { arrayRisposteInMappa, mappaRisposteInArray, unisciRisposte, unisciFotoUrl, estraiMetadati, timestampDi, unisciDocumenti, stabile }
  };
})();
