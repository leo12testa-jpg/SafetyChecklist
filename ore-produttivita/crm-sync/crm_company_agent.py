import asyncio
import getpass
import hashlib
import html
import json
import os
import re
import sys
import urllib.error
import urllib.request
from datetime import date
from pathlib import Path
from urllib.parse import urlencode, urlparse, parse_qs
from crm_time import crm_segments
from crm_recovery import recovery_plan,combine_reads,merge_preview,annotate_preview

import keyring
from cryptography.fernet import Fernet, InvalidToken
from playwright.async_api import async_playwright

FIREBASE_API_KEY = "AIzaSyAdgCc8TQ1TVfF8l0NMxtm7NS95ZOl4lCA"
FIREBASE_SIGNIN = f"https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key={FIREBASE_API_KEY}"
FIREBASE_REFRESH = f"https://securetoken.googleapis.com/v1/token?key={FIREBASE_API_KEY}"
APP_API = "https://twznfiygzzbqdgudpwav.supabase.co/functions/v1/ore-produttivita-api"
AGENDA_URL = "https://crm.colligoingegneria.it/intrasofter/intraplan/plage000.asp"
KEYRING_SERVICE = "ColligoOreProduttivita"
CRM_FILE_KEY = "company-crm-file-key"

class LoginRequiredError(RuntimeError):
    pass

class PartialReadError(RuntimeError):
    pass

AGENT_VERSION="20261007-startup-recovery"

APP_DIR = Path(os.environ.get("LOCALAPPDATA", Path.home())) / "ColligoOreProduttivita"
CONFIG_FILE = APP_DIR / "company-agent.json"
PROFILE_DIR = APP_DIR / "crm-company-browser"
STATUS_FILE = APP_DIR / "company-agent-status.json"
CRM_AUTH_FILE = APP_DIR / "crm-auth.bin"
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
    if state in ('ok','partial','recovery_pending','login_required','error','skipped'):
        record={key:payload.get(key) for key in ('updatedAt','state','scanned','total','scannedResources','readRanges','failures','saved')}
        record['agentVersion']=AGENT_VERSION
        record['scanned']=payload.get('scanned',0)
        record['scannedResources']=payload.get('scannedResources',[])
        cycle_log=APP_DIR/'company-agent-cycles.jsonl'
        if state=='login_required' and cycle_log.exists():
            for line in reversed(cycle_log.read_text(encoding='utf-8').splitlines()):
                try:previous=json.loads(line)
                except ValueError:continue
                if previous.get('scanned',0)>0:
                    dt=__import__('datetime').datetime
                    record['lastSuccessfulReadAt']=previous['updatedAt']
                    record['minutesSinceLastSuccessfulRead']=round((dt.fromisoformat(payload['updatedAt'])-dt.fromisoformat(previous['updatedAt'])).total_seconds()/60,2)
                    break
        with cycle_log.open('a',encoding='utf-8') as log:
            log.write(json.dumps(record,ensure_ascii=False)+'\n')
        if (APP_DIR/'workday-trial.json').exists():
            try:
                from crm_workday_trial import workday_report,ROME
                trial=json.loads((APP_DIR/'workday-trial.json').read_text(encoding='utf-8'))
                rows=[json.loads(line) for line in cycle_log.read_text(encoding='utf-8').splitlines() if line.strip()]
                rows=sorted((r for r in rows if r.get('agentVersion')==trial['agentVersion']),key=lambda r:r['updatedAt'])
                atomic_json(APP_DIR/'workday-trial-report.json',workday_report(rows,trial['day'],__import__('datetime').datetime.now(ROME)))
            except (ValueError,KeyError,OSError):pass  # Reporting cannot block the CRM read.


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


def crm_file_cipher():
    key = None
    try:
        key = keyring.get_password(KEYRING_SERVICE, CRM_FILE_KEY)
    except Exception:
        key = None
    if not key:
        key = Fernet.generate_key().decode("ascii")
        # Questa è una chiave piccola; Credential Manager la gestisce senza
        # dover contenere l'intera sessione browser.
        keyring.set_password(KEYRING_SERVICE, CRM_FILE_KEY, key)
    return Fernet(key.encode("ascii"))


