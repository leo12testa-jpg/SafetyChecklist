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
