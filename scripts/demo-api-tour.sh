#!/usr/bin/env bash
#
# Interactive tour of the Ants HTTP API (versioned under /api/beta).
#
# Prerequisites (dalexeenko/ants monorepo):
#   pnpm install && pnpm build
#   ANTS_ENCRYPTION_KEY=$(openssl rand -base64 32) pnpm dev:server
#   Copy ANTS_SECRET from the startup banner or ~/.config/ants-server/config.json
#
# Usage:
#   export ANTS_SECRET='<your bearer token>'
#   bash scripts/demo-api-tour.sh
#
# Optional:
#   ANTS_BASE_URL=http://127.0.0.1:6647   (default)
#

set -euo pipefail

BASE="${ANTS_BASE_URL:-http://127.0.0.1:6647}"
PREFIX="/api/beta"

say() { printf '\n=== %s ===\n' "$*"; }

curl_json() {
  local method="$1"
  local path="$2"
  shift 2
  curl -sS -X "$method" "${BASE}${PREFIX}${path}" \
    -H 'Content-Type: application/json' \
    "${@}"
}

say "Public health (no auth)"
if ! HEALTH_JSON="$(curl -sS --max-time 5 "${BASE}${PREFIX}/health" 2>/dev/null)"; then
  echo "Could not reach ${BASE}${PREFIX}/health. Start the server first, for example:" >&2
  echo "  ANTS_ENCRYPTION_KEY=\$(openssl rand -base64 32) pnpm dev:server" >&2
  exit 1
fi
printf '%s\n' "${HEALTH_JSON}" | head -c 2000
echo

if [[ -z "${ANTS_SECRET:-}" ]]; then
  printf '\nSet ANTS_SECRET to your single-user bearer token (from server startup or config.json)\n'
  printf 'to continue with authenticated examples. Multi-user Docker Compose uses\n'
  printf 'GET %s/setup/status and POST %s/setup instead — see apps/server/docker-compose.yml.\n' "${PREFIX}" "${PREFIX}"
  exit 0
fi

say "List projects (Bearer auth)"
curl_json GET '/projects' -H "Authorization: Bearer ${ANTS_SECRET}" | head -c 4000
echo

DEMO_WS="$(mktemp -d "${TMPDIR:-/tmp}/ants-demo-ws.XXXXXX")"
trap 'rm -rf "${DEMO_WS}"' EXIT

CREATE_BODY="$(node -e "console.log(JSON.stringify({name: 'demo-' + Date.now(), workingDirectory: process.argv[1]}))" "${DEMO_WS}")"

say "Create a demo project (isolated temp directory: ${DEMO_WS})"
RESP="$(curl_json POST '/projects' -H "Authorization: Bearer ${ANTS_SECRET}" -d "${CREATE_BODY}")"
echo "${RESP}" | head -c 4000
echo

PROJECT_ID="$(node -e "try{console.log(JSON.parse(process.argv[1]).id||'')}catch{console.log('')}" "${RESP}")"
if [[ -z "${PROJECT_ID}" ]]; then
  echo "Could not parse project id from response; skipping project-scoped demo."
  exit 0
fi

say "Fetch project ${PROJECT_ID}"
curl_json GET "/projects/${PROJECT_ID}" -H "Authorization: Bearer ${ANTS_SECRET}" | head -c 4000
echo

say "What you can do next"
cat <<EOF
- Web UI (when ANTS_WEB_APP=true): open ${BASE}/ and exchange the token for a session:
    ${BASE}/api/beta/auth/session?token=<ANTS_SECRET>&redirect=/settings
- MCP servers per project: POST ${BASE}${PREFIX}/projects/<id>/mcp/servers
- Agent sessions: POST ${BASE}${PREFIX}/projects/<id>/sessions (see server routes / schemas)
- This script source: scripts/demo-api-tour.sh
EOF
