import asyncio
import getpass
import hashlib
import html
import json
import os
import re
import sys
import unicodedata
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
DEBUG_FILE = APP_DIR / "agenda_azienda_debug.json"

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


def normalize(value):
    s = html.unescape(str(value or "")).strip().lower()
    return "".join(
        c for c in unicodedata.normalize("NFD", s)
        if unicodedata.category(c) != "Mn"
    )


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


def event_from_text(text, fallback_day, idx, resource):
    compact = " ".join(html.unescape(str(text or "")).split())
    if not compact:
        return None
    times = list(TIME_RE.finditer(compact))
    if len(times) < 2:
        return None

    day = parse_date(compact, fallback_day)
    start = iso_for(day, times[0].group(1), times[0].group(2))
    end = iso_for(day, times[1].group(1), times[1].group(2))
    start_dt, end_dt = datetime.fromisoformat(start), datetime.fromisoformat(end)
    mins = int((end_dt - start_dt).total_seconds() // 60)
    if mins <= 0 or mins > 16 * 60:
        return None

    work = WORK_RE.search(compact)
    old_short = OLD_SHORT_RE.search(compact)
    comm = COMM_RE.search(compact)
    sigla = str(resource.get("sigla_crm") or "").strip().upper()
    nome = str(resource.get("nome_crm") or "").strip()
    stable = hashlib.sha1(
        f"{sigla}|{day}|{start}|{end}|{compact}".encode("utf-8")
    ).hexdigest()[:24]

    return {
        "crmEventId": f"agenda-{sigla.lower()}-{stable}",
        "date": day,
        "start": start,
        "end": end,
        "minutes": mins,
        "title": compact[:500],
        "shortCode": work.group(1).upper() if work else (old_short.group(0).upper() if old_short else ""),
        "codiceComm": comm.group(1).upper() if comm else "",
        "tecnicoSigla": sigla,
        "tecnicoNome": nome,
        "_sourceIndex": idx
    }


def dedupe(events):
    seen, out = set(), []
    for e in events:
        key = (
            e.get("tecnicoSigla"), e.get("date"),
            e.get("start"), e.get("end"), e.get("title")
        )
        if key in seen:
            continue
        seen.add(key)
        out.append(e)
    return out


def resource_for_option(text, resources):
    raw = html.unescape(str(text or "")).strip()
    n = normalize(raw)
    tokens = set(re.findall(r"[A-Z0-9]+", raw.upper()))
    best = None
    best_score = 0
    for r in resources:
        name = normalize(r.get("nome_crm"))
        sigla = str(r.get("sigla_crm") or "").strip().upper()
        score = 0
        if name and (n == name or name in n):
            score = 4
        elif sigla and sigla in tokens:
            score = 2
        elif sigla and n == normalize(sigla):
            score = 3
        if score > best_score:
            best, best_score = r, score
    return best if best_score else None


def resource_from_text(text, resources):
    n = normalize(text)
    raw_tokens = set(re.findall(r"[A-Z0-9]+", html.unescape(str(text or "")).upper()))
    for r in resources:
        name = normalize(r.get("nome_crm"))
        if name and name in n:
            return r
    for r in resources:
        sigla = str(r.get("sigla_crm") or "").strip().upper()
        if len(sigla) >= 2 and sigla in raw_tokens:
            return r
    return None


async def snapshot_frame(frame, frame_index):
    return await frame.evaluate("""(frameIndex) => {
      const rows = [];
      const add = (kind, index, text) => {
        text = (text || '').replace(/\s+/g, ' ').trim();
        if (text && text.length <= 1500) rows.push({kind, index, text});
      };
      document.querySelectorAll('tr').forEach((el, i) => add('tr', i, el.innerText));
      document.querySelectorAll('[onclick], [ondblclick], a, td, div').forEach((el, i) => {
        const t = el.innerText || '';
        if (/\b\d{1,2}[:.]\d{2}\b/.test(t) && t.length < 900) add('timed', i, t);
      });
      const selects = [...document.querySelectorAll('select')].map((s, i) => ({
        index: i,
        id: s.id || '',
        name: s.name || '',
        options: [...s.options].map(o => ({value:o.value, text:(o.textContent||'').trim(), selected:o.selected}))
      }));
      return {
        frameIndex,
        url: location.href,
        title: document.title,
        body: (document.body?.innerText || '').slice(0, 20000),
        rows,
        selects
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


def selector_candidates(frames_data, resources):
    candidates = []
    for snap in frames_data:
        for sel in snap.get("selects", []):
            matches = []
            used = set()
            for opt in sel.get("options", []):
                r = resource_for_option(opt.get("text"), resources)
                if not r:
                    continue
                key = r.get("sigla_crm")
                if key in used:
                    continue
                used.add(key)
                matches.append({"option": opt, "resource": r})
            if len(matches) >= 2:
                candidates.append({
                    "frameIndex": snap["frameIndex"],
                    "selectIndex": sel["index"],
                    "selectId": sel.get("id"),
                    "selectName": sel.get("name"),
                    "matches": matches
                })
    candidates.sort(key=lambda x: len(x["matches"]), reverse=True)
    return candidates


async def select_resource(page, candidate, option):
    fi = candidate["frameIndex"]
    if fi >= len(page.frames):
        raise RuntimeError("Il frame agenda è cambiato durante la lettura.")
    frame = page.frames[fi]
    locator = frame.locator("select").nth(candidate["selectIndex"])
    value = option.get("value")
    if value is not None:
        await locator.select_option(value=value)
    else:
        await locator.select_option(label=option.get("text"))
    await page.wait_for_timeout(1200)


def events_from_snapshot(frames_data, wanted, resource, seq_start=0):
    events = []
    seq = seq_start
    # Preferiamo righe tabella; gli elementi generici sono solo fallback.
    table_rows = []
    fallback_rows = []
    for snap in frames_data:
        for row in snap.get("rows", []):
            if row.get("kind") == "tr":
                table_rows.append(row)
            else:
                fallback_rows.append(row)

    source = table_rows
    parsed = []
    for row in source:
        ev = event_from_text(row.get("text", ""), wanted, seq, resource)
        seq += 1
        if ev and ev["date"] == wanted:
            parsed.append(ev)

    if not parsed:
        for row in fallback_rows:
            ev = event_from_text(row.get("text", ""), wanted, seq, resource)
            seq += 1
            if ev and ev["date"] == wanted:
                parsed.append(ev)
    events.extend(parsed)
    return events, seq


async def main():
    APP_DIR.mkdir(parents=True, exist_ok=True)
    wanted = input(f"Data da sincronizzare [{date.today().isoformat()}]: ").strip() or date.today().isoformat()
    if not re.fullmatch(r"20\d{2}-\d{2}-\d{2}", wanted):
        raise RuntimeError("Usa il formato AAAA-MM-GG.")

    username = input("Username SafetyChecklist ADMIN: ").strip()
    password = getpass.getpass("Password SafetyChecklist: ")
    token = firebase_login(username, password)

    status, catalog = post_json(APP_API, {"action": "crmResources"}, token)
    if status >= 300:
        raise RuntimeError(catalog.get("error", "La sincronizzazione aziendale richiede un account admin."))
    resources = catalog.get("resources") or []
    if not resources:
        raise RuntimeError("Nessuna risorsa CRM configurata.")

    print(f"\nRisorse aziendali configurate: {len(resources)}")

    async with async_playwright() as p:
        browser = await p.chromium.launch_persistent_context(
            str(PROFILE_DIR),
            headless=False,
            channel="msedge",
            viewport={"width": 1440, "height": 950},
        )
        page = browser.pages[0] if browser.pages else await browser.new_page()
        await page.goto(AGENDA_URL, wait_until="domcontentloaded", timeout=60000)

        print("\nCRM aperto.")
        print("Se compare il login, accedi normalmente.")
        print(f"Porta l'agenda alla giornata {wanted}. Il programma poi scorrerà le risorse da solo.")
        input("Quando vedi la giornata corretta, premi INVIO qui... ")

        initial = await snapshot_all(page)
        candidates = selector_candidates(initial, resources)
        debug = {
            "wantedDate": wanted,
            "resourcesConfigured": resources,
            "selectorCandidates": candidates,
            "initialFrames": initial,
            "resourceRuns": []
        }

        all_events = []
        scanned_sigle = set()
        seq = 0

        if candidates:
            candidate = candidates[0]
            print(f"\nSelettore risorsa trovato: {len(candidate['matches'])} tecnici riconosciuti.")
            for pos, item in enumerate(candidate["matches"], 1):
                resource = item["resource"]
                label = resource.get("nome_crm") or resource.get("sigla_crm")
                print(f"[{pos:02d}/{len(candidate['matches']):02d}] Leggo agenda: {label}")
                try:
                    await select_resource(page, candidate, item["option"])
                    current = await snapshot_all(page)
                    scanned_sigle.add(str(resource.get("sigla_crm") or "").strip().upper())
                    events, seq = events_from_snapshot(current, wanted, resource, seq)
                    all_events.extend(events)
                    debug["resourceRuns"].append({
                        "resource": resource,
                        "option": item["option"],
                        "eventsFound": len(events),
                        "frames": current
                    })
                except Exception as exc:
                    debug["resourceRuns"].append({
                        "resource": resource,
                        "option": item["option"],
                        "error": str(exc)
                    })
        else:
            print("\nNessun selettore risorsa riconosciuto. Verifico se la pagina contiene già più agende.")
            found_resources = {}
            for snap in initial:
                for row in snap.get("rows", []):
                    resource = resource_from_text(row.get("text", ""), resources)
                    if not resource:
                        continue
                    found_resources[resource["sigla_crm"]] = resource
                    scanned_sigle.add(str(resource.get("sigla_crm") or "").strip().upper())
                    ev = event_from_text(row.get("text", ""), wanted, seq, resource)
                    seq += 1
                    if ev and ev["date"] == wanted:
                        all_events.append(ev)

            if len(found_resources) < 2:
                DEBUG_FILE.write_text(json.dumps(debug, ensure_ascii=False, indent=2), encoding="utf-8")
                await browser.close()
                raise RuntimeError(
                    "Non riesco ancora a vedere in modo affidabile tutte le agende dal CRM. "
                    f"Diagnostica salvata in {DEBUG_FILE}. Non sincronizzo una sola agenda fingendo che siano tutte."
                )

        events = dedupe(all_events)
        DEBUG_FILE.write_text(json.dumps(debug, ensure_ascii=False, indent=2), encoding="utf-8")

        by_resource = {}
        for e in events:
            by_resource.setdefault(e["tecnicoSigla"], {"nome": e["tecnicoNome"], "count": 0})
            by_resource[e["tecnicoSigla"]]["count"] += 1

        print("\nRiepilogo lettura:")
        for sigla, item in sorted(by_resource.items(), key=lambda kv: kv[1]["nome"]):
            print(f"  {sigla:>4} · {item['nome']}: {item['count']} attività")

        scanned = len(scanned_sigle)
        print(f"\nAgende effettivamente scorse: {scanned} / {len(resources)}")
        print(f"Agende con almeno un'attività riconosciuta: {len(by_resource)}")
        print(f"Attività totali trovate: {len(events)}")
        if scanned < len(resources):
            missing = [r.get("nome_crm") or r.get("sigla_crm") for r in resources if str(r.get("sigla_crm") or "").strip().upper() not in scanned_sigle]
            print("\nATTENZIONE: non risultano scorse tutte le agende.")
            print("Mancano: " + ", ".join(missing))

        if not events:
            print(f"\nNessuna attività riconosciuta. Diagnostica: {DEBUG_FILE}")
            await browser.close()
            return

        answer = input("\nInviare TUTTE queste agende a Colligo Ore & Produttività? [S/n]: ").strip().lower()
        if answer not in ("", "s", "si", "sì", "y", "yes"):
            print("Sincronizzazione annullata.")
            await browser.close()
            return

        cleaned = [{k: v for k, v in e.items() if not k.startswith("_")} for e in events]
        status, result = post_json(
            APP_API,
            {
                "action": "ingestAgendaCompany",
                "date": wanted,
                "events": cleaned,
                "scannedResources": sorted(scanned_sigle)
            },
            token
        )
        print("\nRisultato:", json.dumps(result, ensure_ascii=False, indent=2))
        if status >= 300:
            raise RuntimeError(result.get("error", "Errore durante la sincronizzazione aziendale."))

        print(
            f"\nSalvate: {result.get('saved', 0)} · "
            f"Da abbinare: {result.get('unmatched', 0)} · "
            f"Ambigue: {result.get('ambiguous', 0)} · "
            f"Agende scorse: {result.get('scannedResources', 0)}"
        )
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
