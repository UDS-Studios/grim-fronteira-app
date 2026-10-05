#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'HELP'
Usage:
  ./scripts/dev_start.sh
      Start backend + Vite development frontend.
  ./scripts/dev_start.sh --production
      Start backend + production-built frontend preview.

Options:
  --production  Build and preview the production frontend locally.
  -h, --help    Show this help without starting servers.
HELP
}

PRODUCTION=false
for arg in "$@"; do
  case "$arg" in
    --production) PRODUCTION=true ;;
    -h|--help) usage; exit 0 ;;
    *) echo "[ERROR] Unknown option: $arg" >&2; usage >&2; exit 1 ;;
  esac
done

FRONTEND_MODE="development"
$PRODUCTION && FRONTEND_MODE="production preview"

# Give each background server its own process group, including its children.
set -m

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
PREVIEW_CONFIG=""

cleanup() {
  trap - EXIT INT TERM
  if [[ -n "$BACKEND_PID" || -n "$FRONTEND_PID" ]]; then
    echo
    echo "Stopping local servers..."
  fi
  for pid in "$FRONTEND_PID" "$BACKEND_PID"; do
    [[ -n "$pid" ]] || continue
    kill -- "-$pid" 2>/dev/null || true
  done
  for pid in "$FRONTEND_PID" "$BACKEND_PID"; do
    [[ -n "$pid" ]] || continue
    wait "$pid" 2>/dev/null || true
  done
  [[ -z "$PREVIEW_CONFIG" ]] || rm -f "$PREVIEW_CONFIG"
}

die() {
  echo "[ERROR] $1" >&2
  exit 1
}

trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

echo "== Grim Fronteira dev start =="
echo "Project root: $ROOT_DIR"
echo "Frontend mode: $FRONTEND_MODE"

# ----------------------------------------
# Pre-flight checks
# ----------------------------------------
[[ -x "$VENV_PYTHON" ]] || die "Virtualenv python not found at $VENV_PYTHON"

command -v npm >/dev/null 2>&1 || die "npm not found in PATH"

[[ -d "$FRONTEND_DIR" ]] || die "Frontend directory not found at $FRONTEND_DIR"
[[ -f "$FRONTEND_DIR/package.json" ]] || die "frontend/package.json not found"
[[ -d "$FRONTEND_DIR/node_modules" ]] || die "frontend/node_modules not found. Run: cd frontend && npm install"

if $PRODUCTION; then
  "$VENV_PYTHON" - "$FRONTEND_DIR/package.json" <<'PYTHON' || die "Production mode requires npm build and preview scripts"
import json, sys
with open(sys.argv[1]) as source:
    scripts = json.load(source).get("scripts", {})
sys.exit(0 if all(scripts.get(name) for name in ("build", "preview")) else 1)
PYTHON

  echo "-- Building production frontend"
  if ! (cd "$FRONTEND_DIR" && npm run build); then
    die "Frontend production build failed; preview was not started"
  fi

  # The deployed bundle uses a prefixed API URL. Adapt only the local preview
  # proxy; leave the checked-in Vite config and production build unchanged.
  PREVIEW_CONFIG="$(mktemp "$FRONTEND_DIR/.dev-preview.XXXXXX.mjs")"
  cat > "$PREVIEW_CONFIG" <<'CONFIG'
import { mergeConfig } from "vite";
import config from "./vite.config.ts";
export default mergeConfig(config, {
  preview: {
    proxy: {
      "/grim-fronteira/api": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
        rewrite: path => path.replace(/^\/grim-fronteira/, ""),
      },
    },
  },
});
CONFIG
fi

echo "-- Backend python"
"$VENV_PYTHON" --version

echo "-- Frontend npm"
npm --version

# ----------------------------------------
# Start backend
# ----------------------------------------
(
  cd "$ROOT_DIR"
  export PYTHONPATH=.
  exec "$VENV_PYTHON" -m uvicorn backend.app.main:app \
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
  if $PRODUCTION; then
    exec npm run preview -- --host "$FRONTEND_HOST" --port "$FRONTEND_PORT" --config "$PREVIEW_CONFIG"
  else
    exec npm run dev -- --host "$FRONTEND_HOST" --port "$FRONTEND_PORT"
  fi
) &
FRONTEND_PID=$!

sleep 1
if ! kill -0 "$FRONTEND_PID" 2>/dev/null; then
  die "Frontend failed to start"
fi

echo "Backend PID: $BACKEND_PID"
echo "Frontend PID: $FRONTEND_PID"

echo
echo "Local servers running:"
echo "  Backend : http://${BACKEND_HOST}:${BACKEND_PORT}"
echo "  Frontend: http://127.0.0.1:${FRONTEND_PORT}${FRONTEND_BASE} ($FRONTEND_MODE)"
echo "  Network : http://<your-lan-or-tailscale-ip>:${FRONTEND_PORT}${FRONTEND_BASE} ($FRONTEND_MODE)"
echo
echo "Press Ctrl+C to stop both."

# Wait until either process exits, then fail the script so cleanup runs.
wait -n "$BACKEND_PID" "$FRONTEND_PID" || die "One of the local servers exited unexpectedly"
die "One of the local servers exited unexpectedly"
