/** User administration and operator's audit-based work list. */
const accountScreens = (() => {
  const userBody = document.getElementById('admin-utenti-body');
  const userForm = document.getElementById('admin-user-form');
  const userMessage = document.getElementById('admin-user-message');
  const userSearch = document.getElementById('admin-user-search');
  const userCount = document.getElementById('admin-users-count');
  const statTotali = document.getElementById('admin-stat-totali');
  const statAttivi = document.getElementById('admin-stat-attivi');
  const statDisattivati = document.getElementById('admin-stat-disattivati');
  const statAdmin = document.getElementById('admin-stat-admin');
  const workList = document.getElementById('lista-mio-lavoro');
  const workEmpty = document.getElementById('mio-lavoro-vuoto');
  let filtro = 'all';
  let lavori = [];
  let utentiCache = [];

  function messaggio(target, text, error = false) {
    target.textContent = text;
    target.hidden = !text;
    target.classList.toggle('is-error', error);
  }

  async function api(action, body = {}) { return appIdentity.callAdmin(action, body); }

  function aggiornaStatisticheUtenti() {
    statTotali.textContent = String(utentiCache.length);
    statAttivi.textContent = String(utentiCache.filter((user) => user.attivo).length);
    statDisattivati.textContent = String(utentiCache.filter((user) => !user.attivo).length);
    statAdmin.textContent = String(utentiCache.filter((user) => user.ruolo === 'admin').length);
  }

  function filtraUtenti() {
    const testo = String(userSearch.value || '').trim().toLowerCase();
    return utentiCache.filter((user) => {
      if (!testo) return true;
      return [user.nome, user.cognome, user.username, user.ruolo]
        .some((valore) => String(valore || '').toLowerCase().includes(testo));
    });
  }

  function creaBadgeUtente(testo, classe) {
    const badge = document.createElement('span');
    badge.className = `admin-user-badge ${classe}`;
    badge.textContent = testo;
    return badge;
  }

  function renderUserRows() {
    const users = filtraUtenti();
    userBody.replaceChildren();
    userCount.textContent = users.length === 1 ? '1 utente' : `${users.length} utenti`;

    for (const user of users) {
      const row = document.createElement('tr');
      row.dataset.uid = user.uid;

      for (const value of [user.nome, user.cognome, user.username]) {
        const cell = document.createElement('td');
        cell.textContent = value || '—';
        row.appendChild(cell);
      }

      const roleCell = document.createElement('td');
      roleCell.appendChild(creaBadgeUtente(user.ruolo === 'admin' ? 'Admin' : 'Tecnico', user.ruolo === 'admin' ? 'is-admin' : 'is-tech'));
      row.appendChild(roleCell);

      const statusCell = document.createElement('td');
      statusCell.appendChild(creaBadgeUtente(user.attivo ? 'Attivo' : 'Disattivato', user.attivo ? 'is-active' : 'is-disabled'));
      row.appendChild(statusCell);

      const actions = document.createElement('td');
      actions.className = 'admin-user-actions';
      const active = document.createElement('button');
      active.type = 'button';
      active.className = user.attivo ? 'admin-user-disable' : 'admin-user-enable';
      active.textContent = user.attivo ? 'Disattiva' : 'Riattiva';
      active.addEventListener('click', async () => {
        active.disabled = true;
        try {
          await api('setActive', { uid: user.uid, active: !user.attivo });
          messaggio(userMessage, user.attivo ? 'Utente disattivato.' : 'Utente riattivato.');
          await renderUsers();
        } catch (error) {
          messaggio(userMessage, error.message, true);
          active.disabled = false;
        }
      });
      actions.append(active);
      row.appendChild(actions);
      userBody.appendChild(row);
    }
  }

  async function renderUsers() {
    if (!appIdentity.isAdmin()) { router.navigate('home'); return; }
    messaggio(userMessage, '');
    const { users } = await api('list');
    utentiCache = Array.isArray(users) ? users : [];
    aggiornaStatisticheUtenti();
    renderUserRows();
  }

  async function createUser(event) {
    event.preventDefault();
    if (!appIdentity.isAdmin()) return;
    const password = document.getElementById('admin-password');
    const submit = userForm.querySelector('[type=submit]'); submit.disabled = true;
    try {
      await api('create', {
        nome: document.getElementById('admin-nome').value,
        cognome: document.getElementById('admin-cognome').value,
        username: document.getElementById('admin-username').value,
        ruolo: document.getElementById('admin-ruolo').value,
        password: password.value
      });
      userForm.reset(); password.value = '';
      userForm.hidden = true; messaggio(userMessage, 'Account creato. La password iniziale non è stata salvata.');
      await renderUsers();
    } catch (error) { password.value = ''; messaggio(userMessage, error.message, true); }
    finally { submit.disabled = false; }
  }

  function renderWork() {
    const user = appIdentity.current();
    const visible = lavori.filter(({ record, modified }) => {
      if (filtro === 'created') return record.creato_da_uid === user.uid;
      if (filtro === 'modified') return modified;
      if (filtro === 'completed') return record.stato === 'completato';
      return record.creato_da_uid === user.uid || modified;
    });
    workList.replaceChildren();
    workEmpty.hidden = visible.length > 0;
    for (const { record } of visible) {
      const li = document.createElement('li'); li.className = 'storico-voce';
      const info = document.createElement('div'); info.className = 'storico-info';
      const title = document.createElement('strong'); title.textContent = record.punto_vendita || 'Sopralluogo';
      const line = document.createElement('span'); line.textContent = `${record.indirizzo_punto_vendita || ''} · ${record.data_sopralluogo || record.data || ''} · ${record.stato || 'in corso'}`;
      const creator = document.createElement('span'); creator.textContent = `Creato da: ${record.creato_da_nome || 'Dato precedente al sistema account'}`;
      const last = document.createElement('span'); last.textContent = `Ultima modifica: ${record.aggiornato_il || ''} · ${record.ultimo_aggiornamento_da_nome || 'Dato precedente al sistema account'}`;
      info.append(title, line, creator, last); li.appendChild(info); workList.appendChild(li);
    }
  }

  async function loadWork() {
    if (!appIdentity.isAdmin()) { router.navigate('home'); return; }
    const user = appIdentity.current(); if (!user) return;
    const records = await db.elencaTuttiSopralluoghi();
    const modifiedIds = new Set(records.filter(r => r.ultimo_aggiornamento_da_uid === user.uid).map(r => r.id));
    try {
      if (navigator.onLine) {
        const snapshot = await firebaseClient.firestore().collection('attivita').where('uid', '==', user.uid).get();
        snapshot.forEach(doc => modifiedIds.add(doc.data().sopralluogo_id));
      }
    } catch (error) { console.warn('Audit attività non disponibile; uso l’outbox locale.', error); }
    for (const item of await (db.leggiImpostazione('audit_pending') || [])) {
      if (item.uid === user.uid) modifiedIds.add(item.sopralluogo_id);
    }
    lavori = records.filter(r => !r.eliminato_il && !r.eliminato_definitivamente).map(record => ({ record, modified: modifiedIds.has(record.id) }));
    renderWork();
  }

  function init() {
    document.getElementById('admin-nuovo-utente').addEventListener('click', () => { userForm.hidden = false; userMessage.hidden = true; });
    userSearch.addEventListener('input', renderUserRows);
    document.getElementById('admin-annulla-utente').addEventListener('click', () => { userForm.reset(); userForm.hidden = true; });
    userForm.addEventListener('submit', createUser);
    router.onEnter('admin-users', renderUsers);
    router.onEnter('my-work', loadWork);
    document.querySelectorAll('[data-my-work-filter]').forEach(button => button.addEventListener('click', () => {
      filtro = button.dataset.myWorkFilter;
      document.querySelectorAll('[data-my-work-filter]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
      renderWork();
    }));
    document.getElementById('btn-area-utenti').addEventListener('click', () => {
      if (!appIdentity.isAdmin()) router.navigate('home');
    });
  }
  return { init, loadWork };
})();
