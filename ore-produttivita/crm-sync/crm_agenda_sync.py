import asyncio
import getpass
import hashlib
import json
import os
import re
import sys
import urllib.error
import urllib.request
from datetime import date, datetime
from pathlib import Path

from playwright.async_api import async_playwright

FIREBASE_API_KEY = "AIzaSyAdgCc8TQ1TVfF8l0NMxtm7NS95ZOl4lCA"
FIREBASE_SIGNIN = f"https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key={FIREBASE_API_KEY}"
APP_API = "https://twznfiygzzbqdgudpwav.supabase.co/functions/v1/ore-produttivita-api"
AGENDA_URL = "https://crm.colligoingegneria.it/intrasofter/intraplan/plage000.asp"

APP_DIR = Path(os.environ.get("LOCALAPPDATA", Path.home())) / "ColligoOreProduttivita"
PROFILE_DIR = APP_DIR / "crm-browser"
DEBUG_FILE = APP_DIR / "agenda_debug.json"

TIME_RE = re.compile(r"\b([01]?\d|2[0-3])[:.](\d{2})\b")
DATE_RE = re.compile(r"\b(\d{1,2})[/-](\d{1,2})[/-](20\d{2})\b")
ISO_DATE_RE = re.compile(r"\b(20\d{2})-(\d{2})-(\d{2})\b")
SHORT_RE = re.compile(r"\b(\d{2}\.\d{2})(?:-([A-Z]))?\b", re.I)
COMM_RE = re.compile(r"\b(CM\d{5,})\b", re.I)

