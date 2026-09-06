#!/usr/bin/env bash
# Starts the API and the web app together, and stops both on Ctrl-C.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  echo "No .env found. Run:  pnpm db:reset" >&2
  exit 1
fi
set -a; . ./.env; set +a

if ! docker compose exec -T db pg_isready -U pm -d pm >/dev/null 2>&1; then
  echo "PostgreSQL is not running. Start it with:  docker compose up -d" >&2
  echo "(or rebuild from scratch with:  pnpm db:reset)" >&2
  exit 1
fi

# Both children die with this script, however it exits.
trap 'kill 0' EXIT INT TERM

echo "API   → http://localhost:3000"
# `tsx watch`, not plain `tsx`: without it a backend edit is silently ignored while the web app
# hot-reloads around it, so a new request field looks accepted and is quietly dropped.
pnpm --filter backend exec tsx watch src/server.ts 2>&1 | sed 's/^/[api] /' &

echo "Web   → http://localhost:5173"
pnpm --filter frontend exec vite --port 5173 2>&1 | sed 's/^/[web] /' &

echo "Mail  → http://localhost:8025   (catches notification email)"
echo
echo "Open http://localhost:5173 — Ctrl-C stops both."
wait
