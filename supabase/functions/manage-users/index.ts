const FIREBASE_API_KEY = "AIzaSyAdgCc8TQ1TVfF8l0NMxtm7NS95ZOl4lCA";
const FIREBASE_PROJECT_ID = "safety-checklist-colligo";
const FIREBASE_AUTH = "https://identitytoolkit.googleapis.com/v1";
const FIRESTORE = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents`;
const ALLOWED_ORIGINS = new Set([
  "https://leo12testa-jpg.github.io",
  "http://127.0.0.1:4173",
  "http://localhost:4173",
]);

function cors(req: Request) {
  const origin = req.headers.get("origin") || "";
  return {
    "access-control-allow-origin": ALLOWED_ORIGINS.has(origin) ? origin : "https://leo12testa-jpg.github.io",
    "access-control-allow-headers": "authorization, content-type",
    "access-control-allow-methods": "POST, OPTIONS",
    "content-type": "application/json",
    "vary": "Origin",
  };
}
function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: cors(req) });
}
function text(value: unknown, label: string, max = 80) {
  const out = String(value ?? "").trim();
  if (!out || out.length > max) throw Object.assign(new Error(`${label} non valido.`), { status: 400 });
  return out;
}
function usernameOf(value: unknown) {
  const out = String(value ?? "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{1,38}[a-z0-9]$/.test(out) || out.includes("..")) {
    throw Object.assign(new Error("Username non valido."), { status: 400 });
  }
  return out;
}
const emailOf = (username: string) => `${usernameOf(username)}@safetychecklist.local`;
function authHeader(token?: string) { return token ? { authorization: `Bearer ${token}` } : {}; }

async function firebaseLookup(idToken: string) {
  const response = await fetch(`${FIREBASE_AUTH}/accounts:lookup?key=${FIREBASE_API_KEY}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ idToken })
  });
  if (!response.ok) throw Object.assign(new Error("Sessione non valida."), { status: 401 });
  const data = await response.json();
  const user = data.users?.[0];
  if (!user?.localId) throw Object.assign(new Error("Sessione non valida."), { status: 401 });
  return { uid: user.localId as string, email: String(user.email || "") };
}

function fromValue(value: any): any {
  if (!value || typeof value !== "object") return null;
  if ("stringValue" in value) return value.stringValue;
  if ("booleanValue" in value) return value.booleanValue;
  if ("timestampValue" in value) return value.timestampValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return value.doubleValue;
  if ("nullValue" in value) return null;
  return null;
}
function fromDoc(doc: any) {
  const out: Record<string, any> = {};
  for (const [key, value] of Object.entries(doc?.fields || {})) out[key] = fromValue(value);
  out.uid ||= String(doc?.name || "").split("/").pop() || "";
  return out;
}
function toFields(obj: Record<string, any>) {
  const fields: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === "string") fields[key] = { stringValue: value };
    else if (typeof value === "boolean") fields[key] = { booleanValue: value };
    else if (typeof value === "number" && Number.isInteger(value)) fields[key] = { integerValue: String(value) };
    else if (value === null) fields[key] = { nullValue: null };
  }
  return fields;
}

