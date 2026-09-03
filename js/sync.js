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
 * Compilazione concorrente: "risposte" e "foto_url" NON sono mai sovrascritti come blocco unico.
 * Su Firestore "risposte" è una mappa domanda_id -> risposta (mentre in locale, in IndexedDB,
 * resta un array, per non toccare tutto il resto dell'app): ogni risposta viaggia da sola con un
 * write a singola chiave ("risposte.<domanda_id>", vedi pushRisposta), e "foto_url" allo stesso
 * modo per singolo fotoId (pushFotoUrl). Così due tecnici che rispondono a domande diverse dello
 * stesso sopralluogo, anche in contemporanea, non si sovrascrivono a vicenda. Il caso limite di
 * due risposte alla STESSA domanda è risolto last-write-wins sul "aggiornato_il" di quella
 * singola risposta (non più su quello dell'intero documento). I campi anagrafici e "Altri
 * aspetti" restano invece whole-value last-write-wins sul "aggiornato_il" dell'intero documento,
 * come prima: sono singoli valori condivisi, il rischio di conflitto è basso.
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

  function timestampDi(sopralluogo) {
    return new Date(sopralluogo.aggiornato_il || sopralluogo.data || 0).getTime();
  }

  // --- Funzioni pure di conversione/merge (nessuna chiamata a IndexedDB/Firestore: testabili in isolamento) ---

  function arrayRisposteInMappa(risposteArray) {
    const mappa = {};
    (risposteArray || []).forEach((risposta) => {
      mappa[risposta.domanda_id] = risposta;
    });
    return mappa;
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
    const remoteMappa = risposteRemoteMappa || {};
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
      if (tsLoc >= tsRem) {
        mappaUnita[id] = loc;
        if (JSON.stringify(loc) !== JSON.stringify(rem)) {
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

  // --- Scritture su Firestore ---

  /** Carica su Firestore l'intero sopralluogo (creazione, duplicazione, import PDF): merge:true così non cancella mai risposte/foto_url scritti nel frattempo da un altro dispositivo su un documento già esistente. */
  async function pushSopralluogoCompleto(sopralluogo) {
    const fdb = inizializzaFirebase();
    if (!fdb || !online()) {
      return;
    }
    try {
      await fdb.collection(COLLECTION).doc(sopralluogo.id).set({
        ...estraiMetadati(sopralluogo),
        risposte: arrayRisposteInMappa(sopralluogo.risposte),
        foto_url: sopralluogo.foto_url || {}
      }, { merge: true });
    } catch (errore) {
      console.warn('Sync: impossibile caricare su Firestore il sopralluogo', sopralluogo.id, errore);
    }
  }

  /** Carica su Firestore solo i campi anagrafici/stato/altri_aspetti (mai risposte/foto_url). */
  async function pushMetadati(sopralluogo) {
    const fdb = inizializzaFirebase();
    if (!fdb || !online()) {
      return;
    }
    try {
      await fdb.collection(COLLECTION).doc(sopralluogo.id).set(estraiMetadati(sopralluogo), { merge: true });
    } catch (errore) {
      console.warn('Sync: impossibile caricare su Firestore i metadati del sopralluogo', sopralluogo.id, errore);
    }
  }

  /** Carica su Firestore SOLO la singola risposta appena salvata, senza toccare le altre. */
  async function pushRisposta(sopralluogoId, risposta, aggiornatoIl) {
    const fdb = inizializzaFirebase();
    if (!fdb || !online()) {
      return;
    }
    try {
      await fdb.collection(COLLECTION).doc(sopralluogoId).set({
        risposte: { [risposta.domanda_id]: risposta },
        aggiornato_il: aggiornatoIl
      }, { merge: true });
    } catch (errore) {
      console.warn('Sync: impossibile caricare su Firestore la risposta', sopralluogoId, risposta.domanda_id, errore);
    }
  }

  /** Carica su Firestore SOLO il fotoId appena caricato su Supabase, senza toccare gli altri. */
  async function pushFotoUrl(sopralluogoId, fotoId, valore, aggiornatoIl) {
    const fdb = inizializzaFirebase();
    if (!fdb || !online()) {
      return;
    }
    try {
      await fdb.collection(COLLECTION).doc(sopralluogoId).set({
        foto_url: { [fotoId]: valore },
        aggiornato_il: aggiornatoIl
      }, { merge: true });
    } catch (errore) {
      console.warn('Sync: impossibile caricare su Firestore foto_url', sopralluogoId, fotoId, errore);
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
      pushSopralluogoCompleto(evento.sopralluogo);
    } else if (evento.tipo === 'upsert-metadati') {
      pushMetadati(evento.sopralluogo);
    } else if (evento.tipo === 'upsert-risposta') {
      pushRisposta(evento.sopralluogoId, evento.risposta, evento.aggiornato_il);
    } else if (evento.tipo === 'upsert-fotourl') {
      pushFotoUrl(evento.sopralluogoId, evento.fotoId, evento.valore, evento.aggiornato_il);
    } else if (evento.tipo === 'delete') {
      eliminaSuFirestore(evento.sopralluogoId, evento.aggiornato_il);
    }
  }

  /**
   * Riconcilia un sopralluogo presente sia in locale che da remoto (non una tomba): unisce
   * risposte e foto_url per chiave (mai un lato "vince" in blocco), poi decide la direzione dei
   * soli metadati con il confronto whole-doc di sempre. Applica in locale solo il patch
   * risultante (mai un put cieco dell'intero record remoto) e scrive su Firestore solo le chiavi
   * effettivamente cambiate. Ritorna true se il locale è stato modificato (serve a chi chiama per
   * sapere se notificare la UI).
   */
  async function unisciEPropaga(fdb, id, locale, remoto) {
    const risultatoRisposte = unisciRisposte(locale.risposte, remoto.risposte, timestampDi(locale), timestampDi(remoto));
    const risultatoFoto = unisciFotoUrl(locale.foto_url, remoto.foto_url);

    const patchLocale = {};
    const payloadRemoto = {};

    if (risultatoRisposte.cambiatoLocale) {
      patchLocale.risposte = risultatoRisposte.array;
    }
    if (Object.keys(risultatoRisposte.daScrivereRemoto).length > 0) {
      payloadRemoto.risposte = risultatoRisposte.daScrivereRemoto;
    }

    if (risultatoFoto.cambiatoLocale) {
      patchLocale.foto_url = risultatoFoto.mappa;
    }
    if (Object.keys(risultatoFoto.daScrivereRemoto).length > 0) {
      payloadRemoto.foto_url = risultatoFoto.daScrivereRemoto;
    }

    if (timestampDi(locale) > timestampDi(remoto)) {
      Object.assign(payloadRemoto, estraiMetadati(locale));
    } else if (timestampDi(remoto) > timestampDi(locale)) {
      Object.assign(patchLocale, estraiMetadati(remoto));
    }

    const attese = [];
    if (Object.keys(payloadRemoto).length > 0) {
      attese.push(
        fdb.collection(COLLECTION).doc(id).set(payloadRemoto, { merge: true }).catch((errore) => {
          console.warn('Sync: impossibile propagare il merge su Firestore per il sopralluogo', id, errore);
        })
      );
    }

    let localeCambiato = false;
    if (Object.keys(patchLocale).length > 0) {
      localeCambiato = true;
      attese.push(db.applicaMergeSopralluogoRemoto(id, patchLocale));
    }

    await Promise.all(attese);
    return localeCambiato;
  }

  /**
   * Sincronizzazione bidirezionale completa: confronta tutti i sopralluoghi locali con tutti
   * quelli remoti. Per i sopralluoghi mancanti da un lato (o con una tomba di eliminazione) si
   * comporta come prima (copia/elimina l'intero record, non c'è alcun conflitto possibile). Per i
   * sopralluoghi presenti su entrambi i lati, invece di scegliere un vincitore per l'intero
   * documento, unisce risposte e foto_url per chiave (vedi unisciEPropaga) — così due dispositivi
   * che hanno risposto a domande diverse nel frattempo non si cancellano più a vicenda. Chiamata
   * all'avvio dell'app, al ritorno della connessione/visibilità della pagina. Ritorna true/false
   * (riuscita o no): app.js usa questo esito per decidere se è sicuro far girare
   * db.pulisciCestino() nello stesso avvio (mai su dati locali potenzialmente incompleti).
   */
  async function sincronizzaTutto() {
    const fdb = inizializzaFirebase();
    if (!fdb || !online()) {
      impostaStato('offline');
      return false;
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
      const daUnire = [];

      const tuttiId = new Set([...localiPerId.keys(), ...remotiPerId.keys()]);
      tuttiId.forEach((id) => {
        const locale = localiPerId.get(id);
        const remoto = remotiPerId.get(id);
        const remotoEUnaTomba = !!(remoto && remoto.eliminato_definitivamente);

        if (locale && !remoto) {
          daCaricare.push(locale);
          return;
        }
        if (!locale && remoto) {
          if (!remotoEUnaTomba) {
            daScaricare.push(remoto);
          }
          return;
        }
        // Da qui: sia locale che remoto esistono.
        if (remotoEUnaTomba) {
          if (timestampDi(locale) > timestampDi(remoto)) {
            daCaricare.push(locale);
          } else if (timestampDi(remoto) > timestampDi(locale)) {
            daEliminareLocalmente.push(id);
          }
          return;
        }
        daUnire.push({ id, locale, remoto });
      });

      await Promise.all(daCaricare.map((s) => pushSopralluogoCompleto(s)));
      await Promise.all(daScaricare.map((s) => db.applicaSopralluogoRemoto(s)));
      await Promise.all(daEliminareLocalmente.map((id) => db.eliminaSopralluogoSenzaNotifica(id)));
      const esitiUnione = await Promise.all(daUnire.map(({ id, locale, remoto }) => unisciEPropaga(fdb, id, locale, remoto)));

      const localeCambiato = esitiUnione.some(Boolean);
      if (daScaricare.length > 0 || daEliminareLocalmente.length > 0 || localeCambiato) {
        notificaDatiAggiornati();
      }

      impostaStato('sincronizzato');
      return true;
    } catch (errore) {
      console.warn('Sync: sincronizzazione completa fallita, resta valido lo stato locale', errore);
      impostaStato('offline');
      return false;
    }
  }

  /**
   * Ritorna una Promise<boolean> che si risolve con l'esito della sincronizzazione iniziale
   * (true = riuscita, false = offline o fallita): chi chiama init() può fare `await` per sapere
   * quando è sicuro far girare operazioni che presuppongono dati locali aggiornati (es.
   * db.pulisciCestino() in app.js), senza dover duplicare la logica online()/sincronizzaTutto().
   * Le sincronizzazioni successive (al ritorno della connessione, al tornare visibile/attiva la
   * pagina) restano fire-and-forget: sono l'unico modo con cui questo dispositivo scopre le
   * modifiche fatte nel frattempo da un altro (nessun listener Firestore in tempo reale, per non
   * introdurre complessità sproporzionata rispetto al beneficio — vedi js/app.js,
   * compilazioneScreen si iscrive a onDatiAggiornati per rinfrescare lo schermo se aperto).
   */
  function init() {
    db.onCambiamento(alCambiamentoLocale);

    window.addEventListener('online', sincronizzaTutto);
    window.addEventListener('offline', () => impostaStato('offline'));
    window.addEventListener('focus', () => { if (online()) sincronizzaTutto(); });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && online()) {
        sincronizzaTutto();
      }
    });

    if (online()) {
      return sincronizzaTutto();
    }
    impostaStato('offline');
    return Promise.resolve(false);
  }

  return {
    init,
    sincronizzaTutto,
    onCambioStato,
    onDatiAggiornati,
    statoAttuale: () => statoAttuale,
    _test: {
      arrayRisposteInMappa,
      mappaRisposteInArray,
      unisciRisposte,
      unisciFotoUrl,
      estraiMetadati,
      timestampDi
    }
  };
})();
