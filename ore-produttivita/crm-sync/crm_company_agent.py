import asyncio
import base64
import getpass
import hashlib
import html
import json
import os
import re
import sys
import urllib.error
import urllib.request
import zlib
from datetime import date
from pathlib import Path
from urllib.parse import urlencode

import keyring
from playwright.async_api import async_playwright

FIREBASE_API_KEY = "AIzaSyAdgCc8TQ1TVfF8l0NMxtm7NS95ZOl4lCA"
FIREBASE_SIGNIN = f"https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key={FIREBASE_API_KEY}"
FIREBASE_REFRESH = f"https://securetoken.googleapis.com/v1/token?key={FIREBASE_API_KEY}"
APP_API = "https://twznfiygzzbqdgudpwav.supabase.co/functions/v1/ore-produttivita-api"
AGENDA_URL = "https://crm.colligoingegneria.it/intrasofter/intraplan/plage000.asp"
KEYRING_SERVICE = "ColligoOreProduttivita"
CRM_STATE_KEY = "company-crm-browser-state"
CRM_SESSION_KEY = "company-crm-session-storage"

class LoginRequiredError(RuntimeError):
    pass

APP_DIR = Path(os.environ.get("LOCALAPPDATA", Path.home())) / "ColligoOreProduttivita"
CONFIG_FILE = APP_DIR / "company-agent.json"
PROFILE_DIR = APP_DIR / "crm-company-browser"
STATUS_FILE = APP_DIR / "company-agent-status.json"
TIME_RE = re.compile(r"\b([01]?\d|2[0-3]):([0-5]\d)\b")
WORK_RE = re.compile(r"\b(\d{1,2}[A-IL-P])\b", re.I)
OLD_SHORT_RE = re.compile(r"\b(\d{2}\.\d{2})(?:-([A-Z]))?\b", re.I)
COMM_RE = re.compile(r"\b(CM\d{5,})\b", re.I)

MUTEX_NAME = "Local\\ColligoOreProduttivitaCompanyAgent"


def acquire_run_mutex():
    """Return Windows mutex handle, or None if another cycle is already running."""
    if os.name != "nt":
        return True
    import ctypes
    kernel32 = ctypes.windll.kernel32
    handle = kernel32.CreateMutexW(None, False, MUTEX_NAME)
    if not handle:
        raise RuntimeError("Impossibile creare il lock dell'agente CRM.")
    # ERROR_ALREADY_EXISTS
    if kernel32.GetLastError() == 183:
        kernel32.CloseHandle(handle)
        return None
    return handle


def release_run_mutex(handle):
    if os.name == "nt" and handle not in (None, True):
        try:
            import ctypes
            ctypes.windll.kernel32.CloseHandle(handle)
        except Exception:
            pass



