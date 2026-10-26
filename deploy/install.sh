#!/usr/bin/env bash
set -euo pipefail

# VITESTERTL Debian installer.
#
# Supported targets: Debian 12/13 and Debian derivatives with systemd + nginx.
# The panel and its workloads run on this host; there is no remote agent to
# install. This script installs the Python/Node build dependencies, builds the
# frontend, creates the service account and data directory, and enables the
# systemd unit and nginx reverse proxy.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="${VITESTL_APP_DIR:-/opt/vitestl}"
DATA_DIR="${VITESTL_DATA_DIR:-/var/lib/vitestl}"
ENV_FILE="/etc/vitestl.env"
SERVICE_NAME="vitestl"
DOMAIN="_"
LISTEN_PORT="80"
ADMIN_PASS=""
WITH_DOCKER=0
NO_BUILD=0
NO_NGINX=0
FORCE=0

log()  { printf '\033[1;34m[vitestl]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[vitestl]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[vitestl]\033[0m %s\n' "$*" >&2; exit 1; }

usage() {
  cat <<'EOF'
Usage: sudo bash deploy/install.sh [options]

Options:
  --domain NAME       nginx server_name (default: _)
  --port PORT         nginx listen port (default: 80)
  --app-dir PATH      application directory (default: /opt/vitestl)
  --data-dir PATH     writable data directory (default: /var/lib/vitestl)
  --admin-pass PASS   initial admin password for a fresh install
  --with-docker       install Docker and allow Docker-backed eggs
  --no-build          reuse an existing frontend/dist build
  --no-nginx          skip nginx installation
  --force             continue on a non-Debian distribution
  -h, --help          show this help

Examples:
  sudo bash deploy/install.sh --domain panel.example.com
  sudo bash deploy/install.sh --with-docker --domain panel.example.com
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --domain) DOMAIN="${2:-}"; shift 2 ;;
    --port) LISTEN_PORT="${2:-80}"; shift 2 ;;
    --app-dir) APP_DIR="${2:-}"; shift 2 ;;
    --data-dir) DATA_DIR="${2:-}"; shift 2 ;;
    --admin-pass) ADMIN_PASS="${2:-}"; shift 2 ;;
    --with-docker) WITH_DOCKER=1; shift ;;
    --no-build) NO_BUILD=1; shift ;;
    --no-nginx) NO_NGINX=1; shift ;;
    --force) FORCE=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "Unknown option: $1 (use --help)" ;;
  esac
done

[[ "$EUID" -eq 0 ]] || die "Run this installer as root: sudo bash deploy/install.sh"
[[ -n "$DOMAIN" ]] || die "--domain cannot be empty"
[[ "$LISTEN_PORT" =~ ^[0-9]+$ ]] || die "--port must be numeric"
[[ -f "$ROOT/backend/requirements.txt" ]] || die "Run the installer from the repository root"
[[ -f "$ROOT/frontend/package.json" ]] || die "frontend/package.json is missing"

if [[ -r /etc/os-release ]]; then
  # shellcheck disable=SC1091
  . /etc/os-release
fi

case "${ID:-}" in
  debian|ubuntu|raspbian|linuxmint|pop) ;;
  *)
    if [[ "$FORCE" -ne 1 ]]; then
      die "This installer targets Debian/Ubuntu (detected: ${PRETTY_NAME:-unknown}). Use --force to continue."
    fi
    warn "Continuing on ${PRETTY_NAME:-an unsupported distribution} because --force was supplied."
    ;;
esac

log "Installing system packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends \
  python3 python3-venv python3-pip \
  nginx sqlite3 curl ca-certificates tar gnupg

python3 - <<'PY' || die "Python 3.10 or newer is required"
import sys
raise SystemExit(0 if sys.version_info >= (3, 10) else 1)
PY

node_major() {
  node -p "process.versions.node.split('.')[0]" 2>/dev/null || echo 0
}

if ! command -v node >/dev/null 2>&1; then
  log "Installing Node.js from Debian repositories"
  apt-get install -y --no-install-recommends nodejs npm
fi

if [[ "$(node_major)" -lt 18 ]]; then
  log "Installing Node.js 20 from NodeSource"
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y --no-install-recommends nodejs
  [[ "$(node_major)" -ge 18 ]] || die "Node.js 18+ is required to build the interface"
fi

if ! id vitestl >/dev/null 2>&1; then
  log "Creating the vitestl service account"
  useradd --system --home-dir "$APP_DIR" --shell /usr/sbin/nologin --no-create-home vitestl
fi

if [[ "$ROOT" != "$APP_DIR" ]]; then
  log "Copying the application to $APP_DIR"
  mkdir -p "$APP_DIR"
  tar -C "$ROOT" \
    --exclude='./.git' \
    --exclude='./.venv' \
    --exclude='./data' \
    --exclude='./frontend/node_modules' \
    -cf - . | tar -C "$APP_DIR" -xf -
fi

install -d -o vitestl -g vitestl -m 0750 "$DATA_DIR"
install -d -o root -g root -m 0755 "$APP_DIR/frontend"

log "Creating the Python environment"
python3 -m venv "$APP_DIR/.venv"
"$APP_DIR/.venv/bin/python" -m pip install --quiet --upgrade pip wheel
"$APP_DIR/.venv/bin/pip" install --quiet --no-cache-dir -r "$APP_DIR/backend/requirements.txt"

if [[ "$NO_BUILD" -eq 1 ]]; then
  [[ -f "$APP_DIR/frontend/dist/index.html" ]] || \
    die "frontend/dist is missing; run without --no-build or build it first"
  log "Reusing the existing frontend build"
