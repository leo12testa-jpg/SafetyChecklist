/**
 * Sincronizzazione multi-dispositivo dei sopralluoghi via Firestore (solo dati testuali:
 * le foto restano esclusivamente in IndexedDB locale, non vengono mai caricate).
 *
 * IndexedDB locale (db.js) resta la fonte di verità per l'uso offline dell'app: questo modulo
 * è un livello aggiuntivo "best effort" che, quando online, mantiene la collection Firestore
 * "sopralluoghi" allineata ai dati locali (e viceversa). Nessuna chiamata qui blocca mai l'uso
 * dell'app: ogni errore (rete assente, permessi Firestore, progetto non raggiungibile) viene
 * intercettato e loggato in console, mai mostrato all'utente.
 *
 * Conflitti fra dispositivi risolti con last-write-wins sul campo "aggiornato_il" (timestamp
 * ISO impostato da db.js a ogni mutazione locale).
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

  /** Inizializza l'SDK Firebase (compat) al primo utilizzo. Ritorna null se non disponibile. */
  function inizializzaFirebase() {
    if (firestoreDb) {
      return firestoreDb;
    }
    if (typeof firebase === 'undefined' || typeof firebaseConfig === 'undefined') {
      console.warn('Sync: SDK Firebase o firebase-config.js non caricati, sincronizzazione disabilitata.');
      return null;
    }
    if (!firebase.apps.length) {
      firebase.initializeApp(firebaseConfig);
    }
    firestoreDb = firebase.firestore();
    return firestoreDb;
  }

  function impostaStato(nuovo) {
    if (statoAttuale === nuovo) {
      return;
    }
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

  /** Rimuove eventuali campi non previsti su Firestore (per sicurezza: le foto non ci finiscono mai qui). */
  function pulisciPerFirestore(sopralluogo) {
    const { foto, ...resto } = sopralluogo;
    return resto;
  }

  function timestampDi(sopralluogo) {
    return new Date(sopralluogo.aggiornato_il || sopralluogo.data || 0).getTime();
  }

  /** Carica su Firestore un singolo sopralluogo (upsert per id). Silenzioso se offline o in errore. */
  async function pushSopralluogo(sopralluogo) {
    const fdb = inizializzaFirebase();
    if (!fdb || !online()) {
      return;
    }
    try {
      await fdb.collection(COLLECTION).doc(sopralluogo.id).set(pulisciPerFirestore(sopralluogo));
    } catch (errore) {
      console.warn('Sync: impossibile caricare su Firestore il sopralluogo', sopralluogo.id, errore);
    }
  }

  /**
   * Propaga su Firestore l'eliminazione definitiva di un sopralluogo. Scrive una "tomba"
   * (eliminato_definitivamente: true) invece di cancellare il documento: se lo cancellassimo,
   * un dispositivo che non ha ancora visto l'eliminazione e più tardi fa un giro di
   * sincronizzazione completa vedrebbe "il locale c'è, il remoto non c'è" e lo ricaricherebbe
   * per errore, facendolo risorgere per tutti. La tomba resta confrontabile con aggiornato_il
   * come una normale versione del documento (vince comunque la più recente).
   */
  async function eliminaSuFirestore(sopralluogoId, aggiornatoIl) {
    const fdb = inizializzaFirebase();
    if (!fdb || !online()) {
      return;
    }
    try {
      await fdb.collection(COLLECTION).doc(sopralluogoId).set({
        eliminato_definitivamente: true,
        aggiornato_il: aggiornatoIl || new Date().toISOString()
      });
    } catch (errore) {
      console.warn('Sync: impossibile eliminare su Firestore il sopralluogo', sopralluogoId, errore);
    }
  }

  /** Reagisce a ogni mutazione locale notificata da db.js (vedi db.onCambiamento). */
  function alCambiamentoLocale(evento) {
    if (evento.tipo === 'upsert') {
      pushSopralluogo(evento.sopralluogo);
    } else if (evento.tipo === 'delete') {
      eliminaSuFirestore(evento.sopralluogoId, evento.aggiornato_il);
    }
  }

  /**
   * Sincronizzazione bidirezionale completa: confronta tutti i sopralluoghi locali con tutti
   * quelli remoti e, per ogni id, propaga la versione più recente (o quella mancante) nella
   * direzione opposta. Chiamata all'avvio dell'app e al ritorno della connessione.
   */
  async function sincronizzaTutto() {
    const fdb = inizializzaFirebase();
    if (!fdb || !online()) {
      impostaStato('offline');
      return;
    }

    impostaStato('sincronizzando');

    try {
      const [locali, snapshotRemoto] = await Promise.all([
        db.elencaTuttiSopralluoghi(),
        fdb.collection(COLLECTION).get()
      ]);

      const localiPerId = new Map(locali.map((s) => [s.id, s]));
      const remotiPerId = new Map();
      snapshotRemoto.forEach((doc) => remotiPerId.set(doc.id, { id: doc.id, ...doc.data() }));

      const daCaricare = [];
      const daScaricare = [];
      const daEliminareLocalmente = [];

      const tuttiId = new Set([...localiPerId.keys(), ...remotiPerId.keys()]);
      tuttiId.forEach((id) => {
        const locale = localiPerId.get(id);
        const remoto = remotiPerId.get(id);
        const remotoEUnaTomba = !!(remoto && remoto.eliminato_definitivamente);

        if (locale && !remoto) {
          daCaricare.push(locale);
        } else if (!locale && remoto) {
          // Una tomba senza il corrispondente locale significa che entrambi i lati sono già
          // d'accordo che il sopralluogo è stato eliminato: nulla da scaricare.
          if (!remotoEUnaTomba) {
            daScaricare.push(remoto);
          }
        } else if (timestampDi(locale) > timestampDi(remoto)) {
          daCaricare.push(locale);
        } else if (timestampDi(remoto) > timestampDi(locale)) {
          if (remotoEUnaTomba) {
            daEliminareLocalmente.push(id);
          } else {
            daScaricare.push(remoto);
          }
        }
      });

      await Promise.all(daCaricare.map((s) => pushSopralluogo(s)));
      await Promise.all(daScaricare.map((s) => db.applicaSopralluogoRemoto(s)));
      await Promise.all(daEliminareLocalmente.map((id) => db.eliminaSopralluogoSenzaNotifica(id)));

      if (daScaricare.length > 0 || daEliminareLocalmente.length > 0) {
        notificaDatiAggiornati();
      }

      impostaStato('sincronizzato');
    } catch (errore) {
      console.warn('Sync: sincronizzazione completa fallita, resta valido lo stato locale', errore);
      impostaStato('offline');
    }
  }

  function init() {
    db.onCambiamento(alCambiamentoLocale);

    window.addEventListener('online', sincronizzaTutto);
    window.addEventListener('offline', () => impostaStato('offline'));

    if (online()) {
      sincronizzaTutto();
    } else {
      impostaStato('offline');
    }
  }

  return {
    init,
    sincronizzaTutto,
    onCambioStato,
    onDatiAggiornati,
    statoAttuale: () => statoAttuale
  };
})();
