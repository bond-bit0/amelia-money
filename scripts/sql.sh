#!/usr/bin/env bash
# Run a SQL file (or stdin) against the Supabase project through the Management API.
# Usage: scripts/sql.sh file.sql   |   echo "select 1" | scripts/sql.sh
set -euo pipefail
REF="${SUPABASE_REF:-dzeovhcqdnsripunokfx}"
SQL="$(cat "${1:-/dev/stdin}")"
python3 -c 'import json,sys; print(json.dumps({"query": sys.stdin.read()}))' <<<"$SQL" |
  curl -sS -X POST "https://api.supabase.com/v1/projects/$REF/database/query" \
    -H 'Content-Type: application/json' ${SUPABASE_ACCESS_TOKEN:+-H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN"} --data-binary @-
echo