def post_json(url, payload, token=None):
    data = json.dumps(payload).encode("utf-8")
    headers = {"content-type": "application/json"}
    if token:
        headers["authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=40) as res:
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
        raise RuntimeError("Credenziali SafetyChecklist non valide.")
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

def event_from_text(text, fallback_day, idx):
    compact = " ".join(str(text or "").split())
    if not compact:
        return None
    times = list(TIME_RE.finditer(compact))
    if len(times) < 2:
        return None
    day = parse_date(compact, fallback_day)
    start = iso_for(day, times[0].group(1), times[0].group(2))
    end = iso_for(day, times[1].group(1), times[1].group(2))
    start_dt, end_dt = datetime.fromisoformat(start), datetime.fromisoformat(end)
    minutes = int((end_dt - start_dt).total_seconds() // 60)
    if minutes <= 0 or minutes > 16 * 60:
        return None

    short = SHORT_RE.search(compact)
    comm = COMM_RE.search(compact)
    stable = hashlib.sha1(f"{day}|{start}|{end}|{compact}".encode("utf-8")).hexdigest()[:24]
    return {
        "crmEventId": f"agenda-{stable}",
        "date": day,
        "start": start,
        "end": end,
        "minutes": minutes,
        "title": compact[:500],
        "shortCode": work.group(1).upper() if work else (old_short.group(0).upper() if old_short else ""),
        "codiceComm": comm.group(1).upper() if comm else "",
        "_sourceIndex": idx
    }

async def page_snapshot(page):
    return await page.evaluate("""() => {
      const rows = [];
      const push = (kind, index, text) => {
        text = (text || '').replace(/\\s+/g, ' ').trim();
        if (text && text.length <= 1500) rows.push({kind, index, text});
      };
      document.querySelectorAll('tr').forEach((el, i) => push('tr', i, el.innerText));
      document.querySelectorAll('[onclick], [ondblclick], a, td, div').forEach((el, i) => {
        const t = el.innerText || '';
        if (/\\b\\d{1,2}[:.]\\d{2}\\b/.test(t) && t.length < 900) push('timed', i, t);
      });
      return {
        url: location.href,
        title: document.title,
        body: document.body ? document.body.innerText.slice(0, 20000) : '',
        rows
      };
    }""")

def dedupe(events):
    seen, out = set(), []
    for e in events:
        key = (e["date"], e["start"], e["end"], e["title"])
        if key in seen:
            continue
        seen.add(key)
        out.append(e)
    return out

async def main():
    APP_DIR.mkdir(parents=True, exist_ok=True)
    wanted = input(f"Data da sincronizzare [{date.today().isoformat()}]: ").strip() or date.today().isoformat()
    if not re.fullmatch(r"20\\d{2}-\\d{2}-\\d{2}", wanted):
        raise RuntimeError("Usa il formato AAAA-MM-GG.")

    username = input("Username SafetyChecklist: ").strip()
    password = getpass.getpass("Password SafetyChecklist: ")
    token = firebase_login(username, password)

    async with async_playwright() as p:
        browser = await p.chromium.launch_persistent_context(
            str(PROFILE_DIR),
            headless=False,
            channel="msedge",
            viewport={"width": 1440, "height": 950},
        )
        page = browser.pages[0] if browser.pages else await browser.new_page()
        await page.goto(AGENDA_URL, wait_until="domcontentloaded", timeout=60000)
        print("\\nCRM aperto.")
        print("Se compare il login, accedi normalmente. Poi porta l'agenda sulla giornata richiesta.")
        input("Quando vedi l'agenda corretta, premi INVIO qui... ")

        frames_data = []
        for fi, frame in enumerate(page.frames):
            try:
                snap = await frame.evaluate("""() => {
                  const rows=[];
                  document.querySelectorAll('tr').forEach((el,i)=>{
                    const text=(el.innerText||'').replace(/\\s+/g,' ').trim();
                    if(text) rows.push({kind:'tr',index:i,text});
                  });
                  document.querySelectorAll('[onclick], [ondblclick], a, td, div').forEach((el,i)=>{
                    const text=(el.innerText||'').replace(/\\s+/g,' ').trim();
                    if(/\\b\\d{1,2}[:.]\\d{2}\\b/.test(text) && text.length<900) rows.push({kind:'timed',index:i,text});
                  });
                  return {url:location.href,title:document.title,body:(document.body?.innerText||'').slice(0,20000),rows};
                }""")
                snap["frameIndex"] = fi
                frames_data.append(snap)
            except Exception:
                pass

        DEBUG_FILE.write_text(json.dumps(frames_data, ensure_ascii=False, indent=2), encoding="utf-8")

        events = []
        seq = 0
        for snap in frames_data:
            for row in snap.get("rows", []):
                event = event_from_text(row.get("text", ""), wanted, seq)
                seq += 1
                if event and event["date"] == wanted:
                    events.append(event)
        events = dedupe(events)

        if not events:
            print("\\nNessuna attività con due orari riconosciuta automaticamente.")
            print(f"Diagnostica salvata in: {DEBUG_FILE}")
            print("Il file serve per adattare i selettori alla vostra agenda senza andare a tentativi.")
            await browser.close()
            return

        print(f"\\nTrovate {len(events)} possibili attività:")
        for i, e in enumerate(events, 1):
            print(f"{i:02d}. {e['start'][11:16]}-{e['end'][11:16]}  {e['shortCode'] or e['codiceComm'] or 'SENZA CODICE'}  {e['title'][:100]}")

        answer = input("\\nInviare queste attività a Colligo Ore & Produttività? [S/n]: ").strip().lower()
        if answer not in ("", "s", "si", "sì", "y", "yes"):
            print("Sincronizzazione annullata.")
            await browser.close()
            return

        cleaned = [{k:v for k,v in e.items() if not k.startswith("_")} for e in events]
        status, result = post_json(APP_API, {"action": "ingestAgenda", "date": wanted, "events": cleaned}, token)
        print("\\nRisultato:", json.dumps(result, ensure_ascii=False, indent=2))
        if status >= 300:
            raise RuntimeError(result.get("error", "Errore durante la sincronizzazione."))

        print(f"\\nSalvate: {result.get('saved', 0)} · Da abbinare: {result.get('unmatched', 0)} · Ambigue: {result.get('ambiguous', 0)}")
        if result.get("unmatched"):
            print("Le voci non abbinate resteranno visibili nel risultato: assegneremo il codice corretto una sola volta.")
        await browser.close()

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
    except Exception as exc:
        print(f"\\nERRORE: {exc}")
        sys.exit(1)
