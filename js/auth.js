/** Firebase Authentication entry point. Passwords are used only for the sign-in request. */
const appIdentity = (() => {
  const PROFILE_CACHE = 'safety-checklist-profile-v1';
  const login = document.getElementById('login-view');
  const screens = document.getElementById('screens');
  const session = document.getElementById('utente-sessione');
  const sessionText = document.getElementById('utente-sessione-dettaglio');
  const message = document.getElementById('login-messaggio');
  const form = document.getElementById('login-form');
  const passwordInput = document.getElementById('login-password');
  const submit = document.getElementById('login-submit');
  const usersLink = document.getElementById('btn-area-utenti');
  let profile = null;
  let logoutMessage = '';
  let readyResolve;
  const readyPromise = new Promise(resolve => { readyResolve = resolve; });
  let initialSettled = false;

  function normalizzaUsername(value) {
    const username = String(value || '').trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9._-]{1,38}[a-z0-9]$/.test(username) || username.includes('..')) {
      throw new Error('Inserisci uno username valido.');
    }
    return username;
  }

  function emailInterna(username) {
    return `${normalizzaUsername(username)}@safetychecklist.local`;
  }

  function profiloInCache(uid) {
    try {
      const value = JSON.parse(localStorage.getItem(PROFILE_CACHE) || 'null');
      return value?.uid === uid && value.attivo === true ? value : null;
    } catch (_) { return null; }
  }

  function salvaProfiloInCache(value) {
    localStorage.setItem(PROFILE_CACHE, JSON.stringify({
      uid: value.uid, username: value.username, nome: value.nome, cognome: value.cognome,
      ruolo: value.ruolo, attivo: value.attivo
    }));
  }

  function mostraLogin(text = '') {
    profile = null;
    document.body.dataset.authenticated = 'false';
    screens.hidden = true;
    login.hidden = false;
    session.hidden = true;
    document.getElementById('stato-connessione').hidden = true;
    usersLink.hidden = true;
    document.body.dataset.authReady = 'true';
    message.textContent = text;
    message.hidden = !text;
  }

  function mostraApp(value) {
    profile = value;
    document.body.dataset.authenticated = 'true';
    login.hidden = true;
    screens.hidden = false;
    session.hidden = false;
    document.getElementById('stato-connessione').hidden = false;
    usersLink.hidden = value.ruolo !== 'admin';
    sessionText.textContent = `${value.nome} ${value.cognome} · ${value.ruolo === 'admin' ? 'Admin' : 'Tecnico'}`;
    document.body.dataset.authReady = 'true';
    message.textContent = '';
    message.hidden = true;
    window.dispatchEvent(new CustomEvent('account:authenticated', { detail: { profile: value } }));
  }

  async function caricaProfilo(user) {
    const cached = profiloInCache(user.uid);
    if (!navigator.onLine) return cached;
    try {
      const status = await callEndpoint('sessionStatus');
      if (!status.active) return { disattivato: true };
      const snapshot = await firebaseClient.firestore().collection('utenti').doc(user.uid).get({ source: 'server' });
      if (!snapshot.exists) return null;
      const remote = snapshot.data();
      if (remote.uid !== user.uid || remote.attivo !== true || !['admin', 'tecnico'].includes(remote.ruolo)) {
        return remote.attivo === false ? { disattivato: true } : null;
      }
      const valid = { ...remote, uid: user.uid };
      salvaProfiloInCache(valid);
      return valid;
    } catch (error) {
      if (cached && (error.code === 'unavailable' || !navigator.onLine || !error.status || error.status >= 500)) return cached;
      throw error;
    }
  }

  async function callEndpoint(action, body = {}) {
    const user = firebase.auth().currentUser;
    const response = await fetch(USER_ADMIN_ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${await user.getIdToken()}` }, body: JSON.stringify({ action, ...body }) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(result.error || 'Richiesta non riuscita.'), { status: response.status });
    return result;
  }

  async function applicaAuthState(user) {
    if (!user) {
      localStorage.removeItem(PROFILE_CACHE);
      mostraLogin(logoutMessage);
      logoutMessage = '';
      if (!initialSettled) { initialSettled = true; readyResolve(null); }
      return;
    }
    try {
      const value = await caricaProfilo(user);
      if (value?.disattivato) {
        localStorage.removeItem(PROFILE_CACHE);
        logoutMessage = 'Account disattivato. Contatta l’amministratore.';
        await firebase.auth().signOut();
        mostraLogin(logoutMessage);
      } else if (value) {
        mostraApp(value);
      } else {
        localStorage.removeItem(PROFILE_CACHE);
        logoutMessage = navigator.onLine ? 'Profilo utente non disponibile. Contatta l’amministratore.' : 'Connettiti per verificare il tuo account.';
        await firebase.auth().signOut();
        mostraLogin(logoutMessage);
      }
    } catch (error) {
      const cached = profiloInCache(user.uid);
      if (error.status === 401 || error.status === 403 || error.code === 'auth/user-disabled') {
        logoutMessage = 'Account disattivato. Contatta l’amministratore.';
        await firebase.auth().signOut().catch(() => {});
        mostraLogin(logoutMessage);
      } else if (cached && (!navigator.onLine || error.code === 'unavailable' || !error.status || error.status >= 500)) mostraApp(cached);
      else { mostraLogin('Impossibile verificare l’account. Riprova quando la connessione è disponibile.'); }
    } finally {
      if (!initialSettled) { initialSettled = true; readyResolve(profile); }
    }
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    let username;
    try { username = normalizzaUsername(document.getElementById('login-username').value); }
    catch (error) { mostraLogin(error.message); return; }
    submit.disabled = true;
    message.hidden = true;
    try {
      await firebase.auth().signInWithEmailAndPassword(emailInterna(username), passwordInput.value);
      passwordInput.value = '';
      const user = firebase.auth().currentUser;
      const value = await caricaProfilo(user);
      if (value?.disattivato) {
        localStorage.removeItem(PROFILE_CACHE);
        logoutMessage = 'Account disattivato. Contatta l’amministratore.';
        await firebase.auth().signOut();
        mostraLogin(logoutMessage);
      } else if (value) {
        mostraApp(value);
      } else {
        logoutMessage = 'Credenziali non valide.';
        await firebase.auth().signOut();
        mostraLogin(logoutMessage);
      }
    } catch (error) {
      passwordInput.value = '';
      if (error.code === 'auth/user-disabled') {
        logoutMessage = 'Account disattivato. Contatta l’amministratore.';
        mostraLogin(logoutMessage);
        return;
      }
      if (error.status === 401 || error.status === 403) {
        logoutMessage = 'Credenziali non valide.';
        await firebase.auth().signOut().catch(() => {});
      }
      const authError = ['auth/invalid-credential', 'auth/user-not-found', 'auth/wrong-password', 'auth/too-many-requests'].includes(error.code);
      mostraLogin(error.message === 'Inserisci uno username valido.' ? error.message
        : authError || error.status === 401 || error.status === 403 ? 'Credenziali non valide.'
        : 'Impossibile verificare l’account. Riprova quando la connessione è disponibile.');
    } finally { submit.disabled = false; }
  });

  const passwordDialog = document.getElementById('dialog-cambia-password');
  const passwordForm = document.getElementById('form-cambia-password');
  const passwordMessage = document.getElementById('password-messaggio');
  document.getElementById('btn-cambia-password').addEventListener('click', () => {
    passwordForm.reset(); passwordMessage.hidden = true; passwordDialog.showModal();
  });
  document.getElementById('annulla-cambia-password').addEventListener('click', () => { passwordForm.reset(); passwordDialog.close(); });
  passwordForm.addEventListener('submit', async event => {
    event.preventDefault();
    const user = firebase.auth().currentUser;
    const current = document.getElementById('password-attuale').value;
    const next = document.getElementById('password-nuova').value;
    const confirm = document.getElementById('password-conferma').value;
    passwordMessage.hidden = false;
    if (!user || !user.email) { passwordMessage.textContent = 'Sessione scaduta.'; return; }
    if (next.length < 12) { passwordMessage.textContent = 'La nuova password deve avere almeno 12 caratteri.'; return; }
    if (next !== confirm) { passwordMessage.textContent = 'Le nuove password non coincidono.'; return; }
    try {
      const credential = firebase.auth.EmailAuthProvider.credential(user.email, current);
      await user.reauthenticateWithCredential(credential);
      await user.updatePassword(next);
      passwordForm.reset(); passwordMessage.textContent = 'Password aggiornata.';
      setTimeout(() => passwordDialog.close(), 700);
    } catch (error) {
      passwordMessage.textContent = ['auth/wrong-password','auth/invalid-credential'].includes(error.code) ? 'Password attuale non corretta.' : 'Impossibile aggiornare la password.';
    }
  });

  document.getElementById('btn-esci').addEventListener('click', async () => {
    localStorage.removeItem(PROFILE_CACHE);
    await firebase.auth().signOut();
    mostraLogin();
  });

  async function ricontrollaAccount() {
    const user = firebase.auth().currentUser;
    if (!user || !navigator.onLine) return;
    try {
      if (!profile) { await applicaAuthState(user); return; }
      const status = await callEndpoint('sessionStatus');
      if (!status.active) {
        localStorage.removeItem(PROFILE_CACHE);
        logoutMessage = 'Account disattivato. Contatta l’amministratore.';
        await firebase.auth().signOut();
        mostraLogin(logoutMessage);
      }
    } catch (error) {
      if (error.status === 401 || error.status === 403) {
        localStorage.removeItem(PROFILE_CACHE);
        logoutMessage = 'Account disattivato. Contatta l’amministratore.';
        await firebase.auth().signOut().catch(() => {});
        mostraLogin(logoutMessage);
      }
      /* A transient outage must not evict a verified offline session. */
    }
  }
  window.addEventListener('online', ricontrollaAccount);
  window.addEventListener('focus', ricontrollaAccount);
  window.setInterval(ricontrollaAccount, 5 * 60 * 1000);

  // Prepara App + Firestore (incluse le settings WebKit) prima che Auth possa avviare
  // la prima lettura del profilo. Evita 'settings can no longer be changed' su Safari/WebKit.
  firebaseClient.initApp();
  firebaseClient.firestore();
  firebase.auth().setPersistence(firebase.auth.Auth.Persistence.LOCAL)
    .then(() => firebase.auth().onAuthStateChanged(applicaAuthState))
    .catch(error => { mostraLogin('Impossibile avviare la sessione. Riprova.'); console.error('Auth init', error); if (!initialSettled) { initialSettled = true; readyResolve(null); } });

  return {
    ready: () => readyPromise,
    current: () => profile,
    isAdmin: () => profile?.ruolo === 'admin',
    normalizzaUsername,
    endpoint: USER_ADMIN_ENDPOINT,
    async token() { const user = firebase.auth().currentUser; if (!user) throw new Error('Sessione scaduta.'); return user.getIdToken(); },
    async callAdmin(action, body = {}) { return callEndpoint(action, body); }
  };
})();
