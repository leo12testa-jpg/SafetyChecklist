// Service worker per il funzionamento offline della checklist.
const CACHE_NAME = 'safety-checklist-shell-20261008-carrefour-jpeg5';

const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css?v=20261008-carrefour-jpeg5',
  './js/vendor/jspdf.umd.min.js',
  './js/vendor/jspdf.plugin.autotable.min.js',
  './js/vendor/jszip.min.js',
  './js/vendor/firebase-app-compat.js',
  './js/vendor/firebase-firestore-compat.js',
  './js/vendor/firebase-auth-compat.js',
  './js/firebase-config.js',
  './js/auth.js?v=20261008-carrefour-jpeg5',
  './js/vendor/supabase.js',
  './js/supabase-config.js',
  './js/vendor/pdf.min.js',
  './js/vendor/pdf.worker.min.js',
  './js/app.js?v=20261008-carrefour-jpeg5',
  './js/identity.js',
  './js/account-screens.js?v=20261008-carrefour-jpeg5',
  './js/db.js?v=20261008-carrefour-jpeg5',
  './js/checklist.js?v=20261008-carrefour-jpeg5',
  './js/question-navigator.js',
  './js/storico-filtri.js?v=20261008-carrefour-jpeg5',
  './js/foto-sync.js',
  './js/pdf.js?v=20261008-carrefour-jpeg5',
  './js/pdf-import.js?v=20261008-carrefour-jpeg5',
  './js/import-matching.js?v=20261008-carrefour-jpeg5',
  './js/camera.js',
  './js/sync.js?v=20261008-carrefour-jpeg5',
  './js/aggiornamento.js?v=20261008-carrefour-jpeg5',
  './checklists/index.json',
  './checklists/clients.json',
  './checklists/tecnici.json',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/icon-512-maskable.png',
  './assets/logo_colligo.webp',
  './assets/logo_coin.webp',
  './assets/logo_interparking.webp',
  './assets/logo_restage.png',
  './assets/logo_melluso.png',
  './assets/logo_carrefour.png'
];

async function precacheTutto(cache) {
  // Non rendere inutilizzabile l'aggiornamento per il guasto a una singola risorsa.
  const risultati = await Promise.allSettled(APP_SHELL.map(async (url) => {
    await cache.add(url);
  }));
  const falliti = risultati.map((r, i) => r.status === 'rejected' ? APP_SHELL[i] : null).filter(Boolean);
  if (falliti.length) console.warn('[SafetyChecklist SW] Asset non memorizzati:', falliti);
  try {
    const response = await fetch('./checklists/index.json', { cache: 'no-store' });
    if (!response.ok) throw new Error('Indice checklist HTTP ' + response.status);
    const { checklists } = await response.json();
    await Promise.allSettled((checklists || []).map(c =>
      cache.add('./checklists/' + c.id + '.json?v=' + encodeURIComponent(c.versione || ''))
    ));
  } catch (errore) {
    console.warn('[SafetyChecklist SW] Precache checklist parziale:', errore);
  }
}

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(precacheTutto).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys
    .filter(key => key.startsWith('safety-checklist-shell-') && key !== CACHE_NAME)
    .map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      const clone = response.clone();
      eventSafePut(request, clone);
    }
    return response;
  } catch (e) {
    return Response.error();
  }
}
function eventSafePut(request, response) {
  caches.open(CACHE_NAME).then(cache => cache.put(request, response)).catch(error =>
    console.warn('[SafetyChecklist SW] Errore cache:', error));
}
async function networkFirst(request, { bypassHttpCache = false } = {}) {
  try {
    const req = bypassHttpCache ? new Request(request, {cache:'no-store'}) : request;
    const response = await fetch(req);
    if (response && response.ok) eventSafePut(request, response.clone());
    return response;
  } catch (e) {
    return (await caches.match(request)) || Response.error();
  }
}
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  const isChecklist = url.pathname.includes('/checklists/');
  const isLogo = url.pathname.includes('/assets/logo_');
  const isVersione = url.pathname.endsWith('/version.json');
  const isDocumento = event.request.mode === 'navigate' || url.pathname.endsWith('/index.html');
  const isCodice = event.request.destination === 'script' || event.request.destination === 'style';
  event.respondWith(isChecklist || isLogo || isVersione || isDocumento || isCodice
    ? networkFirst(event.request, {bypassHttpCache: true})
    : cacheFirst(event.request));
});
