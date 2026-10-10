/** Compare the build embedded in this running script with the server version.
 * A controller change alone is not an update. Never reload unsaved input automatically.
 */
const aggiornamentoApp = (() => {
  const BUILD_ID = '20261009-qa-v1';
  let buildServer = null;
  // "import-preview" (anteprima importazione PDF, vedi js/pdf-import.js + js/import-matching.js
  // in app.js) esiste SOLO in memoria finchÃ© non si preme "Conferma importazione": un reload lÃ¬
  // perderebbe silenziosamente l'intera revisione dell'utente, esattamente come per le altre
  // schermate con dati non ancora salvati elencate qui.
  const SCHERMATE_A_RISCHIO = new Set(['new-inspection', 'compilazione', 'altri-aspetti', 'import-preview']);

  const banner = document.getElementById('banner-aggiornamento');
  const bannerBottone = document.getElementById('banner-aggiornamento-bottone');
  const badgeVersione = document.getElementById('versione-app');


  function schermataARischioAttiva() {
    if (typeof anteprimaImportazionePendente !== 'undefined' && anteprimaImportazionePendente) return true;
    const schermata = document.querySelector('.screen:not([hidden])');
    return !!(schermata && SCHERMATE_A_RISCHIO.has(schermata.dataset.screen));
  }

  function schermataSicuraPerAggiornamento() {
    const dialogAperto = document.querySelector('dialog[open]');
    if (dialogAperto || schermataARischioAttiva()) return false;

    // Login, home, storico, impostazioni e schermate di sola lettura possono essere aggiornate
    // senza perdere dati: IndexedDB resta intatto dopo il reload. In questo modo i tecnici che
    // tengono l'app aperta per giorni ricevono automaticamente le correzioni di sincronizzazione.
    if (document.body.dataset.authenticated !== 'true') return true;
    const schermata = document.querySelector('.screen:not([hidden])');
    return !!schermata;
  }

  async function provaAggiornamentoAutomatico() {
    if (!buildServer || buildServer === BUILD_ID || !schermataSicuraPerAggiornamento()) return false;
    const chiave = `safety-auto-update:${BUILD_ID}->${buildServer}`;
    try {
      if (sessionStorage.getItem(chiave)) return false;
      sessionStorage.setItem(chiave, '1');
    } catch (_) {}
    await attendiNuovoServiceWorker(10000);
    // Durante l'attesa l'utente potrebbe aver iniziato un nuovo sopralluogo o aperto un dialogo.
    // Ricontrollare immediatamente prima del reload per non perdere dati non confermati.
    if (!schermataSicuraPerAggiornamento()) {
      try { sessionStorage.removeItem(chiave); } catch (_) {}
      return false;
    }
    location.reload();
    return true;
  }

  function mostraBannerAggiornamento() {
    if (!banner) {
      return;
    }
    banner.hidden = !buildServer || buildServer === BUILD_ID;
  }

  function registraServiceWorker() {
    if (!('serviceWorker' in navigator)) {
      return;
    }

    window.addEventListener('load', () => {
      // updateViaCache: 'none' impedisce al browser di servire service-worker.js dalla cache HTTP
      // quando ne verifica gli aggiornamenti (su GitHub Pages, senza controllo sugli header
      // Cache-Control, altrimenti il controllo vedrebbe una copia non aggiornata del file per la
      // durata della sua cache HTTP).
      navigator.serviceWorker.register('service-worker.js', { scope: './', updateViaCache: 'none' })
        .then((registrazione) => registrazione.update())
        .catch((errore) => console.error('[SW] Registrazione non riuscita:', errore));
    });

    // Il nuovo Service Worker prende comunque il controllo (skipWaiting/clients.claim lato SW):
    // qui si decide solo se e quando mostrarlo all'utente con un reload.
    navigator.serviceWorker.addEventListener('controllerchange', () => aggiornaBadgeVersione());

    if (bannerBottone) {
      bannerBottone.addEventListener('click', async () => {
        if (!schermataSicuraPerAggiornamento()) {
          alert('Per proteggere il lavoro in corso, termina o salva il sopralluogo e chiudi le finestre aperte prima di aggiornare.');
          return;
        }
        bannerBottone.disabled = true;
        // The shell is served cache-first: reloading before the new worker has activated would
        // bring back the old build (and the banner). Wait for it, bounded, then reload once.
        await attendiNuovoServiceWorker(10000);
        if (!schermataSicuraPerAggiornamento()) {
          bannerBottone.disabled = false;
          alert('Aggiornamento rimandato: ci sono modifiche in corso che potrebbero andare perse.');
          return;
        }
        location.reload();
      });
    }
  }

  async function attendiNuovoServiceWorker(timeoutMs) {
    try {
      const registrazione = await navigator.serviceWorker.getRegistration();
      if (!registrazione) return;
      await registrazione.update();
      const worker = registrazione.installing || registrazione.waiting;
      if (!worker || worker.state === 'activated') return;
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, timeoutMs);
        worker.addEventListener('statechange', () => {
          if (worker.state === 'activated' || worker.state === 'redundant') { clearTimeout(timer); resolve(); }
        });
      });
    } catch (errore) {
      console.warn('[SW] Verifica aggiornamento non riuscita, ricarico comunque:', errore);
    }
  }

  /** Badge discreto in Impostazioni: legge version.json (mai cacheato, vedi service-worker.js) con un parametro anti-cache, cosÃ¬ mostra sempre il BUILD_ID realmente in esecuzione. */
  async function aggiornaBadgeVersione() {
    if (badgeVersione) badgeVersione.textContent = `Versione ${BUILD_ID}`;
    try {
      const risposta = await fetch(`version.json?t=${Date.now()}`, { cache: 'no-store' });
      if (!risposta.ok) return;
      buildServer = (await risposta.json()).buildId;
      mostraBannerAggiornamento();
      await provaAggiornamentoAutomatico();
    } catch (errore) {
      console.warn('Impossibile verificare la nuova versione:', errore);
    }
  }

  function init() {
    registraServiceWorker();
    aggiornaBadgeVersione();
    window.addEventListener('focus', aggiornaBadgeVersione);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') aggiornaBadgeVersione();
    });
  }

  return { init, _test: { schermataARischioAttiva } };
})();

document.addEventListener('DOMContentLoaded', () => aggiornamentoApp.init());