def write_status(state, message, extra=None):
    APP_DIR.mkdir(parents=True, exist_ok=True)
    payload = {
        "state": state,
        "message": message,
        "updatedAt": __import__("datetime").datetime.now().astimezone().isoformat(timespec="seconds")
    }
    if extra:
        payload.update(extra)
    STATUS_FILE.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def post_json(url, payload, token=None):
    data = json.dumps(payload).encode("utf-8")
    headers = {"content-type": "application/json"}
    if token:
        headers["authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=120) as res:
            raw = res.read().decode("utf-8")
            return res.status, json.loads(raw) if raw else {}
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        try:
            detail = json.loads(raw)
        except Exception:
            detail = {"error": raw}
        return exc.code, detail


def post_form(url, payload):
    req = urllib.request.Request(
        url,
        data=urlencode(payload).encode("utf-8"),
        headers={"content-type": "application/x-www-form-urlencoded"},
        method="POST"
    )
    try:
        with urllib.request.urlopen(req, timeout=90) as res:
            return res.status, json.loads(res.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        try:
            detail = json.loads(raw)
        except Exception:
            detail = {"error": raw}
        return exc.code, detail


def firebase_login(username, password):
    email = f"{username.strip().lower()}@safetychecklist.local"
    status, body = post_json(FIREBASE_SIGNIN, {
        "email": email,
        "password": password,
        "returnSecureToken": True
    })
    if status >= 300 or not body.get("idToken"):
        raise RuntimeError("Credenziali Ore & Produttività non valide.")
    return body["idToken"], body.get("refreshToken")


def firebase_refresh(refresh_token):
    status, body = post_form(FIREBASE_REFRESH, {
        "grant_type": "refresh_token",
        "refresh_token": refresh_token
    })
    token = body.get("id_token") or body.get("idToken")
    refresh = body.get("refresh_token") or refresh_token
    if status >= 300 or not token:
        raise RuntimeError("Sessione Ore & Produttività scaduta.")
    return token, refresh


def app_token(username, interactive=False):
    cached = None
    try:
        cached = keyring.get_password(KEYRING_SERVICE, "company:" + username)
    except Exception:
        pass
    if cached:
        try:
            token, refresh = firebase_refresh(cached)
            if refresh != cached:
                keyring.set_password(KEYRING_SERVICE, "company:" + username, refresh)
            return token
        except Exception:
            try:
                keyring.delete_password(KEYRING_SERVICE, "company:" + username)
            except Exception:
                pass
    if not interactive:
        raise RuntimeError("Sessione app non configurata. Esegui di nuovo SETUP_SYNC_BACKGROUND.bat.")
    password = getpass.getpass("Password Ore & Produttività (solo questa volta): ")
    token, refresh = firebase_login(username, password)
    if refresh:
        keyring.set_password(KEYRING_SERVICE, "company:" + username, refresh)
    return token


def api(token, action, **payload):
    status, body = post_json(APP_API, {"action": action, **payload}, token)
    if status >= 300:
        raise RuntimeError(body.get("error", f"Errore API {status}."))
    return body


def secure_store_set(key, value):
    raw = str(value or "").encode("utf-8")
    packed = base64.b64encode(zlib.compress(raw, 9)).decode("ascii")
    chunk_size = 900
    chunks = [packed[i:i+chunk_size] for i in range(0, len(packed), chunk_size)] or [""]
    try:
        old_count = int(keyring.get_password(KEYRING_SERVICE, key + ":count") or "0")
    except Exception:
        old_count = 0

    keyring.set_password(KEYRING_SERVICE, key + ":count", str(len(chunks)))
    for i, chunk in enumerate(chunks):
        keyring.set_password(KEYRING_SERVICE, f"{key}:{i}", chunk)

    for i in range(len(chunks), old_count):
        try:
            keyring.delete_password(KEYRING_SERVICE, f"{key}:{i}")
        except Exception:
            pass

    try:
        keyring.delete_password(KEYRING_SERVICE, key)
    except Exception:
        pass


def secure_store_get(key):
    try:
        count = int(keyring.get_password(KEYRING_SERVICE, key + ":count") or "0")
    except Exception:
        count = 0

    if count > 0:
        parts = []
        for i in range(count):
            part = keyring.get_password(KEYRING_SERVICE, f"{key}:{i}")
            if part is None:
                return None
            parts.append(part)
        try:
            packed = "".join(parts)
            return zlib.decompress(base64.b64decode(packed.encode("ascii"))).decode("utf-8")
        except Exception:
            return None

    # Compatibilita con eventuali salvataggi precedenti a blocco singolo.
    return keyring.get_password(KEYRING_SERVICE, key)


async def save_crm_auth(context, page):
    state = await context.storage_state()
    secure_store_set(CRM_STATE_KEY, json.dumps(state, ensure_ascii=False))
    try:
        session_data = await page.evaluate("""() => {
          const out = {};
          for (let i = 0; i < sessionStorage.length; i++) {
            const key = sessionStorage.key(i);
            out[key] = sessionStorage.getItem(key);
          }
          return out;
        }""")
    except Exception:
        session_data = {}
    secure_store_set(CRM_SESSION_KEY, json.dumps(session_data or {}, ensure_ascii=False))


def load_crm_state():
    raw = secure_store_get(CRM_STATE_KEY)
    if not raw:
        return None
    try:
        value = json.loads(raw)
        return value if isinstance(value, dict) else None
    except Exception:
        return None


async def restore_crm_session_storage(context):
    raw = secure_store_get(CRM_SESSION_KEY)
    if not raw:
        return
    try:
        data = json.loads(raw)
    except Exception:
        data = {}
    if not isinstance(data, dict) or not data:
        return
    script = """(data) => {
      if (location.origin !== 'https://crm.colligoingegneria.it') return;
      for (const [key, value] of Object.entries(data || {})) {
        try { sessionStorage.setItem(key, value); } catch (_) {}
      }
    }"""
    await context.add_init_script(f"({script})({json.dumps(data, ensure_ascii=False)});")


async def login_visible(page):
    for frame in page.frames:
        try:
            found = await frame.evaluate(r"""() => {
              const visible = el => {
                if(!el) return false;
                const s=getComputedStyle(el), r=el.getBoundingClientRect();
                return s.display!=='none' && s.visibility!=='hidden' && r.width>0 && r.height>0;
              };
              const pwd=document.querySelector('input[type="password"]');
              const usr=document.querySelector('input[name*="user" i],input[id*="user" i]');
              return visible(pwd) && visible(usr);
            }""")
            if found:
                return True
        except Exception:
            pass
    return False


async def wait_login(page):
    print("\nAccedi al CRM nella finestra Edge. Questa è l'unica configurazione visibile.")
    for _ in range(300):
        await page.wait_for_timeout(1000)
        if not await login_visible(page):
            await page.wait_for_timeout(1800)
            return
    raise RuntimeError("Login CRM non completato entro 5 minuti.")


def norm(v):
    return re.sub(r"\s+", " ", str(v or "").strip().casefold())


async def select_resource(page, name, sigla):
    targets = {"name": norm(name), "sigla": norm(sigla)}
    for frame in page.frames:
        try:
            hit = await frame.evaluate(r"""(targets) => {
              const norm = v => (v||'').toString().trim().toLocaleLowerCase('it-IT').replace(/\s+/g,' ');
              const visible = el => {
                if(!el) return false;
                const s=getComputedStyle(el), r=el.getBoundingClientRect();
                return s.display!=='none' && s.visibility!=='hidden' && r.width>0 && r.height>0;
              };
              const nameTarget=norm(targets.name), siglaTarget=norm(targets.sigla);
              const nodes=[...document.querySelectorAll('a,button,[onclick],[ondblclick],[role="button"],li,td,div,span')];
              let best=null, bestScore=-1;
              for(const node of nodes){
                if(!visible(node)) continue;
                const text=norm(node.innerText||node.textContent||'');
                if(!text || text.length>160) continue;
                let score=-1;
                if(nameTarget){
                  if(text===nameTarget) score=Math.max(score,120);
                  else if(nameTarget.length>=5 && text.includes(nameTarget)) score=Math.max(score,90);
                }
                if(siglaTarget){
                  if(text===siglaTarget) score=Math.max(score,80);
                  else if(siglaTarget.length>=2 && text.split(/[^a-z0-9]+/).includes(siglaTarget)) score=Math.max(score,55);
                }
                if(score<0) continue;
                const clicker=node.closest('a,button,[onclick],[ondblclick],[role="button"],li,td')||node;
                if(!visible(clicker)) continue;
                if(score>bestScore){best=clicker;bestScore=score;}
              }
              if(!best) return null;
              best.scrollIntoView({block:'nearest'});
              best.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,view:window}));
              return {score:bestScore,text:(best.innerText||best.textContent||'').trim().slice(0,160)};
            }""", targets)
            if hit:
                await page.wait_for_timeout(900)
                return True
        except Exception:
            pass
    return False


async def month_cells(page):
    result = {}
    for frame in page.frames:
        try:
            rows = await frame.evaluate(r"""() => {
              const visible = el => {
                if(!el) return false;
                const s=getComputedStyle(el), r=el.getBoundingClientRect();
                return s.display!=='none' && s.visibility!=='hidden' && r.width>0 && r.height>0;
              };
              const compact = v => (v||'').toString().replace(/\s+/g,' ').trim();
              const rich = el => {
                const parts=[];
                const add=v=>{v=compact(v);if(v&&!parts.includes(v))parts.push(v)};
                add(el.innerText);
                add(el.getAttribute?.('title'));
                add(el.getAttribute?.('aria-label'));
                add(el.getAttribute?.('data-title'));
                add(el.getAttribute?.('data-original-title'));
                add(el.getAttribute?.('data-tooltip'));
                return parts.join(' | ');
              };
              const hasPair = text => /Dalle\s+(?:[01]?\d|2[0-3]):[0-5]\d\s+Alle\s+(?:[01]?\d|2[0-3]):[0-5]\d/i.test(text||'');
              const out=[];

              for(const el of document.querySelectorAll('[data-giorno]')){
                const day=(el.getAttribute('data-giorno')||'').trim();
                if(!/^20\d{6}$/.test(day) || !visible(el)) continue;

                const candidates=[];
                for(const node of [el,...el.querySelectorAll('*')]){
                  if(!visible(node)) continue;
                  const text=rich(node);
                  if(hasPair(text)) candidates.push({node,text});
                }

                // Prefer the smallest event containers: a candidate is kept only if
                // none of its visible children already contains a complete Dalle/Alle pair.
                const minimal=candidates.filter(({node})=>{
                  for(const child of node.children||[]){
                    if(visible(child) && hasPair(rich(child))) return false;
                  }
                  return true;
                });

                const texts=[];
                const add=v=>{v=compact(v);if(v&&!texts.includes(v))texts.push(v)};
                for(const item of minimal) add(item.text);

                // Fallback for CRM variants where the whole day cell is the only node
                // carrying the hidden Dalle/Alle text.
                if(!texts.length) add(rich(el));
                if(texts.length) out.push({day,texts});
              }
              return out;
            }""")
            for row in rows or []:
                result.setdefault(row["day"], [])
                values = row.get("texts") or ([row.get("text")] if row.get("text") else [])
                for value in values:
                    if value and value not in result[row["day"]]:
                        result[row["day"]].append(value)
        except Exception:
            pass
    return result


def iso_day(day_key):
    return f"{day_key[0:4]}-{day_key[4:6]}-{day_key[6:8]}"


def clean_event_title(value):
    parts=[]
    seen=set()
    ignored={"impegno di gruppo","impegno gruppo"}
    for raw in str(value or "").split("|"):
        part=re.sub(r"\s+"," ",raw).strip(" -|")
        key=part.casefold()
        if not part or key in ignored or key in seen:
            continue
        seen.add(key)
        parts.append(part)
    return " | ".join(parts).strip()


def parse_day(texts, wanted, sigla):
    pattern = re.compile(
        r"Dalle\s+([01]?\d|2[0-3]):([0-5]\d)\s+Alle\s+"
        r"([01]?\d|2[0-3]):([0-5]\d)\s*"
        r"(.*?)(?=(?:\s*\|\s*)?Dalle\s+(?:[01]?\d|2[0-3]):[0-5]\d\s+Alle\s+(?:[01]?\d|2[0-3]):[0-5]\d|$)",
        re.I | re.S
    )
    out, seen = [], set()
    for raw in texts or []:
        text = re.sub(r"\s+", " ", html.unescape(str(raw or ""))).strip()
        for m in pattern.finditer(text):
            title = clean_event_title(m.group(5))
            if not title or len(title) > 500:
                continue
            sh, sm, eh, em = map(int, m.group(1,2,3,4))
            start=f"{wanted}T{sh:02d}:{sm:02d}:00"
            end=f"{wanted}T{eh:02d}:{em:02d}:00"
            minutes=(eh*60+em)-(sh*60+sm)
            if minutes<=0 or minutes>16*60:
                continue
            key=(start,end,title)
            if key in seen:
                continue
            seen.add(key)
            work=WORK_RE.search(title)
            old=OLD_SHORT_RE.search(title)
            comm=COMM_RE.search(title)
            stable=hashlib.sha1(f"{sigla}|{wanted}|{start}|{end}|{title}".encode()).hexdigest()[:24]
            out.append({
                "crmEventId":f"agenda-{stable}",
                "date":wanted,
                "start":start,
                "end":end,
                "minutes":minutes,
                "title":title,
                "shortCode":work.group(1).upper() if work else (old.group(0).upper() if old else ""),
                "codiceComm":comm.group(1).upper() if comm else ""
            })
    return out


def agenda_fingerprint(events):
    if not events:
        return ""
    canonical = [
        (str(x.get("date") or ""), str(x.get("start") or ""), str(x.get("end") or ""), str(x.get("title") or "").strip())
        for x in events
    ]
    canonical.sort()
    return hashlib.sha1(json.dumps(canonical, ensure_ascii=False).encode("utf-8")).hexdigest()


async def setup(username):
    token=app_token(username, interactive=True)
    resources=api(token,"crmResources").get("resources",[])
    if not resources:
        raise RuntimeError("Nessuna risorsa CRM disponibile o account non amministratore.")
    APP_DIR.mkdir(parents=True, exist_ok=True)
    CONFIG_FILE.write_text(json.dumps({"username":username},indent=2),encoding="utf-8")

    async with async_playwright() as p:
        browser=await p.chromium.launch_persistent_context(
            str(PROFILE_DIR),headless=False,channel="msedge",viewport={"width":1440,"height":950}
        )
        page=browser.pages[0] if browser.pages else await browser.new_page()
        await page.goto(AGENDA_URL,wait_until="domcontentloaded",timeout=60000)
        if await login_visible(page):
            await wait_login(page)
        await page.goto(AGENDA_URL,wait_until="domcontentloaded",timeout=60000)
        await page.wait_for_timeout(1800)
        if await login_visible(page):
            raise RuntimeError("Il CRM risulta ancora sulla schermata di accesso.")
        await save_crm_auth(browser, page)
        await browser.close()
    write_status("ready","Configurazione completata.",{"resources":len(resources)})
    print(f"Configurazione completata: {len(resources)} risorse CRM rilevate.")


async def run_once():
    if not CONFIG_FILE.exists():
        raise RuntimeError("Agente non configurato. Esegui SETUP_SYNC_BACKGROUND.bat.")
    username=json.loads(CONFIG_FILE.read_text(encoding="utf-8")).get("username","").strip()
    if not username:
        raise RuntimeError("Username agente mancante.")
    token=app_token(username, interactive=False)
    resources=api(token,"crmResources").get("resources",[])
    if not resources:
        raise RuntimeError("Nessuna risorsa CRM attiva.")

    api(token,"crmAgentHeartbeat",state="starting",message="Avvio sincronizzazione CRM aziendale.")
    write_status("running","Sincronizzazione in corso.",{"resources":len(resources)})
    today=date.today().strftime("%Y%m")
    events=[]
    scanned=[]
    failures=[]
    fingerprints={}

    crm_state=load_crm_state()
    if not crm_state:
        api(token,"crmAgentHeartbeat",state="login_required",message="Sessione CRM background non disponibile: rieseguire la configurazione.")
        raise LoginRequiredError("Sessione CRM background non disponibile.")

    async with async_playwright() as p:
        browser=await p.chromium.launch(headless=True,channel="msedge")
        context=await browser.new_context(
            storage_state=crm_state,
            viewport={"width":1440,"height":950}
        )
        await restore_crm_session_storage(context)
        page=await context.new_page()
        await page.goto(AGENDA_URL,wait_until="domcontentloaded",timeout=60000)
        await page.wait_for_timeout(1200)
        if await login_visible(page):
            await browser.close()
            api(token,"crmAgentHeartbeat",state="login_required",message="Sessione CRM scaduta: serve nuova configurazione.")
            raise LoginRequiredError("Sessione CRM scaduta: eseguire una volta SETUP_SYNC_BACKGROUND.bat.")

        for index, resource in enumerate(resources,1):
            sigla=str(resource.get("sigla_crm") or "").strip()
            name=str(resource.get("nome_crm") or resource.get("tecnico_nome") or sigla).strip()
            if not sigla:
                continue
            try:
                selected=await select_resource(page,name,sigla)
                if not selected:
                    failures.append({"sigla":sigla,"reason":"risorsa_non_trovata"})
                    continue
                cells=await month_cells(page)
                resource_events=[]
                for day_key,texts in cells.items():
                    if not day_key.startswith(today):
                        continue
                    resource_events.extend(parse_day(texts,iso_day(day_key),sigla))
                if len(resource_events)>120:
                    failures.append({"sigla":sigla,"reason":"troppi_eventi","count":len(resource_events)})
                    continue
                fingerprint=agenda_fingerprint(resource_events)
                if fingerprint:
                    same=fingerprints.setdefault(fingerprint,[])
                    if len(same)>=3:
                        failures.append({
                            "sigla":sigla,
                            "reason":"agenda_identica_sospetta",
                            "same_as":same[:3]
                        })
                        continue
                    same.append(sigla)

                for ev in resource_events:
                    ev["tecnicoSigla"]=sigla
                    ev["tecnicoNome"]=name
                events.extend(resource_events)
                scanned.append(sigla)

                if index % 4 == 0 or index == len(resources):
                    api(token,"crmAgentHeartbeat",
                        state="running",
                        message=f"Lettura CRM in corso: {index}/{len(resources)} risorse.",
                        scanned=len(scanned),
                        events=len(events),
                        failures=len(failures))
            except Exception as exc:
                failures.append({"sigla":sigla,"reason":str(exc)[:160]})
                if index % 4 == 0 or index == len(resources):
                    try:
                        api(token,"crmAgentHeartbeat",
                            state="running",
                            message=f"Lettura CRM in corso: {index}/{len(resources)} risorse.",
                            scanned=len(scanned),
                            events=len(events),
                            failures=len(failures))
                    except Exception:
                        pass

        await save_crm_auth(context, page)
        await browser.close()

    if len(events)>1500:
        api(token,"crmAgentHeartbeat",state="error",message=f"Lettura anomala: {len(events)} eventi complessivi.",scanned=len(scanned),events=len(events),failures=len(failures))
        raise RuntimeError(f"Lettura anomala: {len(events)} eventi complessivi.")

    result=api(token,"ingestAgendaCompany",events=events,scannedResources=scanned,date=date.today().isoformat())
    api(token,"crmAgentHeartbeat",
        state="ok",
        message="Sincronizzazione CRM aziendale completata.",
        scanned=len(scanned),
        events=len(events),
        saved=result.get("saved",0),
        failures=len(failures))
    write_status("ok","Sincronizzazione completata.",{
        "scanned":len(scanned),
        "events":len(events),
        "saved":result.get("saved",0),
        "unmatched":result.get("unmatched",0),
        "ambiguous":result.get("ambiguous",0),
        "failures":failures[:20]
    })


async def main():
    APP_DIR.mkdir(parents=True,exist_ok=True)
    args=sys.argv[1:]
    if "--setup" in args:
        username=""
        if "--username" in args:
            i=args.index("--username")
            if i+1<len(args):
                username=args[i+1].strip()
        if not username:
            username=input("Username amministratore Ore & Produttività: ").strip()
        if not username:
            raise RuntimeError("Username mancante.")
        await setup(username)
        return
    await run_once()


if __name__=="__main__":
    mutex=None
    try:
        if "--setup" not in sys.argv:
            mutex=acquire_run_mutex()
            if mutex is None:
                write_status("skipped","Sincronizzazione già in corso: nuovo avvio ignorato.")
                sys.exit(0)
        asyncio.run(main())
    except Exception as exc:
        login_required=isinstance(exc, LoginRequiredError)
        write_status("login_required" if login_required else "error",str(exc))
        if "--setup" not in sys.argv and not login_required:
            try:
                if CONFIG_FILE.exists():
                    username=json.loads(CONFIG_FILE.read_text(encoding="utf-8")).get("username","").strip()
                    if username:
                        token=app_token(username, interactive=False)
                        api(token,"crmAgentHeartbeat",state="error",message=str(exc)[:300])
            except Exception:
                pass
        if "--setup" in sys.argv:
            print("\nERRORE:",exc)
            input("\nPremi INVIO per chiudere.")
        sys.exit(2 if login_required else 1)
    finally:
        release_run_mutex(mutex)