def save_encrypted_crm_payload(payload):
    APP_DIR.mkdir(parents=True, exist_ok=True)
    cipher = crm_file_cipher()
    raw = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    encrypted = cipher.encrypt(raw)
    tmp = CRM_AUTH_FILE.with_suffix(".tmp")
    tmp.write_bytes(encrypted)
    tmp.replace(CRM_AUTH_FILE)


def load_encrypted_crm_payload():
    if not CRM_AUTH_FILE.exists():
        return None
    try:
        cipher = crm_file_cipher()
        raw = cipher.decrypt(CRM_AUTH_FILE.read_bytes())
        value = json.loads(raw.decode("utf-8"))
        return value if isinstance(value, dict) else None
    except (InvalidToken, ValueError, json.JSONDecodeError):
        return None


def cleanup_legacy_crm_credentials():
    # Rimuove, se presenti, i vecchi tentativi a blocchi. Non sono più usati.
    for base in ("company-crm-browser-state", "company-crm-session-storage"):
        try:
            count = int(keyring.get_password(KEYRING_SERVICE, base + ":count") or "0")
        except Exception:
            count = 0
        for i in range(count):
            try:
                keyring.delete_password(KEYRING_SERVICE, f"{base}:{i}")
            except Exception:
                pass
        for suffix in (":count", ""):
            try:
                keyring.delete_password(KEYRING_SERVICE, base + suffix)
            except Exception:
                pass


async def save_crm_auth(context, page):
    state = await context.storage_state()
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

    save_encrypted_crm_payload({
        "storage_state": state,
        "session_storage": session_data or {}
    })
    cleanup_legacy_crm_credentials()


def load_crm_state():
    payload = load_encrypted_crm_payload()
    state = payload.get("storage_state") if payload else None
    return state if isinstance(state, dict) else None


async def restore_crm_session_storage(context):
    payload = load_encrypted_crm_payload()
    data = payload.get("session_storage") if payload else None
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


async def agenda_toolbar(page):
    for _ in range(100):
        for frame in page.frames:
            if await frame.locator('#cboAgendaToolbar').count():return frame
        await page.wait_for_timeout(250)
    raise RuntimeError('selettore_agenda_non_trovato')


async def discover_resources(page):
    toolbar=await agenda_toolbar(page)
    options=await toolbar.locator('#cboAgendaToolbar option').evaluate_all("els=>els.map(o=>({nome:o.textContent.trim(),value:o.value}))")
    resources=[]
    for option in options:
        match=re.fullmatch(r'id=(\d+)',option['value'])
        if match and option['nome']:
            resources.append({'crmId':match.group(1),'nome':option['nome']})
    if not resources or len({r['crmId'] for r in resources})!=len(resources):
        raise RuntimeError('inventario_agenda_non_valido')
    return resources


async def select_resource(page, name, sigla, crm_id=None):
    toolbar=await agenda_toolbar(page)
    resources=await discover_resources(page)
    matches=[r for r in resources if r['crmId']==str(crm_id)] if crm_id is not None else [r for r in resources if norm(r['nome'])==norm(name)]
    if len(matches)!=1:
        return False
    target=matches[0]['crmId']
    # The dedicated CRM onchange navigates frmAgendaHid, then refreshes toolbar/calendar.
    calendar=lambda frame: urlparse(frame.url).path.lower().endswith('/plage001.asp') and parse_qs(urlparse(frame.url).query).get('id')==[target]
    current=[f for f in page.frames if calendar(f)]
    selected=await toolbar.locator('#cboAgendaToolbar').input_value()
    if selected!='id='+target or not current:
        async with page.expect_event('framenavigated',predicate=calendar,timeout=25000) as loaded:
            await toolbar.locator('#cboAgendaToolbar').select_option('id='+target)
        frame=await loaded.value
        await frame.wait_for_load_state('domcontentloaded',timeout=25000)
    toolbar=await agenda_toolbar(page)
    await toolbar.locator('#cboAgendaToolbar').wait_for(state='visible',timeout=25000)
    if await toolbar.locator('#cboAgendaToolbar').input_value()!='id='+target:
        raise RuntimeError('risorsa_selezionata_diversa')
    checked=[]
    for frame in page.frames:
        checked.extend(await frame.locator('input[id^="chkAge"]:checked').evaluate_all('els=>els.map(e=>e.value)'))
    if checked!=[target]:
        raise RuntimeError('selezione_agenda_multipla_o_diversa')
    frames=[f for f in page.frames if calendar(f)]
    if len(frames)!=1:
        raise RuntimeError('agenda_risorsa_non_verificata')
    await frames[0].locator('[data-giorno]').first.wait_for(state='visible',timeout=25000)
    return True


