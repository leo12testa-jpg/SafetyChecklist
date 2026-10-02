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
from datetime import date, datetime
from urllib.parse import parse_qs, urlparse
from pathlib import Path

from playwright.async_api import async_playwright

FIREBASE_API_KEY = "AIzaSyAdgCc8TQ1TVfF8l0NMxtm7NS95ZOl4lCA"
FIREBASE_SIGNIN = f"https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key={FIREBASE_API_KEY}"
APP_API = "https://twznfiygzzbqdgudpwav.supabase.co/functions/v1/ore-produttivita-api"
AGENDA_URL = "https://crm.colligoingegneria.it/intrasofter/intraplan/plage000.asp"

APP_DIR = Path(os.environ.get("LOCALAPPDATA", Path.home())) / "ColligoOreProduttivita"
PROFILE_ROOT = APP_DIR / "crm-browser"
DEBUG_FILE = APP_DIR / "agenda_personale_debug.json"

TIME_RE = re.compile(r"\b([01]?\d|2[0-3])[:.](\d{2})\b")
DATE_RE = re.compile(r"\b(\d{1,2})[/-](\d{1,2})[/-](20\d{2})\b")
ISO_DATE_RE = re.compile(r"\b(20\d{2})-(\d{2})-(\d{2})\b")
WORK_RE = re.compile(r"\b(\d{1,2}[A-IL-P])\b", re.I)
OLD_SHORT_RE = re.compile(r"\b(\d{2}\.\d{2})(?:-([A-Z]))?\b", re.I)
COMM_RE = re.compile(r"\b(CM\d{5,})\b", re.I)


