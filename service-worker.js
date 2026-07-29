const CACHE_NAME = 'safety-checklist-shell-v9';

const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/vendor/jspdf.umd.min.js',
  './js/app.js',
  './js/db.js',
  './js/checklist.js',
  './js/pdf.js',
  './js/camera.js',
  './checklists/index.json',
  './assets/logo.png',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/icon-512-maskable.png'
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
  const isChecklist = url.pathname.includes('/checklists/');

  event.respondWith(isChecklist ? networkFirst(event.request) : cacheFirst(event.request));
});
