/**
 * Sincronizzazione delle FOTO su Supabase Storage: le foto restano sempre salvate in locale
 * per prime (db.js, invariato), questo modulo è un livello "best effort" aggiuntivo che, quando
 * online, ne carica anche una copia sul bucket Supabase configurato in js/supabase-config.js e
 * ne salva il riferimento (url pubblico + percorso nel bucket) sia sul record locale della foto
 * sia sulla mappa "foto_url" del sopralluogo, così il riferimento viaggia con la sincronizzazione
 * testuale già esistente (js/sync.js, via Firestore) e resta consultabile anche da un dispositivo
 * che non ha mai avuto quella foto in locale (vedi risolviFoto, usata da js/pdf.js).
 *
 * Nessuna chiamata qui blocca mai l'uso dell'app o fa perdere una foto: ogni errore (rete
 * assente, bucket non raggiungibile, SDK non caricato) viene intercettato e loggato in console,
 * mai mostrato all'utente. La foto resta comunque salvata in locale (db.js) e l'upload viene
 * ritentato automaticamente al ritorno della connessione (stesso pattern di js/sync.js).
 */
const fotoSync = (() => {
  let client = null;

  // Stato di upload in memoria (per foto caricate/ritentate in QUESTA sessione), usato solo per
  // l'indicatore visivo in app.js: 'in-corso' | 'completato' | 'fallito'. Non persistito: una
  // foto già caricata in una sessione precedente non ha voce qui finché non viene ritoccata.
  const statoPerFoto = new Map();
  const listenerStato = [];

  function online() {
    return navigator.onLine;
  }

  /** Inizializza il client Supabase al primo utilizzo. Ritorna null se SDK/config non disponibili. */
  function inizializzaClient() {
    if (client) {
      return client;
    }
    if (typeof supabase === 'undefined' || typeof SUPABASE_URL === 'undefined') {
      console.warn('FotoSync: SDK Supabase o supabase-config.js non caricati, sincronizzazione foto disabilitata.');
      return null;
    }
    client = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    return client;
  }

  function impostaStato(fotoId, stato) {
    statoPerFoto.set(fotoId, stato);
    listenerStato.forEach((callback) => {
      try {
        callback(fotoId, stato);
      } catch (errore) {
        console.error('FotoSync: errore in un listener di stato upload', errore);
      }
    });
  }

  /** Stato di upload noto per una foto in questa sessione (undefined se mai toccata qui). */
  function statoDi(fotoId) {
    return statoPerFoto.get(fotoId);
  }

  function onCambioStato(callback) {
    listenerStato.push(callback);
  }

  /**
   * Percorso univoco nel bucket per una foto: cartella per sopralluogo (comoda per la pulizia in
   * blocco quando un sopralluogo viene eliminato) + domanda + timestamp + id foto.
   */
  function percorsoStorage({ sopralluogo_id, domanda_id, fotoId }) {
    const cartellaDomanda = domanda_id === null || domanda_id === undefined ? 'altri-aspetti' : domanda_id;
    return `${sopralluogo_id}/${cartellaDomanda}_${Date.now()}_${fotoId}.jpg`;
  }

  /**
   * Carica su Supabase Storage una foto già salvata in locale e, se riuscito, ne salva url
   * pubblico + percorso sia sul record locale (db.impostaUrlFoto) sia sulla mappa foto_url del
   * sopralluogo (db.impostaUrlFotoSopralluogo, che sincronizza su Firestore). Silenzioso se
   * offline o in errore: la foto resta comunque valida solo in locale, verrà ritentata da
   * riprovaInSospeso al ritorno della connessione.
   */
  async function caricaFoto({ fotoId, sopralluogo_id, domanda_id, blob }) {
    const supa = inizializzaClient();
    if (!supa || !online()) {
      impostaStato(fotoId, 'fallito');
      return;
    }

    impostaStato(fotoId, 'in-corso');
    try {
      const path = percorsoStorage({ sopralluogo_id, domanda_id, fotoId });
      const { error: erroreUpload } = await supa.storage.from(SUPABASE_BUCKET).upload(path, blob, {
        contentType: 'image/jpeg',
        upsert: false
      });
      if (erroreUpload) {
        throw erroreUpload;
      }

      const { data } = supa.storage.from(SUPABASE_BUCKET).getPublicUrl(path);
      const url = data ? data.publicUrl : null;

      // No-op se la foto è stata eliminata in locale mentre l'upload era ancora in corso (vedi
      // db.impostaUrlFoto): niente da aggiornare, la foto non è più referenziata da nessuna parte.
      await db.impostaUrlFoto(fotoId, { url, storage_path: path });
      await db.impostaUrlFotoSopralluogo(sopralluogo_id, fotoId, { url, path });

      impostaStato(fotoId, 'completato');
    } catch (errore) {
      console.warn('FotoSync: upload della foto su Supabase fallito, resta salvata solo in locale', fotoId, errore);
      impostaStato(fotoId, 'fallito');
    }
  }

  /**
   * Ritenta l'upload di tutte le foto salvate in locale ma senza ancora un url Supabase (vedi
   * db.elencaFotoSenzaUrl): chiamata all'avvio dell'app e al ritorno della connessione, stesso
   * pattern di sync.sincronizzaTutto per i dati testuali.
   */
  async function riprovaInSospeso() {
    if (!online()) {
      return;
    }
    const supa = inizializzaClient();
    if (!supa) {
      return;
    }
    const inSospeso = await db.elencaFotoSenzaUrl();
    for (const foto of inSospeso) {
      await caricaFoto({
        fotoId: foto.id,
        sopralluogo_id: foto.sopralluogo_id,
        domanda_id: foto.domanda_id,
        blob: foto.blob
      });
    }
  }

  /**
   * Elimina su Supabase Storage il file di una singola foto già eliminata in locale (chiamata
   * con il record ritornato da db.eliminaFoto, che contiene il percorso salvato al momento
   * dell'upload). Best-effort: se la foto non era mai stata caricata (storage_path assente,
   * offline al momento dello scatto e mai ritentata) non c'è nulla da eliminare da remoto.
   */
  async function eliminaFotoRemota(fotoEliminata) {
    if (!fotoEliminata || !fotoEliminata.storage_path) {
      return;
    }
    const supa = inizializzaClient();
    if (!supa || !online()) {
      return;
    }
    try {
      const { error } = await supa.storage.from(SUPABASE_BUCKET).remove([fotoEliminata.storage_path]);
      if (error) {
        throw error;
      }
    } catch (errore) {
      console.warn('FotoSync: impossibile eliminare su Supabase la foto', fotoEliminata.id, errore);
    }
  }

  /** Percorsi Supabase di tutte le foto (domande + "Altri aspetti") referenziate da un sopralluogo, via la sua mappa foto_url. */
  function percorsiFotoDiSopralluogo(sopralluogo) {
    const idFoto = (sopralluogo.risposte || [])
      .flatMap((r) => r.foto || [])
      .concat(sopralluogo.altri_aspetti_foto || []);
    const mappa = sopralluogo.foto_url || {};
    return idFoto
      .map((id) => mappa[id] && mappa[id].path)
      .filter(Boolean);
  }

  /**
   * Elimina su Supabase Storage tutte le foto di uno o più sopralluoghi eliminati
   * definitivamente (Cestino: eliminazione manuale o pulizia automatica dei 30 giorni). Usa la
   * mappa foto_url del sopralluogo (sincronizzata via Firestore), non solo le foto presenti in
   * locale su QUESTO dispositivo: così funziona anche eliminando, da un dispositivo, foto
   * caricate da un altro. Best-effort, mai bloccante.
   */
  async function eliminaFotoDiSopralluoghi(sopralluoghi) {
    if (!sopralluoghi || !sopralluoghi.length) {
      return;
    }
    const supa = inizializzaClient();
    if (!supa || !online()) {
      return;
    }
    const percorsi = sopralluoghi.flatMap(percorsiFotoDiSopralluogo);
    if (!percorsi.length) {
      return;
    }
    try {
      const { error } = await supa.storage.from(SUPABASE_BUCKET).remove(percorsi);
      if (error) {
        throw error;
      }
    } catch (errore) {
      console.warn('FotoSync: impossibile eliminare su Supabase alcune foto di sopralluoghi eliminati', errore);
    }
  }

  /**
   * Risolve il blob di una foto per la generazione PDF (js/pdf.js): prova prima IndexedDB
   * locale (più veloce, nessuna richiesta di rete); se assente (foto scattata da un altro
   * dispositivo) e il sopralluogo ha un riferimento Supabase per quella foto, la scarica da lì.
   * Ritorna null se non disponibile in nessuno dei due modi (foto offline mai sincronizzata, o
   * download fallito): il chiamante la omette dal PDF con l'avviso già esistente.
   *
   * Usa sempre il download autenticato del client Supabase (storage.download), non l'url
   * pubblico salvato: il bucket di questo progetto non è marcato "Public" (vedi
   * supabase-config.js), quindi un fetch diretto sull'url fallirebbe.
   */
  async function risolviFoto(fotoId, sopralluogo) {
    const locale = await db.leggiFoto(fotoId);
    if (locale) {
      return locale;
    }

    const voce = sopralluogo && sopralluogo.foto_url && sopralluogo.foto_url[fotoId];
    if (!voce || !voce.path) {
      return null;
    }

    const supa = inizializzaClient();
    if (!supa || !online()) {
      return null;
    }

    try {
      const { data: blob, error } = await supa.storage.from(SUPABASE_BUCKET).download(voce.path);
      if (error) {
        throw error;
      }
      return { id: fotoId, sopralluogo_id: sopralluogo.id, blob };
    } catch (errore) {
      console.warn('FotoSync: impossibile scaricare da Supabase la foto', fotoId, errore);
      return null;
    }
  }

  function init() {
    window.addEventListener('online', () => {
      riprovaInSospeso().catch((errore) => console.error('FotoSync: ripresa upload in sospeso fallita', errore));
    });

    if (online()) {
      riprovaInSospeso().catch((errore) => console.error('FotoSync: ripresa upload in sospeso fallita', errore));
    }
  }

  return {
    init,
    caricaFoto,
    riprovaInSospeso,
    eliminaFotoRemota,
    eliminaFotoDiSopralluoghi,
    risolviFoto,
    statoDi,
    onCambioStato
  };
})();