async function getProfile(uid: string, token?: string) {
  const response = await fetch(`${FIRESTORE}/utenti/${encodeURIComponent(uid)}`, { headers: authHeader(token) });
  if (response.status === 404 || response.status === 403 || response.status === 401) return null;
  if (!response.ok) throw Object.assign(new Error("Profilo utente non disponibile."), { status: response.status });
  return fromDoc(await response.json());
}
async function listProfiles(token: string) {
  const response = await fetch(`${FIRESTORE}/utenti?pageSize=100`, { headers: authHeader(token) });
  if (!response.ok) throw Object.assign(new Error("Elenco utenti non disponibile."), { status: response.status });
  const data = await response.json();
  return (data.documents || []).map(fromDoc).sort((a: any, b: any) => `${a.cognome} ${a.nome}`.localeCompare(`${b.cognome} ${b.nome}`, "it"));
}
async function putProfile(uid: string, profile: Record<string, any>, token?: string) {
  const now = new Date().toISOString();
  const response = await fetch(`${FIRESTORE}/utenti/${encodeURIComponent(uid)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", ...authHeader(token) },
    body: JSON.stringify({ fields: {
      ...toFields(profile),
      creato_il: { timestampValue: profile.creato_il || now },
      aggiornato_il: { timestampValue: now },
    }})
  });
  if (!response.ok) {
    const details = await response.text();
    throw Object.assign(new Error(`Impossibile salvare il profilo (${response.status}).`), { status: response.status, details });
  }
  return fromDoc(await response.json());
}
async function setActive(uid: string, active: boolean, token: string) {
  const now = new Date().toISOString();
  const url = `${FIRESTORE}/utenti/${encodeURIComponent(uid)}?updateMask.fieldPaths=attivo&updateMask.fieldPaths=aggiornato_il`;
  const response = await fetch(url, {
    method: "PATCH", headers: { "content-type": "application/json", ...authHeader(token) },
    body: JSON.stringify({ fields: { attivo: { booleanValue: active }, aggiornato_il: { timestampValue: now } } })
  });
  if (!response.ok) throw Object.assign(new Error("Impossibile aggiornare l'utente."), { status: response.status });
}
async function signup(username: string, password: string, nome: string, cognome: string) {
  const response = await fetch(`${FIREBASE_AUTH}/accounts:signUp?key=${FIREBASE_API_KEY}`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: emailOf(username), password, displayName: `${nome} ${cognome}`, returnSecureToken: true })
  });
  const data = await response.json();
  if (!response.ok) {
    const code = String(data?.error?.message || "");
    const status = code.includes("EMAIL_EXISTS") ? 409 : 400;
    throw Object.assign(new Error(code.includes("EMAIL_EXISTS") ? "Username già utilizzato." : "Impossibile creare l'account."), { status, firebase: code });
  }
  return { uid: data.localId as string, idToken: data.idToken as string };
}
async function deleteSelf(idToken: string) {
  await fetch(`${FIREBASE_AUTH}/accounts:delete?key=${FIREBASE_API_KEY}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ idToken })
  }).catch(() => {});
}

async function caller(req: Request) {
  const header = req.headers.get("authorization") || "";
  if (!header.startsWith("Bearer ")) throw Object.assign(new Error("Non autorizzato."), { status: 401 });
  const token = header.slice(7);
  const user = await firebaseLookup(token);
  return { ...user, token };
}
async function requireAdmin(req: Request) {
  const user = await caller(req);
  const profile = await getProfile(user.uid, user.token);
  if (!profile || profile.attivo !== true || profile.ruolo !== "admin") throw Object.assign(new Error("Operazione riservata agli amministratori."), { status: 403 });
  return { ...user, profile };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });
  if (req.method !== "POST") return json(req, { error: "Metodo non consentito." }, 405);
  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "");
    if (action === "sessionStatus") {
      const user = await caller(req);
      const profile = await getProfile(user.uid, user.token);
      return json(req, { active: !!profile && profile.attivo === true });
    }
    const admin = await requireAdmin(req);
    if (action === "list") return json(req, { users: await listProfiles(admin.token) });
    if (action === "create") {
      const username = usernameOf(body.username), nome = text(body.nome, "Nome"), cognome = text(body.cognome, "Cognome");
      const ruolo = body.ruolo === "admin" ? "admin" : body.ruolo === "tecnico" ? "tecnico" : null;
      const password = String(body.password || "");
      if (!ruolo || password.length < 12 || password.length > 128) throw Object.assign(new Error("Ruolo o password non validi (minimo 12 caratteri)."), { status: 400 });
      const existing = await listProfiles(admin.token);
      if (existing.some((u: any) => u.username === username)) throw Object.assign(new Error("Username già utilizzato."), { status: 409 });
      const created = await signup(username, password, nome, cognome);
      try {
        const profile = await putProfile(created.uid, { uid: created.uid, username, nome, cognome, ruolo, attivo: true }, admin.token);
        return json(req, { user: profile });
      } catch (error) { await deleteSelf(created.idToken); throw error; }
    }
    if (action === "setActive") {
      const uid = text(body.uid, "Utente", 160), active = body.active === true;
      if (uid === admin.uid && !active) throw Object.assign(new Error("Non puoi disattivare il tuo account mentre sei collegato."), { status: 400 });
      const users = await listProfiles(admin.token), target = users.find((u: any) => u.uid === uid);
      if (!target) throw Object.assign(new Error("Utente non trovato."), { status: 404 });
      if (!active && target.ruolo === "admin" && target.attivo === true) {
        const activeAdmins = users.filter((u: any) => u.ruolo === "admin" && u.attivo === true);
        if (activeAdmins.length < 2) throw Object.assign(new Error("Crea un secondo admin prima di disattivare l'unico amministratore."), { status: 400 });
      }
      await setActive(uid, active, admin.token);
      return json(req, { uid, active });
    }
    throw Object.assign(new Error("Operazione non riconosciuta."), { status: 400 });
  } catch (error: any) {
    return json(req, { error: error?.message || "Richiesta non valida." }, Number(error?.status) || 400);
  }
});
