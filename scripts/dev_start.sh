#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

BACKEND_HOST="127.0.0.1"
BACKEND_PORT="8000"
FRONTEND_HOST="0.0.0.0"
FRONTEND_PORT="5173"
FRONTEND_BASE="/grim-fronteira/"

VENV_PYTHON="$ROOT_DIR/.venv/bin/python"
FRONTEND_DIR="$ROOT_DIR/frontend"

BACKEND_PID=""
FRONTEND_PID=""

cleanup() {
  echo
  echo "Stopping dev servers..."
  [[ -n "${BACKEND_PID:-}" ]] && kill "$BACKEND_PID" 2>/dev/null || true
  [[ -n "${FRONTEND_PID:-}" ]] && kill "$FRONTEND_PID" 2>/dev/null || true
}

die() {
  echo "[ERROR] $1" >&2
  exit 1
}

trap cleanup EXIT INT TERM

echo "== Grim Fronteira dev start =="
echo "Project root: $ROOT_DIR"

# ----------------------------------------
# Pre-flight checks
# ----------------------------------------
[[ -x "$VENV_PYTHON" ]] || die "Virtualenv python not found at $VENV_PYTHON"

command -v npm >/dev/null 2>&1 || die "npm not found in PATH"

[[ -d "$FRONTEND_DIR" ]] || die "Frontend directory not found at $FRONTEND_DIR"
[[ -f "$FRONTEND_DIR/package.json" ]] || die "frontend/package.json not found"
[[ -d "$FRONTEND_DIR/node_modules" ]] || die "frontend/node_modules not found. Run: cd frontend && npm install"

echo "-- Backend python"
"$VENV_PYTHON" --version

echo "-- Frontend npm"
npm --version

# ----------------------------------------
# Start backend
# ----------------------------------------
(
  cd "$ROOT_DIR"
  PYTHONPATH=. "$VENV_PYTHON" -m uvicorn backend.app.main:app \
    --reload \
    --host "$BACKEND_HOST" \
    --port "$BACKEND_PORT"
) &
BACKEND_PID=$!

# Give backend a moment to fail fast if broken
sleep 1
if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
  die "Backend failed to start"
fi

# ----------------------------------------
# Start frontend
# ----------------------------------------
(
  cd "$FRONTEND_DIR"
  npm run dev -- --host "$FRONTEND_HOST" --port "$FRONTEND_PORT"
) &
FRONTEND_PID=$!

sleep 1
if ! kill -0 "$FRONTEND_PID" 2>/dev/null; then
  die "Frontend failed to start"
fi

echo "Backend PID: $BACKEND_PID"
echo "Frontend PID: $FRONTEND_PID"

echo
echo "Dev servers running:"
echo "  Backend : http://${BACKEND_HOST}:${BACKEND_PORT}"
echo "  Frontend: http://127.0.0.1:${FRONTEND_PORT}${FRONTEND_BASE}"
echo "  Network : http://<your-lan-or-tailscale-ip>:${FRONTEND_PORT}${FRONTEND_BASE}"
echo
echo "Press Ctrl+C to stop both."

# Wait until either process exits, then fail the script so cleanup runs.
wait -n "$BACKEND_PID" "$FRONTEND_PID"
die "One of the dev servers exited unexpectedly"