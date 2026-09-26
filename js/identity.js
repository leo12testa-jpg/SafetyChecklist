/** Local audit outbox and operator identity. It never stores a password or Auth token. */
const auditAttivita = (() => {
  const OUTBOX_KEY = 'audit_pending';
  let flushing = null;
  let queueWrites = Promise.resolve();
  const uid = () => appIdentity.current()?.uid || null;
  const identity = () => {
    const user = appIdentity.current();
    return user ? { uid: user.uid, username: user.username, nome: `${user.nome} ${user.cognome}` } : null;
  };

  async function readQueue() { return (await db.leggiImpostazione(OUTBOX_KEY)) || []; }
  function mutateQueue(operation) {
    const next = queueWrites.then(operation, operation);
    queueWrites = next.catch(() => {});
    return next;
  }
  async function enqueue(item) {
    await mutateQueue(async () => {
      const pending = await readQueue();
      await db.salvaImpostazione(OUTBOX_KEY, [...pending, item]);
    });
  }
  async function send(item) {
    const user = firebase.auth().currentUser;
    if (!navigator.onLine || !user || item.uid !== user.uid) return false;
    await firebaseClient.firestore().collection('attivita').doc(item.id).set({
      uid: item.uid, username: item.username, nome: item.nome,
      sopralluogo_id: item.sopralluogo_id, tipo: item.tipo,
      domanda_id: item.domanda_id ?? null, timestamp: firebase.firestore.FieldValue.serverTimestamp()
    });
    return true;
  }
  async function flush() {
    if (flushing) return flushing;
    flushing = (async () => {
      const queue = await mutateQueue(readQueue), failed = [];
      for (const item of queue) {
        try { if (!await send(item)) failed.push(item); }
        catch (_) { failed.push(item); }
      }
      await mutateQueue(async () => {
        const latest = await readQueue();
        const concurrent = latest.filter(item => !queue.some(pending => pending.id === item.id));
        await db.salvaImpostazione(OUTBOX_KEY, [...failed, ...concurrent]);
      });
    })().finally(() => { flushing = null; });
    return flushing;
  }
  async function record({ sopralluogo_id, tipo, domanda_id = null }) {
    const actor = identity();
    if (!actor || !sopralluogo_id || !tipo) return;
    const item = { id: crypto.randomUUID(), ...actor, sopralluogo_id, tipo, domanda_id, timestamp: new Date() };
    if (await send(item)) return;
    await enqueue(item);
  }
  window.addEventListener('online', flush);
  window.addEventListener('account:authenticated', flush);
  return { uid, identity, record, flush };
})();

document.addEventListener('DOMContentLoaded', async () => {
  const profile = await appIdentity.ready();
  if (!profile) return;
  document.getElementById('btn-area-utenti').hidden = profile.ruolo !== 'admin';
});