async def select_month(page, month):
    if not re.fullmatch(r'20\d{4}',month):
        raise RuntimeError('mese_non_valido')
    toolbar=await agenda_toolbar(page)
    selected=await toolbar.locator('#cboAgendaToolbar').input_value()
    target=selected.split('=',1)[1]
    control=toolbar.locator('#cboCambioM')
    if await control.input_value()!=month+'01':
        predicate=lambda frame:urlparse(frame.url).path.lower().endswith('/plage001.asp') and parse_qs(urlparse(frame.url).query).get('id')==[target]
        async with page.expect_event('framenavigated',predicate=predicate,timeout=25000) as loaded:
            await control.select_option(month+'01')
        frame=await loaded.value
        await frame.wait_for_load_state('domcontentloaded',timeout=25000)
    toolbar=await agenda_toolbar(page)
    if await toolbar.locator('#cboCambioM').input_value()!=month+'01':
        raise RuntimeError('mese_agenda_non_verificato')


async def scan_resources(page, resources, month):
    resources=[r for r in resources if r.get('agenda_crm_attiva') is not False]
    events=[];scanned=[];failures=[];fingerprints={}
    for resource in resources:
        sigla=str(resource.get('sigla_crm') or '').strip()
        try:
            if not await select_resource(page,resource.get('nome_crm') or '',sigla,resource.get('crm_id')):
                failures.append({'sigla':sigla,'reason':'risorsa_non_trovata'});continue
            await select_month(page,month)
            cells=await month_cells(page)
            resource_events=[]
            for key,texts in cells.items():
                if key.startswith(month):resource_events.extend(parse_day(texts,iso_day(key),sigla))
            if len(resource_events)>120:
                failures.append({'sigla':sigla,'reason':'troppi_eventi','count':len(resource_events)});continue
            fingerprint=agenda_fingerprint(resource_events)
            if fingerprint:
                same=fingerprints.setdefault(fingerprint,[])
                if len(same)>=3:
                    failures.append({'sigla':sigla,'reason':'agenda_identica_sospetta','same_as':same[:3]});continue
                same.append(sigla)
            for ev in resource_events:
                ev['tecnicoSigla']=sigla;ev['tecnicoNome']=resource.get('nome_crm') or ''
            events.extend(resource_events);scanned.append(sigla)
        except Exception as exc:
            # Never log event titles, CRM HTML, URLs, credentials or arbitrary exceptions.
            reason=str(exc) if re.fullmatch(r'[a-z_]{3,80}',str(exc)) else 'errore_selezione_o_caricamento'
            failures.append({'sigla':sigla,'reason':reason})
    return {'events':events,'scanned':scanned,'failures':failures,'total':len(resources)}


def scan_summary(result):
    failed=', '.join(f"{x['sigla']} ({x['reason']})" for x in result['failures']) or 'nessuna'
    return f"Lette {len(result['scanned'])} su {result['total']}, fallite: {failed}"


