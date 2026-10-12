#!/usr/bin/env bash
# Prepare on a branch; publication is the merge of the verified PR into main.
# Never stages unrelated files or runs tests against company data.
set -euo pipefail
cd "$(dirname "$0")"
git -c safe.directory="$PWD" rev-parse --show-toplevel >/dev/null
case "${1:-}" in
  --prepare) exec node scripts/prepare-release.cjs "${2:-1.0.0-rc.1}" ;;
  --verify) exec node scripts/check-deployment.cjs ;;
  *) echo 'Uso: ./pubblica.sh --prepare (candidato e test); ./pubblica.sh --verify (Pages, sola lettura).' >&2
     echo 'Pubblicazione: PR verso main, gate verdi e backend verificato; nessun push diretto da questo script.' >&2
     exit 1 ;;
esac
