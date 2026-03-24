#!/usr/bin/env bash
set -euo pipefail

API_URL="${API_URL:-http://127.0.0.1:8000/api/gf/new}"
CREATOR_ID="${CREATOR_ID:-host1}"
SEED="${SEED:-42}"
VIEW="${VIEW:-debug}"
TMP_JSON="${TMP_JSON:-/tmp/gf_new.json}"

command -v curl >/dev/null 2>&1 || { echo "Error: curl not found"; exit 1; }
command -v jq >/dev/null 2>&1 || { echo "Error: jq not found"; exit 1; }

curl -sS -X POST "$API_URL" \
  -H 'Content-Type: application/json' \
  -d "{
    \"creator_id\":\"${CREATOR_ID}\",
    \"seed\":${SEED},
    \"view\":\"${VIEW}\"
  }" | tee "$TMP_JSON" >/dev/null

GAME_ID="$(jq -r '.game_id' "$TMP_JSON")"

if [[ -z "$GAME_ID" || "$GAME_ID" == "null" ]]; then
  echo "Error: no game_id found in response"
  echo
  cat "$TMP_JSON"
  exit 1
fi

echo "GAME_ID=$GAME_ID"
echo "$GAME_ID"