async def month_cells(page):
    result = {}
    calendars=[f for f in page.frames if urlparse(f.url).path.lower().endswith("/plage001.asp")]
    for frame in calendars:
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
            segments=crm_segments(wanted,sh,sm,eh,em)
            minutes=sum(segment['minutes'] for segment in segments)
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
            for segment in segments:
              out.append({
                "crmEventId":f"agenda-{stable}"+(f"-{segment['date']}" if len(segments)>1 else ""),
                **segment,
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
    CONFIG_FILE.write_text(json.dumps({"username":username,"recovery_hold":True},indent=2),encoding="utf-8")

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
    write_status("ready","Login salvato; lettura completa da verificare.",{"resources":len(resources)})
    print("Login salvato. Il setup deve verificare tutte le risorse in modalita invisibile.")

def atomic_json(path,payload):
    temporary=path.with_suffix(path.suffix+'.tmp')
    temporary.write_text(json.dumps(payload,ensure_ascii=False,indent=2),encoding='utf-8')
    temporary.replace(path)

def boot_id():
    if os.name=='nt':
        try:
            import winreg
            with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE,r'SYSTEM\CurrentControlSet\Control\Session Manager\Memory Management\PrefetchParameters') as key:
                return str(winreg.QueryValueEx(key,'BootId')[0])
        except OSError:pass
    return __import__('datetime').datetime.now().astimezone().date().isoformat()

def login_attempt_key():
    return boot_id()+':'+str(CRM_AUTH_FILE.stat().st_mtime_ns if CRM_AUTH_FILE.exists() else 'missing')

async def wait_crm_access(page):
    # A missing password field during a redirect does not prove a completed login.
    for _ in range(300):
        if not await login_visible(page):
            for frame in page.frames:
                if await frame.locator('#cboAgendaToolbar').count():
                    await frame.locator('#cboAgendaToolbar').wait_for(state='visible',timeout=25000)
                    return
        await page.wait_for_timeout(1000)
    raise LoginRequiredError('CRM: login richiesto. Accesso manuale non completato entro cinque minuti.')

async def manual_login_once(token):
    marker=APP_DIR/'login-prompt.json';key=login_attempt_key()
    if marker.exists() and json.loads(marker.read_text(encoding='utf-8')).get('key')==key:return False
    atomic_json(marker,{'key':key,'openedAt':__import__('datetime').datetime.now().astimezone().isoformat()})
    api(token,'crmAgentHeartbeat',state='login_required',message='CRM: login richiesto. Completa il login nella finestra Edge; nessuna password viene inserita dall’agente.',agentVersion=AGENT_VERSION)
    async with async_playwright() as p:
        try:context=await p.chromium.launch_persistent_context(str(PROFILE_DIR),headless=False,channel='msedge',viewport={'width':1440,'height':950})
        except Exception:raise LoginRequiredError('CRM: login richiesto. Verifica la finestra Edge già aperta e riprova con --login.') from None
        try:
            page=context.pages[0] if context.pages else await context.new_page()
            await page.goto(AGENDA_URL,wait_until='load',timeout=60000)
            await wait_crm_access(page)
            await save_crm_auth(context,page)
            return True
        except Exception:
            raise LoginRequiredError('CRM: login richiesto. Login non completato o finestra chiusa; nessun tentativo automatico.') from None
        finally:await context.close()

async def scan_recovery(page,resources,today):
    cursor_path=APP_DIR/'read-cursors.json'
    cursors=json.loads(cursor_path.read_text(encoding='utf-8')) if cursor_path.exists() else {}
    plans=recovery_plan(resources,cursors,today)
    reads={}
    for month in sorted({m for p in plans for m in p['months']}):
        selected={p['sigla'] for p in plans if month in p['months']}
        reads[month]=await scan_resources(page,[r for r in resources if r['sigla_crm'] in selected],month)
    return combine_reads(plans,reads,today),cursors

async def run_with_manual_login():
    try:await run_once()
    except LoginRequiredError:
        write_status('login_required','CRM: login richiesto. Completa il login manuale in Edge.')
        config=json.loads(CONFIG_FILE.read_text(encoding='utf-8'))
        token=app_token(str(config['username']),interactive=False)
        if not await manual_login_once(token):raise LoginRequiredError('CRM: login richiesto. La finestra non viene riproposta a ogni ciclo; usa --login per riprovare.')
        await run_once()


async def run_once():
    if not CONFIG_FILE.exists():raise RuntimeError('Agente non configurato. Esegui SETUP_SYNC_BACKGROUND.bat.')
    config=json.loads(CONFIG_FILE.read_text(encoding='utf-8'))
    username=str(config.get('username') or '').strip()
    if not username:raise RuntimeError('Username agente mancante.')
    token=app_token(username,interactive=False)
    api(token,'crmAgentHeartbeat',state='starting',message='Avvio lettura CRM aziendale.',agentVersion=AGENT_VERSION)
    crm_state=load_crm_state()
    if not crm_state:raise LoginRequiredError('Sessione CRM non disponibile.')
    async with async_playwright() as p:
        browser=await p.chromium.launch(headless=True,channel='msedge')
        try:
            context=await browser.new_context(storage_state=crm_state,viewport={'width':1440,'height':950})
            await restore_crm_session_storage(context)
            page=await context.new_page();await page.goto(AGENDA_URL,wait_until='load',timeout=60000)
            if await login_visible(page):raise LoginRequiredError('Sessione CRM scaduta: eseguire SETUP_SYNC_BACKGROUND.bat.')
            await (await agenda_toolbar(page)).locator('#cboAgendaToolbar').wait_for(state='visible')
            inventory=await discover_resources(page)
            api(token,'registerCrmResources',resources=inventory)
            resources=api(token,'crmResources').get('resources',[])
            today=__import__('datetime').datetime.now(__import__('zoneinfo').ZoneInfo('Europe/Rome')).date().isoformat()
            result,cursors=await scan_recovery(page,resources,today)
            await save_crm_auth(context,page)
        finally:await browser.close()
    message=scan_summary(result)
    failed=bool(result['failures'])
    # Recovery requires a separate human approval; a repaired selector must not trigger backfill.
    preview=True  # Import explicitly blocked until the new workday/restart test is approved.
    state='partial' if failed else 'recovery_pending' if preview else 'ok'
    saved=0
    if preview:
        path=APP_DIR/'recovery-preview.json'
        previous=json.loads(path.read_text(encoding='utf-8')) if path.exists() else {}
        pending=merge_preview(previous,result)
        for e in pending['events']:
            e['importReview']='data_futura_non_da_importare' if e['date']>today else 'vincoli_da_aggiornare'
        for window in { (p['from'],p['to']) for p in result['ranges'] }:
            constraints=api(token,'crmRecoveryConstraints',**{'from':window[0],'to':window[1]})
            subset={'events':[e for e in pending['events'] if window[0]<=e['date']<=window[1]]}
            annotate_preview(subset,resources,constraints)
        pending['importsBlocked']=True
        atomic_json(path,pending)  # Save observations before advancing any read cursor.
        for p in result['ranges']:
            if p['sigla'] in result['scanned']:cursors[p['sigla']]=p['to']
        atomic_json(APP_DIR/'read-cursors.json',cursors)
        message+='; anteprima, nessuna importazione.'
        if any(p['remaining'] for p in result['ranges']):message+=' Recupero più vecchio: prosegue nel prossimo ciclo.'
    api(token,'crmAgentHeartbeat',state=state,message=message,scanned=len(result['scanned']),events=len(result['events']),saved=saved,failures=len(result['failures']),failureDetails=result['failures'],scannedResources=result['scanned'],readRanges=[p for p in result['ranges'] if p['sigla'] in result['scanned']],agentVersion=AGENT_VERSION)
    write_status(state,message,{'scanned':len(result['scanned']),'total':result['total'],'scannedResources':result['scanned'],'readRanges':result['ranges'],'events':len(result['events']),'saved':saved,'failures':result['failures'],'agentVersion':AGENT_VERSION})
    print(message)
    if failed:raise PartialReadError(message)


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
    if '--login' in args:
        marker=APP_DIR/'login-prompt.json'
        if marker.exists():marker.unlink()
    await run_with_manual_login()


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
        if isinstance(exc,PartialReadError):sys.exit(1)
        write_status("login_required" if login_required else "error",str(exc))
        if "--setup" not in sys.argv:
            try:
                if CONFIG_FILE.exists():
                    username=json.loads(CONFIG_FILE.read_text(encoding="utf-8")).get("username","").strip()
                    if username:
                        token=app_token(username, interactive=False)
                        api(token,"crmAgentHeartbeat",state="login_required" if login_required else "error",message=str(exc)[:300],agentVersion=AGENT_VERSION)
            except Exception:
                pass
        if "--setup" in sys.argv:
            print("\nERRORE:",exc)
            input("\nPremi INVIO per chiudere.")
        sys.exit(2 if login_required else 1)
    finally:
        release_run_mutex(mutex)
