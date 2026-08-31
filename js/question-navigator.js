/** Calcoli puri usati dalla barra interattiva delle domande. */
const questionNavigator = (() => {
  const SOGLIA_GESTO_PX = 8;

  function indiceDaPosizione(clientX, sinistra, larghezza, totale) {
    if (!totale || larghezza <= 0) return 0;
    const rapporto = Math.max(0, Math.min(1, (clientX - sinistra) / larghezza));
    return Math.min(totale - 1, Math.floor(rapporto * totale));
  }

  function classificaMovimento(deltaX, deltaY) {
    const x = Math.abs(deltaX);
    const y = Math.abs(deltaY);
    if (Math.max(x, y) < SOGLIA_GESTO_PX) return 'tap';
    return y > x ? 'verticale' : 'orizzontale';
  }

  return { indiceDaPosizione, classificaMovimento };
})();
