#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Usage: $0 [--force-host] [--web-server apache|nginx] [-h|--help]"
  echo "  --force-host  Override only the hostname safety check (deployment requires root)."
  echo "  --web-server apache|nginx  Select the web server to reload (default: apache)."
  echo "  -h, --help    Show this help and exit."
}

FORCE_HOST=false
SHOW_HELP=false
WEB_SERVER="apache"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --force-host) FORCE_HOST=true ;;
    -h|--help) SHOW_HELP=true ;;
    --web-server)
      if [[ $# -lt 2 || "$2" == -* ]]; then
        echo "[ERROR] --web-server requires a value: apache or nginx" >&2
        usage >&2
        exit 1
      fi
      case "$2" in
        apache|nginx) WEB_SERVER="$2" ;;
        *)
          echo "[ERROR] Invalid web server: $2 (expected apache or nginx)" >&2
          usage >&2
          exit 1
          ;;
      esac
      shift
      ;;
    *)
      echo "[ERROR] Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
  shift
done

if [[ "$SHOW_HELP" == true ]]; then
  usage
  exit 0
fi

# --------------------------------------------------
# CONFIG
# --------------------------------------------------
EXPECTED_HOST="lupo-apps-01"
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_ROOT="$PROJECT_ROOT"
VENV_DIR="/opt/grim-fronteira/venv"
FRONTEND_DIST="/opt/grim-fronteira/frontend-dist"
SERVICE_NAME="grim-fronteira.service"
BUILD_PATH="/usr/bin:/bin:/usr/local/bin"
VITE_BASE_PATH="${VITE_BASE_PATH:-/grim-fronteira/}"

# --------------------------------------------------
# HELPERS
# --------------------------------------------------
run_as_app_owner() {
  sudo -u "$APP_OWNER" -H env PATH="$BUILD_PATH" bash -lc "$1"
}

run_npm_as_app_owner() {
  sudo -u "$APP_OWNER" -H bash -lc "
export NVM_DIR=\"\$HOME/.nvm\"
[ -s \"\$NVM_DIR/nvm.sh\" ] && . \"\$NVM_DIR/nvm.sh\"
nvm use 22 >/dev/null
cd \"$APP_ROOT/frontend\"
export VITE_BASE_PATH="$VITE_BASE_PATH"
npm $*
"
}

# --------------------------------------------------
# SAFETY CHECK — ENSURE WE ARE ON THE SERVER
# --------------------------------------------------
CURRENT_HOST="$(hostname -s)"

if [[ "$CURRENT_HOST" != "$EXPECTED_HOST" ]]; then
  if [[ "$FORCE_HOST" == true ]]; then
    echo "[WARNING] --force-host: overriding the hostname safety check." >&2
    echo "Expected host: '$EXPECTED_HOST'; actual host: '$CURRENT_HOST'" >&2
  else
    echo "[ERROR] This script must be run on '$EXPECTED_HOST'"
    echo "Current host: '$CURRENT_HOST'"
    echo "Use --force-host to explicitly override the hostname safety check."
    exit 1
  fi
fi

# --------------------------------------------------
# PRE-FLIGHT CHECKS
# --------------------------------------------------
if [[ "${EUID}" -ne 0 ]]; then
  echo "[ERROR] Run this script as root (for example: sudo ./scripts/deploy.sh)"
  exit 1
fi

command -v python3 >/dev/null || { echo "[ERROR] python3 not found"; exit 1; }
command -v sudo >/dev/null || { echo "[ERROR] sudo not found"; exit 1; }

APP_OWNER="${SUDO_USER:-$(stat -c '%U' "$APP_ROOT")}"
APP_GROUP="$(id -gn "$APP_OWNER")"

if [[ -z "$APP_OWNER" || "$APP_OWNER" == "root" ]]; then
  echo "[ERROR] Could not determine a non-root owner for $APP_ROOT"
  exit 1
fi

echo "== Grim Fronteira deploy =="
echo "Host: $CURRENT_HOST"
echo "Web server: $WEB_SERVER"
echo "Project: $APP_ROOT"
echo "Deploy user: root"
echo "Build user: $APP_OWNER"
echo "Build PATH: $BUILD_PATH"
echo "Frontend base: $VITE_BASE_PATH"

echo "-- Build toolchain"
run_as_app_owner "
export NVM_DIR=\"\$HOME/.nvm\"
[ -s \"\$NVM_DIR/nvm.sh\" ] && . \"\$NVM_DIR/nvm.sh\"
nvm use 22 >/dev/null
echo Node: \$(node -v)
echo NPM: \$(npm -v)
"

# --------------------------------------------------
# BACKEND
# --------------------------------------------------
echo "-- Backend dependencies"
cd "$APP_ROOT"
SYSTEM_PYTHON_VERSION="$(python3 -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')"
VENV_PYTHON_VERSION=""
if [[ -f "$VENV_DIR/pyvenv.cfg" ]]; then
  VENV_PYTHON_VERSION="$(sed -nE 's/^version[[:space:]]*=[[:space:]]*([0-9]+\.[0-9]+).*/\1/p' "$VENV_DIR/pyvenv.cfg")"
fi

# The interpreter symlink can follow an OS upgrade while site-packages stays
# under the old Python version. Inspect creation metadata, not just --version.
if [[ "$VENV_PYTHON_VERSION" != "$SYSTEM_PYTHON_VERSION" ]] || \
   ! "$VENV_DIR/bin/python" -c 'import sys; assert sys.prefix != sys.base_prefix' >/dev/null 2>&1; then
  echo "-- Recreating disposable venv for Python $SYSTEM_PYTHON_VERSION (previous: ${VENV_PYTHON_VERSION:-missing/unknown})"
  rm -rf -- "$VENV_DIR"
  python3 -m venv "$VENV_DIR"
  "$VENV_DIR/bin/python" -m pip install --upgrade pip
fi

# NOTE: adjust once requirements are cleaned up
"$VENV_DIR/bin/python" -m pip install --upgrade -r "$APP_ROOT/requirements.txt"
"$VENV_DIR/bin/python" --version
"$VENV_DIR/bin/python" -m uvicorn --version

# --------------------------------------------------
# FRONTEND
# --------------------------------------------------
echo "-- Frontend build (clean)"
rm -rf "$APP_ROOT/frontend/dist"
chown -R "$APP_OWNER:$APP_GROUP" "$APP_ROOT/frontend"
run_npm_as_app_owner ci
run_npm_as_app_owner run build
echo "-- Frontend build completed"

# --------------------------------------------------
# DEPLOY FRONTEND
# --------------------------------------------------
echo "-- Publish frontend"
rm -rf "$FRONTEND_DIST"
cp -a "$APP_ROOT/frontend/dist" "$FRONTEND_DIST"
chmod -R a+rX "$FRONTEND_DIST"

# --------------------------------------------------
# RESTART SERVICES
# --------------------------------------------------
echo "-- Restart backend"
sudo systemctl restart "$SERVICE_NAME"

echo "-- Reload $WEB_SERVER"
case "$WEB_SERVER" in
  apache) sudo systemctl reload apache2 ;;
  nginx) sudo systemctl reload nginx ;;
esac

# --------------------------------------------------
# DONE
# --------------------------------------------------
echo "== Deploy complete =="
