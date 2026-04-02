#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# deploy.sh — Build & deploy pi-monitor to Raspberry Pi
#
# Usage:
#   ./deploy/deploy.sh                     # uses PI_HOST from env or default
#   PI_HOST=YOUR-PI-LAN-IP ./deploy/deploy.sh
#
# Requires: rsync, ssh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# ── Config ─────────────────────────────────────────────────────────────────
PI_HOST="${PI_HOST:-YOUR-PI-LAN-IP}"
PI_USER="${PI_USER:-pi}"
PI_DIR="/opt/pi-monitor"
FRONTEND_DIR="$(cd "$(dirname "$0")/../frontend" && pwd)"
API_DIR="$(cd "$(dirname "$0")/../api" && pwd)"
SERVICE="pi-monitor-api"

RED='\033[0;31m'; GREEN='\033[0;32m'; BLUE='\033[0;34m'; YELLOW='\033[1;33m'; BOLD='\033[1m'; NC='\033[0m'
ok()   { echo -e "${GREEN}✓${NC}  $*"; }
info() { echo -e "${BLUE}→${NC}  $*"; }
warn() { echo -e "${YELLOW}⚠${NC}  $*"; }
die()  { echo -e "${RED}✗  ERROR:${NC} $*" >&2; exit 1; }
step() { echo -e "\n${BOLD}── $* ──${NC}"; }

# ── SSH helper ─────────────────────────────────────────────────────────────
SSH_KEY="${SSH_KEY:-$HOME/.ssh/pi_key}"
SSH_KEY_OPT=""
[ -f "$SSH_KEY" ] && SSH_KEY_OPT="-i $SSH_KEY"
SSH_OPTS="$SSH_KEY_OPT -o StrictHostKeyChecking=no -o ConnectTimeout=10 -o BatchMode=no"
SSH_CMD="ssh $SSH_OPTS"

run_ssh()   { eval "$SSH_CMD ${PI_USER}@${PI_HOST} \"$*\""; }
run_rsync() {
    local src="$1" dst="$2" extra="${3:-}"
    eval "rsync -az --delete $extra -e \"ssh $SSH_OPTS\" \"$src\" \"${PI_USER}@${PI_HOST}:$dst\""
}

# ── Step 0: Version check ───────────────────────────────────────────────────
step "Version check"
LOCAL_VERSION=$(node -e "process.stdout.write(require('$FRONTEND_DIR/package.json').version)")
info "Local version: $LOCAL_VERSION"

DEPLOYED_VERSION=$(ssh $SSH_OPTS ${PI_USER}@${PI_HOST} \
    "grep -o '\"version\": *\"[^\"]*\"' $PI_DIR/frontend/build-info.json 2>/dev/null | grep -o '[0-9][^\"]*' || echo none")
info "Deployed version: $DEPLOYED_VERSION"

if [ "$LOCAL_VERSION" = "$DEPLOYED_VERSION" ]; then
    die "Version $LOCAL_VERSION is already deployed. Bump the version in frontend/package.json before deploying."
fi
ok "Version changed: $DEPLOYED_VERSION → $LOCAL_VERSION"

# ── Step 1: Build frontend ──────────────────────────────────────────────────
BUILD_TS=$(date -u +%Y%m%d%H%M%S)
step "Building frontend v$LOCAL_VERSION (build: $BUILD_TS)"
cd "$FRONTEND_DIR"
export NEXT_PUBLIC_BUILD_ID="$BUILD_TS"

info "Running npm run build..."
npm run build 2>&1 | tail -20
ok "Frontend built → out/"

# Write build-info including version so next deploy can compare
echo "{\"version\": \"$LOCAL_VERSION\", \"build\": \"$BUILD_TS\", \"deployed\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}" \
    > "$FRONTEND_DIR/out/build-info.json"

# ── Step 2: Verify Pi is reachable ─────────────────────────────────────────
step "Checking Pi connectivity"
if ! run_ssh "echo ok" &>/dev/null; then
    die "Cannot reach ${PI_USER}@${PI_HOST}. Check that ~/.ssh/pi_key exists."
fi
ok "Pi is reachable"

# ── Step 3: Sync API ────────────────────────────────────────────────────────
step "Syncing API"
run_rsync "$API_DIR/" "$PI_DIR/api" "--exclude=__pycache__ --exclude=*.pyc --exclude=.env"
ok "API synced"

# ── Step 4: Sync frontend ───────────────────────────────────────────────────
step "Syncing frontend (static export)"
run_ssh "mkdir -p $PI_DIR/frontend"
run_rsync "$FRONTEND_DIR/out/" "$PI_DIR/frontend"
ok "Frontend synced"

# ── Step 5: Ensure nginx is installed + configured ─────────────────────────
step "Configuring nginx"
NGINX_CONF=$(cat <<'NGINX'
server {
    listen 3001;
    server_name _;

    gzip on;
    gzip_types application/json application/javascript text/css text/html text/plain;
    gzip_min_length 1024;
    gzip_proxied any;

    root /opt/pi-monitor/frontend;
    index index.html;

    location /api/ {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 30s;
    }

    location ~* \.html$ {
        add_header Cache-Control "no-store, no-cache, must-revalidate, proxy-revalidate";
        add_header Pragma "no-cache";
        add_header Expires "0";
        try_files $uri $uri/ /index.html;
    }

    location = /build-info.json {
        add_header Cache-Control "no-store";
    }

    location /_next/static/ {
        add_header Cache-Control "public, max-age=31536000, immutable";
    }

    location / {
        try_files $uri $uri/ $uri.html =404;
    }
}
NGINX
)

run_ssh "command -v nginx &>/dev/null || sudo apt-get install -y -qq nginx"
echo "$NGINX_CONF" | eval "$SSH_CMD ${PI_USER}@${PI_HOST} 'sudo tee /etc/nginx/sites-available/pi-monitor > /dev/null'"
run_ssh "sudo ln -sf /etc/nginx/sites-available/pi-monitor /etc/nginx/sites-enabled/pi-monitor"
run_ssh "sudo rm -f /etc/nginx/sites-enabled/default"
run_ssh "sudo nginx -t && sudo systemctl reload nginx || sudo systemctl start nginx"
run_ssh "sudo systemctl enable nginx"
ok "nginx configured (serving on :3001)"

# ── Step 6: Restart API service ────────────────────────────────────────────
step "Restarting API service"
run_ssh "sudo systemctl restart $SERVICE"
sleep 3
if run_ssh "systemctl is-active --quiet $SERVICE"; then
    ok "API service running"
else
    warn "Service may have failed — checking logs..."
    run_ssh "journalctl -u $SERVICE -n 20 --no-pager" || true
    die "API failed to start"
fi

# ── Step 7: Health check ────────────────────────────────────────────────────
step "Health check"
sleep 1
PING=$(eval "$SSH_CMD ${PI_USER}@${PI_HOST} 'curl -sf http://127.0.0.1:8080/api/ping'" || echo "FAIL")
if echo "$PING" | grep -q '"ok"'; then
    ok "API: $PING"
else
    die "API health check failed: $PING"
fi

DEPLOYED_BUILD=$(run_ssh "cat $PI_DIR/frontend/build-info.json 2>/dev/null || echo unknown")
ok "Frontend deployed: $DEPLOYED_BUILD"

# ── Done ───────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}${GREEN}Deployment complete!${NC}"
echo ""
echo "  Version:    v$LOCAL_VERSION"
echo "  Frontend:   http://${PI_HOST}:3001"
echo "  API:        http://${PI_HOST}:8080/api/ping"
echo "  Build ID:   $BUILD_TS"
echo ""
