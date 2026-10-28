// Service worker per il funzionamento offline della checklist.
const CACHE_NAME = 'safety-checklist-shell-20261012-140126';

const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css?v=20261012-140126',
  './js/vendor/jspdf.umd.min.js',
  './js/vendor/jspdf.plugin.autotable.min.js',
  './js/vendor/jszip.min.js',
  './js/vendor/firebase-app-compat.js',
  './js/vendor/firebase-firestore-compat.js',
  './js/vendor/firebase-auth-compat.js',
  './js/firebase-config.js',
  './js/auth.js?v=20261012-140126',
  './js/supabase-config.js',
  './js/vendor/pdf.min.js',
  './js/vendor/pdf.worker.min.js',
  './js/app.js?v=20261012-140126',
  './js/document-generation.js',
  './js/identity.js',
  './js/account-screens.js?v=20261012-140126',
  './js/db.js?v=20261012-140126',
  './js/checklist.js?v=20261012-140126',
  './js/question-navigator.js',
  './js/storico-filtri.js?v=20261012-140126',
  './js/foto-sync.js?v=20261012-140126',
  './js/pdf.js?v=20261012-140126',
  './js/pdf-import.js?v=20261012-140126',
  './js/import-matching.js?v=20261012-140126',
  './js/camera.js',
  './js/sync.js?v=20261012-140126',
  './js/aggiornamento.js?v=20261012-140126',
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
  // Keep the previous working shell until every required asset is available.
  const risultati = await Promise.allSettled(APP_SHELL.map(async (url) => {
    await cache.add(url);
  }));
  const falliti = risultati.map((r, i) => r.status === 'rejected' ? APP_SHELL[i] : null).filter(Boolean);
  if (falliti.length) throw new Error('Asset non memorizzati: ' + falliti.join(', '));
  try {
    const response = await fetch('./checklists/index.json', { cache: 'no-store' });
    if (!response.ok) throw new Error('Indice checklist HTTP ' + response.status);
    const { checklists } = await response.json();
    await Promise.all((checklists || []).map(c =>
      cache.add('./checklists/' + c.id + '.json?v=' + encodeURIComponent(c.versione || ''))
    ));
  } catch (errore) {
    console.warn('[SafetyChecklist SW] Installazione rimandata: checklist non disponibili:', errore);
    throw errore;
  }
  await cache.put('./.shell-ready', new Response(CACHE_NAME));
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
    if (response && response.ok && !/\b(?:private|no-store)\b/i.test(response.headers.get('cache-control') || '')) {
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
  let response;
  try {
    const req = bypassHttpCache ? new Request(request, {cache:'no-store'}) : request;
    response = await fetch(req);
    if (response && response.ok) { eventSafePut(request, response.clone());return response; }
  } catch (e) { /* HTTP/transport failure: recover from the installed shell. */ }
  const cached = await caches.match(request);
  if (cached) return cached;
  const url = new URL(request.url),base = new URL('./',self.location.href);
  // Some WebKit navigation requests do not match the cached directory URL.
  // Resolve only this application's entry point, never another app's path.
  if (url.pathname === base.pathname || url.pathname === base.pathname + 'index.html') {
    const shell = await caches.match(new URL('index.html',base).href);
    if (shell) return shell;
  }
  return response || Response.error();
}
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  // Only the app shell belongs in this cache. A same-origin API must keep its
  // own authorization and private response semantics, including offline errors.
  const base = new URL('./', self.location.href);
  if (!url.pathname.startsWith(base.pathname)) return;
  // Release discovery is always network-only. Timestamped version requests
  // must neither grow the shell cache nor become stale release announcements.
  if (url.pathname.endsWith('/version.json')) return;
  const isChecklist = url.pathname.includes('/checklists/');
  const isLogo = url.pathname.includes('/assets/logo_');
  const isDocumento = event.request.mode === 'navigate' || url.pathname.endsWith('/index.html');
  const isCodice = event.request.destination === 'script' || event.request.destination === 'style';
  event.respondWith(isChecklist || isLogo || isDocumento || isCodice
    ? networkFirst(event.request, {bypassHttpCache: true})
    : cacheFirst(event.request));
});
