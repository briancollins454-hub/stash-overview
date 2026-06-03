#!/usr/bin/env bash
# Claude Desktop MCP entrypoint — loads repo .env then starts stdio MCP (no OAuth).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

load_env() {
  local f="$1"
  [[ -f "$f" ]] || return 0
  set -a
  # shellcheck disable=SC1090
  source "$f"
  set +a
}

load_env "$ROOT/.env"
load_env "$ROOT/.env.local"

exec npm run mcp:stash --silent
