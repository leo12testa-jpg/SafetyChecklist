#!/usr/bin/env bash
# Comando unico per pubblicare una modifica: test -> commit -> push -> verifica che GitHub Pages
# sia davvero aggiornato. Uso: ./pubblica.sh "descrizione della modifica"
set -euo pipefail

URL_VERSIONE="https://leo12testa-jpg.github.io/SafetyChecklist/version.json"
TIMEOUT_SECONDI=300
INTERVALLO_SECONDI=5

messaggio="${1:?Uso: ./pubblica.sh \"descrizione modifica\"}"

# --- 1. deve essere lanciato dalla root del repo, su main ---
if [ ! -f "service-worker.js" ] || [ ! -d ".git" ]; then
  echo "ERRORE: esegui questo script dalla root del repo SafetyChecklist." >&2
  exit 1
fi

branch_attuale=$(git rev-parse --abbrev-ref HEAD)
if [ "$branch_attuale" != "main" ]; then
  echo "ERRORE: sei sul branch '$branch_attuale', non su 'main'. Interrotto senza modificare nulla." >&2
  exit 1
fi

# --- 2. test: lo script si ferma da solo (set -e) se node --test esce con errore ---
echo "==> Eseguo i test..."
export NODE_PATH="${NODE_PATH:-$(npm root -g)}"
if ! node -e "require('playwright')" >/dev/null 2>&1; then
  echo "ERRORE: Playwright non disponibile. Il controllo browser/layout è obbligatorio: installa playwright@1.55.0 e Chromium, oppure imposta NODE_PATH. Pubblicazione interrotta." >&2
  exit 1
fi
node --test "tests/**/*.test.js"
node tests/ore-robustezza-browser.cjs
node tests/ore-layout-audit.cjs

# --- 3. nuovo BUILD_ID (timestamp, non l'hash del commit: bumpare service-worker.js dopo aver
#         letto l'hash cambierebbe l'hash stesso, un riferimento autoreferenziale) ---
build_id=$(date +%Y%m%d-%H%M%S)
echo "==> Nuova versione: $build_id"

# --- 4. propaga lo STESSO BUILD_ID a tutti gli asset della SafetyChecklist.
# È fondamentale: se version.json cambia ma index/SW restano con query string vecchie,
# alcuni dispositivi possono continuare a eseguire sync/import precedenti dalla cache.
sed -i -E "s/(const CACHE_NAME = 'safety-checklist-shell-)[^']+(')/\1${build_id}\2/" service-worker.js
sed -i -E "s/(const BUILD_ID = ')[^']+(')/\1${build_id}\2/" js/aggiornamento.js
sed -i -E "s/\\?v=[0-9]{8}-[0-9]{6}/?v=${build_id}/g" index.html
sed -i -E "s/\\?v=[0-9]{8}-[0-9]{6}/?v=${build_id}/g" service-worker.js
printf '{\n  "buildId": "%s"\n}\n' "$build_id" > version.json

# --- 5. git add SOLO dei file tracciati modificati (mai git add -A: test-sample/ e altri file
#         untracked non pertinenti non vanno mai inclusi) + i file che questo script genera ---
git add -u
git add service-worker.js version.json

if git diff --cached --quiet; then
  echo "ERRORE: nessuna modifica da pubblicare (working tree già allineato)." >&2
  exit 1
fi

# --- 6. commit e push (il deploy su GitHub Pages è già automatico su ogni push a main) ---
git commit -m "$messaggio (build $build_id)"

echo "==> Push su origin main..."
git push origin main

# --- 7. polling di version.json finché GitHub Pages non pubblica davvero il nuovo BUILD_ID ---
echo "==> Verifico la pubblicazione su GitHub Pages (timeout ${TIMEOUT_SECONDI}s)..."
scadenza=$((SECONDS + TIMEOUT_SECONDI))
id_online=""

while [ "$SECONDS" -lt "$scadenza" ]; do
  id_online=$(curl -fsS "${URL_VERSIONE}?t=$(date +%s%N)" 2>/dev/null | grep -o '"buildId"[[:space:]]*:[[:space:]]*"[^"]*"' | grep -o '"[^"]*"$' | tr -d '"' || true)

  if [ "$id_online" = "$build_id" ]; then
    echo ""
    echo "PUBBLICAZIONE COMPLETATA"
    echo "Versione: $build_id"
    echo "GitHub Pages aggiornato"
    echo "Ora puoi ricaricare l'app"
    exit 0
  fi

  sleep "$INTERVALLO_SECONDI"
done

echo ""
echo "ATTENZIONE: timeout di ${TIMEOUT_SECONDI}s raggiunto." >&2
echo "GitHub Pages non risulta ancora aggiornato alla versione $build_id (trovato: '${id_online:-nessuna risposta}')." >&2
echo "Il commit e il push sono comunque andati a buon fine: riprova a controllare tra qualche minuto." >&2
exit 1
