// EXPORT DI SICUREZZA (SOLA LETTURA) DELL'INDEXEDDB DI SAFETY CHECKLIST
//
// Uso: aprire https://leo12testa-jpg.github.io/SafetyChecklist/ nel browser/profilo da salvare,
// F12 -> Console, incollare TUTTO questo file e premere Invio (Edge/Chrome possono chiedere di
// digitare prima "consenti incolla"). Scarica un file JSON con TUTTI i sopralluoghi (anche cestino)
// e TUTTE le foto (base64). Non scrive, non cancella, non sincronizza nulla.
(async () => {
  const database = await new Promise((resolve, reject) => {
    const r = indexedDB.open('SafetyChecklistDB'); // nessuna versione: mai un upgrade
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  const leggiTutto = (nome) => new Promise((resolve, reject) => {
    if (!database.objectStoreNames.contains(nome)) return resolve([]);
    const r = database.transaction(nome, 'readonly').objectStore(nome).getAll();
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  const inBase64 = (blob) => new Promise((resolve) => {
    if (!(blob instanceof Blob)) return resolve(null);
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => resolve(null);
    fr.readAsDataURL(blob);
  });

  const sopralluoghi = await leggiTutto('sopralluoghi');
  const foto = [];
  for (const f of await leggiTutto('foto')) {
    const { blob, ...resto } = f;
    foto.push({ ...resto, blob_size: blob?.size || 0, data_url: await inBase64(blob) });
  }
  database.close();

  const sospetti = sopralluoghi.filter((s) => /misdo|mi\s*sdo|san\s*donato|interparking/i.test(JSON.stringify(s)));
  const esportazione = {
    esportato_il: new Date().toISOString(),
    origine: location.href,
    user_agent: navigator.userAgent,
    conteggi: { sopralluoghi: sopralluoghi.length, foto: foto.length },
    sospetti_misdo: sospetti.map((s) => ({ id: s.id, punto_vendita: s.punto_vendita, data: s.data, aggiornato_il: s.aggiornato_il })),
    sopralluoghi,
    foto
  };
  const file = new Blob([JSON.stringify(esportazione, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = `safetychecklist-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  console.log('Export completato:', esportazione.conteggi, 'Possibili MISDO:', esportazione.sospetti_misdo);
})().catch((e) => console.error('Export fallito:', e));
