/**
 * Registrazione del Service Worker + coordinamento dell'aggiornamento e badge versione.
 *
 * Il Service Worker (service-worker.js) chiama già self.skipWaiting()/clients.claim() senza
 * attendere il consenso della pagina: quando arriva una versione nuova, il browser la attiva e ne
 * prende il controllo comunque, a prescindere da cosa sta facendo l'utente in quel momento. Quello
 * che questo modulo controlla NON è se il nuovo Service Worker prende il controllo (già deciso),
 * ma SE e QUANDO la pagina visibile si ricarica per usarlo davvero: al massimo un reload per
 * aggiornamento (mai un loop, garantito dal flag "ricaricamentoGiaFatto"), ed evitato del tutto se
 * l'utente sta scrivendo dati non ancora salvati (schermate compilazione/altri-aspetti/nuovo
 * sopralluogo: le note si autosalvano solo al blur, non a ogni tasto — vedi checklist.js/app.js) —
 * in quel caso si mostra un banner "Nuova versione disponibile" e si ricarica solo al click.
 */
const aggiornamentoApp = (() => {
  const SCHERMATE_A_RISCHIO = new Set(['new-inspection', 'compilazione', 'altri-aspetti']);

  const banner = document.getElementById('banner-aggiornamento');
  const bannerBottone = document.getElementById('banner-aggiornamento-bottone');
  const badgeVersione = document.getElementById('versione-app');

  let ricaricamentoGiaFatto = false;

  function schermataARischioAttiva() {
    const schermata = document.querySelector('.screen:not([hidden])');
    return !!(schermata && SCHERMATE_A_RISCHIO.has(schermata.dataset.screen));
  }

  function mostraBannerAggiornamento() {
    if (!banner) {
      return;
    }
    banner.hidden = false;
  }

  function ricaricaUnaVoltaSola() {
    if (ricaricamentoGiaFatto) {
      return;
    }
    ricaricamentoGiaFatto = true;
    location.reload();
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
      navigator.serviceWorker.register('service-worker.js', { updateViaCache: 'none' })
        .then((registrazione) => registrazione.update())
        .catch((errore) => console.error('[SW] Registrazione non riuscita:', errore));
    });

    // Il nuovo Service Worker prende comunque il controllo (skipWaiting/clients.claim lato SW):
    // qui si decide solo se e quando mostrarlo all'utente con un reload.
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (schermataARischioAttiva()) {
        mostraBannerAggiornamento();
        return;
      }
      ricaricaUnaVoltaSola();
    });

    if (bannerBottone) {
      bannerBottone.addEventListener('click', () => location.reload());
    }
  }

  /** Badge discreto in Impostazioni: legge version.json (mai cacheato, vedi service-worker.js) con un parametro anti-cache, così mostra sempre il BUILD_ID realmente in esecuzione. */
  async function aggiornaBadgeVersione() {
    if (!badgeVersione) {
      return;
    }
    try {
      const risposta = await fetch(`version.json?t=${Date.now()}`);
      const { buildId } = await risposta.json();
      badgeVersione.textContent = `Versione ${buildId}`;
    } catch (errore) {
      console.warn('Impossibile leggere version.json:', errore);
    }
  }

  function init() {
    registraServiceWorker();
    aggiornaBadgeVersione();
  }

  return { init, _test: { schermataARischioAttiva } };
})();

document.addEventListener('DOMContentLoaded', () => aggiornamentoApp.init());