def post_json(url, payload, token=None):
    data = json.dumps(payload).encode("utf-8")
    headers = {"content-type": "application/json"}
    if token:
        headers["authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
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


def api_me(token):
    status, body = post_json(APP_API, {"action": "myCrmResource"}, token)
    if status >= 300:
        raise RuntimeError(body.get("error", "Impossibile verificare la risorsa CRM."))
    resource = body.get("resource")
    if not resource:
        raise RuntimeError("Il tuo account Ore & Produttività non è collegato a una risorsa CRM.")
    return resource


def launch_args():
    wanted = ""
    username = ""
    app_launch = False
    raw_args = [a for a in sys.argv[1:] if a]
    if raw_args and raw_args[0].lower().startswith("colligoore://"):
        app_launch = True
        u = urlparse(raw_args[0])
        q = parse_qs(u.query)
        wanted = (q.get("date") or [""])[0].strip()
        username = (q.get("username") or [""])[0].strip()
    else:
        for i, value in enumerate(raw_args):
            if value == "--date" and i + 1 < len(raw_args):
                wanted = raw_args[i + 1].strip()
            if value == "--username" and i + 1 < len(raw_args):
                username = raw_args[i + 1].strip()
    return wanted, username, app_launch


def profile_dir_for(username):
    safe = re.sub(r"[^a-z0-9._-]+", "_", username.lower()).strip("._-") or "utente"
    return PROFILE_ROOT / safe


def firebase_login(username, password):
    email = f"{username.strip().lower()}@safetychecklist.local"
    status, body = post_json(FIREBASE_SIGNIN, {
        "email": email,
        "password": password,
        "returnSecureToken": True
    })
    if status >= 300 or not body.get("idToken"):
        raise RuntimeError("Credenziali non valide.")
    return body["idToken"]


def parse_date(text, fallback):
    m = ISO_DATE_RE.search(text)
    if m:
        return f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
    m = DATE_RE.search(text)
    if m:
        return f"{m.group(3)}-{int(m.group(2)):02d}-{int(m.group(1)):02d}"
    return fallback


def iso_for(day, hh, mm):
    return f"{day}T{int(hh):02d}:{int(mm):02d}:00"


def event_from_text(text, fallback_day):
    compact = " ".join(html.unescape(str(text or "")).split())
    if not compact:
        return None

    times = list(TIME_RE.finditer(compact))
    if len(times) < 2:
        return None

    day = parse_date(compact, fallback_day)
    start = iso_for(day, times[0].group(1), times[0].group(2))
    end = iso_for(day, times[1].group(1), times[1].group(2))
    start_dt = datetime.fromisoformat(start)
    end_dt = datetime.fromisoformat(end)
    minutes = int((end_dt - start_dt).total_seconds() // 60)
    if minutes <= 0 or minutes > 16 * 60:
        return None

    work = WORK_RE.search(compact)
    old_short = OLD_SHORT_RE.search(compact)
    comm = COMM_RE.search(compact)
    stable = hashlib.sha1(
        f"{day}|{start}|{end}|{compact}".encode("utf-8")
    ).hexdigest()[:24]

    return {
        "crmEventId": f"agenda-{stable}",
        "date": day,
        "start": start,
        "end": end,
        "minutes": minutes,
        "title": compact[:500],
        "shortCode": work.group(1).upper() if work else (old_short.group(0).upper() if old_short else ""),
        "codiceComm": comm.group(1).upper() if comm else ""
    }


async def snapshot_frame(frame, frame_index):
    return await frame.evaluate(r"""(frameIndex) => {
      const rows = [];

      const richText = (el) => {
        const parts = [];
        const addPart = (v) => {
          v = (v || '').replace(/\s+/g, ' ').trim();
          if (v && !parts.includes(v)) parts.push(v);
        };

        addPart(el.innerText);
        addPart(el.textContent);
        addPart(el.getAttribute?.('title'));
        addPart(el.getAttribute?.('aria-label'));
        addPart(el.getAttribute?.('data-title'));
        addPart(el.getAttribute?.('data-original-title'));
        addPart(el.getAttribute?.('data-tooltip'));
        addPart(el.getAttribute?.('alt'));

        el.querySelectorAll?.('[title],[aria-label],[data-title],[data-original-title],[data-tooltip],[alt]').forEach(child => {
          addPart(child.getAttribute('title'));
          addPart(child.getAttribute('aria-label'));
          addPart(child.getAttribute('data-title'));
          addPart(child.getAttribute('data-original-title'));
          addPart(child.getAttribute('data-tooltip'));
          addPart(child.getAttribute('alt'));
        });

        return parts.join(' | ').replace(/\s+/g, ' ').trim();
      };

      const add = (kind, index, el) => {
        const text = richText(el);
        if (text && text.length <= 2500) rows.push({kind, index, text});
      };

      document.querySelectorAll('tr').forEach((el, i) => add('tr', i, el));

      document.querySelectorAll(
        '[onclick], [ondblclick], [title], [aria-label], [data-title], [data-original-title], [data-tooltip], a, td, div, span'
      ).forEach((el, i) => {
        let t = richText(el);
        if (!/\b\d{1,2}[:.]\d{2}\b/.test(t)) {
          const parent = el.closest?.('tr, [role="row"], .event, .appointment, .calendar-event');
          if (parent) {
            const p = richText(parent);
            if (p) t = p + (t ? ' | ' + t : '');
          }
        }
        if (/\b\d{1,2}[:.]\d{2}\b/.test(t) && t.length < 2200) {
          rows.push({kind: 'timed', index: i, text: t});
        }
      });

      return {
        frameIndex,
        url: location.href,
        title: document.title,
        body: (document.body?.innerText || '').slice(0, 30000),
        rows
      };
    }""", frame_index)


async def snapshot_all(page):
    data = []
    for fi, frame in enumerate(page.frames):
        try:
            data.append(await snapshot_frame(frame, fi))
        except Exception:
            pass
    return data


def parse_visible_agenda(frames_data, wanted):
    events = []
    for preferred_kind in ("tr", "timed"):
        current = []
        for snap in frames_data:
            for row in snap.get("rows", []):
                if row.get("kind") != preferred_kind:
                    continue
                ev = event_from_text(row.get("text", ""), wanted)
                if ev and ev["date"] == wanted:
                    current.append(ev)
        if current:
            events = current
            break

    seen = set()
    out = []
    for e in events:
        key = (e["date"], e["start"], e["end"], e["title"])
        if key in seen:
            continue
        seen.add(key)
        out.append(e)
    return out


async def main():
    APP_DIR.mkdir(parents=True, exist_ok=True)
    wanted_arg, username_arg, launched_from_app = launch_args()

    wanted = wanted_arg or input(f"Data da sincronizzare [{date.today().isoformat()}]: ").strip() or date.today().isoformat()
    if not re.fullmatch(r"20\d{2}-\d{2}-\d{2}", wanted):
        raise RuntimeError("Usa il formato AAAA-MM-GG.")

    username = username_arg or input("Username Ore & Produttività: ").strip()
    if not username:
        raise RuntimeError("Username mancante.")

    password = getpass.getpass("Password Ore & Produttività: ")
    token = firebase_login(username, password)
    resource = api_me(token)
    print(f"\nAccount verificato: {resource.get('nome') or resource.get('tecnico_nome') or username} · CRM {resource.get('sigla') or '—'}")

    async with async_playwright() as p:
        browser = await p.chromium.launch_persistent_context(
            str(profile_dir_for(username)),
            headless=False,
            channel="msedge",
            viewport={"width": 1440, "height": 950},
        )
        page = browser.pages[0] if browser.pages else await browser.new_page()
        await page.goto(AGENDA_URL, wait_until="domcontentloaded", timeout=60000)

        print("\nAgenda CRM aperta nel profilo personale di questo utente.")
        print("Accedi con IL TUO account CRM se richiesto.")
        print(f"Giornata richiesta dall'app: {wanted}.")
        print("Ogni account Ore & Produttività usa un profilo browser CRM separato.")

        # Prova a portare automaticamente l'agenda alla data selezionata.
        for frame in page.frames:
            try:
                changed = await frame.evaluate(r"""(wanted) => {
                  const fire = (el) => {
                    for (const name of ['input','change','blur']) el.dispatchEvent(new Event(name,{bubbles:true}));
                  };
                  const d = new Date(wanted + 'T12:00:00');
                  const it = String(d.getDate()).padStart(2,'0') + '/' + String(d.getMonth()+1).padStart(2,'0') + '/' + d.getFullYear();
                  const candidates = [...document.querySelectorAll('input')].filter(el => {
                    const key = ((el.name||'')+' '+(el.id||'')+' '+(el.placeholder||'')).toLowerCase();
                    return el.type === 'date' || /data|date|giorno/.test(key);
                  });
                  for (const el of candidates) {
                    const value = el.type === 'date' ? wanted : it;
                    try {
                      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;
                      setter ? setter.call(el,value) : (el.value=value);
                      fire(el);
                      if ((el.value||'').includes(String(d.getFullYear()))) return true;
                    } catch {}
                  }
                  return false;
                }""", wanted)
                if changed:
                    await page.wait_for_timeout(1200)
                    break
            except Exception:
                pass

        frames = await snapshot_all(page)
        events = parse_visible_agenda(frames, wanted)

        if not events:
            print(f"\nNon riesco ancora a leggere automaticamente la giornata {wanted}.")
            print("Porta la TUA agenda a quella data; poi premi INVIO.")
            input()
            frames = await snapshot_all(page)
            events = parse_visible_agenda(frames, wanted)

        DEBUG_FILE.write_text(
            json.dumps({"date": wanted, "frames": frames}, ensure_ascii=False, indent=2),
            encoding="utf-8"
        )
        print(f"\nAttività riconosciute nella tua agenda: {len(events)}")
        for e in events:
            print(f"  {e['start'][11:16]}–{e['end'][11:16]} · {e['shortCode'] or e['codiceComm'] or 'senza codice'} · {e['title'][:90]}")

        if not events:
            print(f"\nNessuna attività riconosciuta. Diagnostica: {DEBUG_FILE}")
            await browser.close()
            return

        if not launched_from_app:
            answer = input("\nSincronizzare queste attività nel TUO account Ore & Produttività? [S/n]: ").strip().lower()
            if answer not in ("", "s", "si", "sì", "y", "yes"):
                print("Sincronizzazione annullata.")
                await browser.close()
                return
        else:
            print("\nSincronizzazione automatica richiesta dall'app…")

        status, result = post_json(
            APP_API,
            {"action": "ingestAgenda", "date": wanted, "events": events},
            token
        )
        print("\nRisultato:", json.dumps(result, ensure_ascii=False, indent=2))
        if status >= 300:
            raise RuntimeError(result.get("error", "Errore durante la sincronizzazione."))

        print(
            f"\nSalvate: {result.get('saved', 0)} · "
            f"Classificate automaticamente: {result.get('autoClassified', 0)} · "
            f"Da abbinare: {result.get('unmatched', 0)} · "
            f"Ambigue: {result.get('ambiguous', 0)}"
        )
        print("La Direzione vedrà i dati aggregati di tutti i tecnici che hanno sincronizzato la propria agenda.")
        print(f"Diagnostica tecnica: {DEBUG_FILE}")
        await browser.close()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
    except Exception as exc:
        print(f"\nERRORE: {exc}")
        sys.exit(1)
