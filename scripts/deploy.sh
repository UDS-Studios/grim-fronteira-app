#!/usr/bin/env bash
set -euo pipefail

# --------------------------------------------------
# CONFIG
# --------------------------------------------------
EXPECTED_HOST="lupoegatta"
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_ROOT="$PROJECT_ROOT"
VENV_DIR="/opt/grim-fronteira/venv"
FRONTEND_DIST="/opt/grim-fronteira/frontend-dist"
SERVICE_NAME="grim-fronteira.service"
BUILD_PATH="/usr/bin:/bin:/usr/local/bin"

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
npm $*
"
}

# --------------------------------------------------
# SAFETY CHECK — ENSURE WE ARE ON THE SERVER
# --------------------------------------------------
CURRENT_HOST="$(hostname -s)"

if [[ "$CURRENT_HOST" != "$EXPECTED_HOST" ]]; then
  echo "[ERROR] This script must be run on '$EXPECTED_HOST'"
  echo "Current host: '$CURRENT_HOST'"
  exit 1
fi

# --------------------------------------------------
# PRE-FLIGHT CHECKS
# --------------------------------------------------
if [[ "${EUID}" -ne 0 ]]; then
  echo "[ERROR] Run this script as root (for example: sudo ./scripts/deploy.sh)"
  exit 1
fi

command -v npm >/dev/null || { echo "[ERROR] npm not found"; exit 1; }
command -v python3 >/dev/null || { echo "[ERROR] python3 not found"; exit 1; }
command -v sudo >/dev/null || { echo "[ERROR] sudo not found"; exit 1; }

if [[ ! -x "$VENV_DIR/bin/python" ]]; then
  echo "[ERROR] Python venv not found at $VENV_DIR"
  exit 1
fi

APP_OWNER="${SUDO_USER:-$(stat -c '%U' "$APP_ROOT")}"
APP_GROUP="$(id -gn "$APP_OWNER")"

if [[ -z "$APP_OWNER" || "$APP_OWNER" == "root" ]]; then
  echo "[ERROR] Could not determine a non-root owner for $APP_ROOT"
  exit 1
fi

echo "== Grim Fronteira deploy =="
echo "Host: $CURRENT_HOST"
echo "Project: $APP_ROOT"
echo "Deploy user: root"
echo "Build user: $APP_OWNER"
echo "Build PATH: $BUILD_PATH"

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
source "$VENV_DIR/bin/activate"

# NOTE: adjust once requirements are cleaned up
pip install --upgrade -r requirements.txt

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

echo "-- Reload apache"
sudo systemctl reload apache2

# --------------------------------------------------
# DONE
# --------------------------------------------------
echo "== Deploy complete =="