else
  log "Building the interface with Node $(node -v)"
  rm -rf "$APP_DIR/frontend/dist"
  cd "$APP_DIR/frontend"
  if [[ -f package-lock.json ]]; then
    npm ci --no-audit --no-fund
  else
    npm install --no-audit --no-fund
  fi
  npm run build
  cd "$ROOT"
fi

chmod -R a+rX "$APP_DIR/frontend/dist"

if [[ ! -f "$ENV_FILE" ]]; then
  log "Writing $ENV_FILE"
  SECRET="$(python3 -c 'import secrets; print(secrets.token_hex(32))')"
  if [[ -z "$ADMIN_PASS" ]]; then
    ADMIN_PASS="$(python3 -c 'import secrets, string; a=string.ascii_letters+string.digits; print("Vt-" + "".join(secrets.choice(a) for _ in range(20)))')"
  fi
  cat > "$ENV_FILE" <<EOF
KESTREL_SECRET=$SECRET
KESTREL_ADMIN_USER=Yanxzyx
KESTREL_ADMIN_PASS=$ADMIN_PASS
KESTREL_ADMIN_EMAIL=yanxzyx@vitestl.local
VITESTL_DATA_DIR=$DATA_DIR
EOF
  chmod 600 "$ENV_FILE"
  cat > /root/vitestl-credentials.txt <<EOF
VITESTERTL initial credentials
URL:      http://${DOMAIN/_/$(hostname -I 2>/dev/null | awk '{print $1}')}:${LISTEN_PORT}/
Username: Yanxzyx
Password: ${ADMIN_PASS}
Env file: ${ENV_FILE}
Change the password after the first sign-in.
EOF
  chmod 600 /root/vitestl-credentials.txt
  log "Initial credentials saved to /root/vitestl-credentials.txt"
else
  log "Keeping the existing $ENV_FILE"
  if ! grep -q '^VITESTL_DATA_DIR=' "$ENV_FILE"; then
    printf 'VITESTL_DATA_DIR=%s\n' "$DATA_DIR" >> "$ENV_FILE"
  fi
fi

if [[ "$ROOT" != "$APP_DIR" ]]; then
  chown -R root:root "$APP_DIR"
fi
chown root:root "$ENV_FILE"
chmod 600 "$ENV_FILE"

log "Installing the systemd unit"
sed -e "s|@APP_DIR@|$APP_DIR|g" -e "s|@DATA_DIR@|$DATA_DIR|g" \
  "$APP_DIR/deploy/vitestl.service" > "/etc/systemd/system/${SERVICE_NAME}.service"
chmod 0644 "/etc/systemd/system/${SERVICE_NAME}.service"

if [[ "$WITH_DOCKER" -eq 1 ]]; then
  log "Installing Docker"
  apt-get install -y --no-install-recommends docker.io
  systemctl enable --now docker
  getent group docker >/dev/null && usermod -aG docker vitestl
  install -d -m 0755 "/etc/systemd/system/${SERVICE_NAME}.service.d"
  cat > "/etc/systemd/system/${SERVICE_NAME}.service.d/10-docker.conf" <<'EOF'
[Service]
SupplementaryGroups=docker
EOF
fi

systemctl daemon-reload
systemctl enable "$SERVICE_NAME"
systemctl restart "$SERVICE_NAME"

log "Waiting for the panel API"
READY=0
for _ in $(seq 1 40); do
  if curl -fsS http://127.0.0.1:8000/api/health >/dev/null 2>&1; then
    READY=1
    break
  fi
  sleep 0.5
done
if [[ "$READY" -ne 1 ]]; then
  journalctl -u "$SERVICE_NAME" -n 40 --no-pager || true
  die "The panel did not become healthy. Inspect: journalctl -u $SERVICE_NAME"
fi

if [[ "$NO_NGINX" -eq 0 ]]; then
  log "Configuring nginx on port $LISTEN_PORT"
  sed -e "s|@APP_DIR@|$APP_DIR|g" \
      -e "s|@SERVER_NAME@|$DOMAIN|g" \
      -e "s|@LISTEN_PORT@|$LISTEN_PORT|g" \
      "$APP_DIR/deploy/nginx.conf" > "/etc/nginx/sites-available/${SERVICE_NAME}"
  ln -sf "/etc/nginx/sites-available/${SERVICE_NAME}" "/etc/nginx/sites-enabled/${SERVICE_NAME}"
  if [[ -L /etc/nginx/sites-enabled/default ]]; then
    mv /etc/nginx/sites-enabled/default /etc/nginx/sites-enabled/default.disabled
    log "Disabled the default nginx site"
  fi
  nginx -t
  systemctl reload nginx
fi

HOST_VALUE="$DOMAIN"
if [[ "$HOST_VALUE" == "_" ]]; then
  HOST_VALUE="$(hostname -I 2>/dev/null | awk '{print $1}')"
  HOST_VALUE="${HOST_VALUE:-127.0.0.1}"
fi

log "Installation complete"
printf '\n  URL:      http://%s:%s/\n' "$HOST_VALUE" "$LISTEN_PORT"
printf '  Service:  systemctl status %s\n' "$SERVICE_NAME"
printf '  Logs:     journalctl -u %s -f\n' "$SERVICE_NAME"
printf '  Data:     %s\n' "$DATA_DIR"
if [[ -f /root/vitestl-credentials.txt ]]; then
  printf '  Login:    /root/vitestl-credentials.txt\n\n'
else
  printf '  Login:    credentials were preserved from the previous install\n\n'
fi
printf 'Next: sign in, open Administration → Nodes, and run Auto-install node.\n'
