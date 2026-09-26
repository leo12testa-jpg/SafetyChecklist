/**
 * Configurazione del progetto Firebase usato per la sincronizzazione multi-dispositivo
 * dei sopralluoghi (solo dati testuali, vedi js/sync.js). Le chiavi qui sotto sono valori
 * pubblici lato client (normali per le app Firebase web): la protezione dei dati è affidata
 * alle Regole di sicurezza di Firestore configurate sul progetto, non alla segretezza di
 * questi valori.
 */
const firebaseConfig = {
  apiKey: "AIzaSyAdgCc8TQ1TVfF8l0NMxtm7NS95ZOl4lCA",
  authDomain: "safety-checklist-colligo.firebaseapp.com",
  projectId: "safety-checklist-colligo",
  storageBucket: "safety-checklist-colligo.firebasestorage.app",
  messagingSenderId: "792044189701",
  appId: "1:792044189701:web:8e421f500963a25951846c"
};

const USER_ADMIN_ENDPOINT = 'https://twznfiygzzbqdgudpwav.supabase.co/functions/v1/manage-users';

/**
 * Bootstrap Firebase client condiviso.
 *
 * In particolare su WebKit/Safari le settings Firestore devono essere applicate PRIMA che
 * qualunque modulo (Auth compreso, tramite la lettura del profilo) inizi ad usare Firestore.
 * Tutti i moduli dell'app riusano quindi questa singola istanza già configurata.
 */
const firebaseClient = (() => {
  let firestoreDb = null;

  function initApp() {
    if (typeof firebase === 'undefined') throw new Error('Firebase SDK non disponibile.');
    if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
    return firebase.app();
  }

  function isWebKit() {
    const ua = navigator.userAgent || '';
    return /AppleWebKit/.test(ua) && !/Chrome|Chromium|CriOS|Edg|EdgiOS|FxiOS/.test(ua);
  }

  function firestore() {
    initApp();
    if (firestoreDb) return firestoreDb;
    firestoreDb = firebase.firestore();
    if (isWebKit()) {
      // Deve avvenire prima di qualunque get/listen/write. Long polling evita listener sospesi
      // o cancellati da WebKit al ritorno da background/visibility change.
      firestoreDb.settings({
        experimentalForceLongPolling: true,
        experimentalAutoDetectLongPolling: false,
        useFetchStreams: false
      });
    }
    return firestoreDb;
  }

  return { initApp, firestore };
})();
