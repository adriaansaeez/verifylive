#!/usr/bin/env bash
# Usage: NAN_KEY=... ./clef.sh [request.json]
# Sends a Clef request to NaN and retries on 429 after one second (one request at a time per person).
set -euo pipefail

: "${NAN_KEY:?Set NAN_KEY to your NaN API key}"
BODY_FILE="${1:-$(dirname "$0")/request.json}"
URL="https://api.nan.builders/v1/systemone"
MAX_RETRIES=5

for ((attempt = 1; attempt <= MAX_RETRIES; attempt++)); do
  response="$(curl -sS --max-time 50 -w '\n%{http_code}' "$URL" \
    -H "Authorization: Bearer $NAN_KEY" \
    -H "Content-Type: application/json" \
    --data-binary "@$BODY_FILE")"
  status="${response##*$'\n'}"
  body="${response%$'\n'*}"

  if [[ "$status" != "429" ]]; then
    printf '%s\n' "$body"
    [[ "$status" =~ ^2 ]] && exit 0
    echo "HTTP $status" >&2
    exit 1
  fi
  echo "429: too many requests, retrying in 1s ($attempt/$MAX_RETRIES)" >&2
  sleep 1
done

echo "Gave up after $MAX_RETRIES retries" >&2
exit 1
