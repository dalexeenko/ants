#!/usr/bin/env bash
# Runnable tour of Ants capabilities in a dev checkout (e.g. github.com/dalexeenko/ants).
# Does not call paid LLM APIs — focuses on CLI, build, and documented server flows.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "== Ants capabilities demo (dev tree) =="
echo

echo "-- 1) Workspace build (server + CLI) --"
pnpm turbo build --filter=@ants/server --filter=@ants/agent-cli

echo
echo "-- 2) CLI: help, models, bundled skills --"
node packages/cli/dist/bin.js --help | head -n 24
echo
node packages/cli/dist/bin.js models list | head -n 12
echo
node packages/cli/dist/bin.js skill list | head -n 16

echo
echo "-- 3) Agent HTTP helper server (from tests) --"
echo "See tests/agent-e2e-tests/tests/http-server.test.ts for /healthz, /readyz, /beta/conversations."
echo "Run: pnpm --filter @ants/agent-e2e-tests test"

echo
echo "-- 4) Self-hosted server (optional) --"
echo "Generate a key once, then start with web UIs enabled:"
echo "  export ANTS_ENCRYPTION_KEY=\$(openssl rand -base64 32)"
echo "  export ANTS_HOST=0.0.0.0"
echo "  export ANTS_WEB_APP=true"
echo "  pnpm dev:server"
echo "Main UI is served from / (server-ui). Optional app UI is at /app when ANTS_WEB_APP=true."
echo "APIs are under /api/beta/ (see apps/server/src/routes/index.ts)."

echo
echo "Demo finished."
