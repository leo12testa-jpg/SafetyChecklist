/**
 * Acquisizione e compressione foto: cattura/selezione file tramite input nativo,
 * ridimensiona lato client (max lato ~1280px) e comprime in JPEG (~0.7),
 * poi salva il blob risultante tramite db.js collegato a sopralluogo/domanda.
 */
const camera = (() => {
  const LATO_MASSIMO = 1280;
  const QUALITA_JPEG = 0.7;

  function scegliFile() {
    return new Promise((resolve, reject) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.capture = 'environment';

      input.addEventListener('change', () => {
        const file = input.files && input.files[0];
        if (!file) {
          reject(new Error('Nessuna foto selezionata.'));
          return;
        }
        resolve(file);
      }, { once: true });

      input.click();
    });
  }

  function caricaImmagine(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => resolve({ img, url });
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Impossibile leggere il file immagine.'));
      };
      img.src = url;
    });
  }

  function comprimi(img) {
    const scala = Math.min(1, LATO_MASSIMO / Math.max(img.width, img.height));
    const larghezza = Math.round(img.width * scala);
    const altezza = Math.round(img.height * scala);

    const canvas = document.createElement('canvas');
    canvas.width = larghezza;
    canvas.height = altezza;
    canvas.getContext('2d').drawImage(img, 0, 0, larghezza, altezza);

    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('Compressione immagine fallita.'))),
        'image/jpeg',
        QUALITA_JPEG
      );
    });
  }

  /**
   * Apre fotocamera/galleria, comprime la foto scelta e la salva collegata a un sopralluogo
   * ed eventualmente a una domanda (usato sia per domande normali che per il sotto-form NC).
   * Ritorna l'id della foto salvata in db.js.
   */
  async function scattaFoto({ sopralluogo_id, domanda_id = null }) {
    const file = await scegliFile();
    const { img, url } = await caricaImmagine(file);
    try {
      const blob = await comprimi(img);
      return await db.salvaFoto({ sopralluogo_id, domanda_id, blob });
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  return { scattaFoto };
})();
