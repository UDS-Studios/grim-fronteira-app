#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

BACKEND_HOST="127.0.0.1"
BACKEND_PORT="8000"
FRONTEND_PORT="5173"

cleanup() {
  echo
  echo "Stopping dev servers..."
  [[ -n "${BACKEND_PID:-}" ]] && kill "$BACKEND_PID" 2>/dev/null || true
  [[ -n "${FRONTEND_PID:-}" ]] && kill "$FRONTEND_PID" 2>/dev/null || true
}

trap cleanup EXIT INT TERM

echo "== Grim Fronteira dev start =="
echo "Project root: $ROOT_DIR"

cd "$ROOT_DIR"

echo
echo "Starting backend on http://${BACKEND_HOST}:${BACKEND_PORT}"
PYTHONPATH=. uvicorn backend.app.main:app --reload --host "$BACKEND_HOST" --port "$BACKEND_PORT" &
BACKEND_PID=$!

echo "Backend PID: $BACKEND_PID"

echo
echo "Starting frontend on http://${BACKEND_HOST}:${FRONTEND_PORT}"
npm run dev &
FRONTEND_PID=$!

echo "Frontend PID: $FRONTEND_PID"

echo
echo "Dev servers running:"
echo "  Backend : http://${BACKEND_HOST}:${BACKEND_PORT}"
echo "  Frontend: http://${BACKEND_HOST}:${FRONTEND_PORT}"
echo
echo "Press Ctrl+C to stop both."

wait