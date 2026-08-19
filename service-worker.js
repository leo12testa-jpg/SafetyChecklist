const CACHE_NAME = 'safety-checklist-shell-v41';

const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/vendor/jspdf.umd.min.js',
  './js/vendor/jspdf.plugin.autotable.min.js',
  './js/vendor/jszip.min.js',
  './js/vendor/firebase-app-compat.js',
  './js/vendor/firebase-firestore-compat.js',
  './js/firebase-config.js',
  './js/vendor/pdf.min.js',
  './js/vendor/pdf.worker.min.js',
  './js/app.js',
  './js/db.js',
  './js/checklist.js',
  './js/pdf.js',
  './js/pdf-import.js',
  './js/camera.js',
  './js/sync.js',
  './checklists/index.json',
  './checklists/clients.json',
  './checklists/tecnici.json',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/icon-512-maskable.png',
  './assets/logo_colligo.webp',
  './assets/logo_coin.webp',
  './assets/logo_interparking.webp',
  './assets/logo_restage.png'
];

/** Precachea l'App Shell statica più tutte le checklist elencate in checklists/index.json. */
async function precacheTutto(cache) {
  await cache.addAll(APP_SHELL);

  const response = await fetch('./checklists/index.json');
  const { checklists } = await response.json();
  const urlChecklist = checklists.map((c) => `./checklists/${c.id}.json`);
  await cache.addAll(urlChecklist);
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(precacheTutto)
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

/** Asset statici dell'App Shell: cache-first, aggiornata in background quando risponde la rete. */
function cacheFirst(request) {
  return caches.match(request).then((cached) => {
    if (cached) {
      return cached;
    }

    return fetch(request)
      .then((response) => {
        if (response && response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      })
      .catch(() => caches.match('./index.html'));
  });
}

/** Checklist JSON: network-first con fallback cache, per riflettere subito eventuali aggiornamenti da remoto (PROJECT.md §6, §8). */
function networkFirst(request) {
  return fetch(request)
    .then((response) => {
      if (response && response.ok) {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
      }
      return response;
    })
    .catch(() => caches.match(request));
}

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') {
    return;
  }

  const url = new URL(event.request.url);

  // Richieste a Firestore/altri servizi esterni (es. sync.js): lasciate al browser, non
  // intercettate dallo shell cache-first, che altrimenti in caso di rete assente le
  // risolverebbe con l'index.html cacheato invece di un normale errore di rete.
  if (url.origin !== self.location.origin) {
    return;
  }

  const isChecklist = url.pathname.includes('/checklists/');

  event.respondWith(isChecklist ? networkFirst(event.request) : cacheFirst(event.request));
});
