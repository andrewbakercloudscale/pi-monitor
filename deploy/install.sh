#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# install.sh — Deploy pi-monitor API on a Raspberry Pi
#
# Run as pi user (will sudo when needed):
#   bash install.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

INSTALL_DIR="/opt/pi-monitor"
REPO_URL="https://github.com/andrewbakercloudscale/pi-monitor"
SERVICE="pi-monitor-api"

RED='\033[0;31m'; GREEN='\033[0;32m'; BLUE='\033[0;34m'; BOLD='\033[1m'; NC='\033[0m'
ok()   { echo -e "${GREEN}✓${NC}  $*"; }
info() { echo -e "${BLUE}→${NC}  $*"; }
die()  { echo -e "${RED}✗  ERROR:${NC} $*" >&2; exit 1; }

# ── 1. Install system deps ─────────────────────────────────────────────────
info "Installing system packages..."
sudo apt-get update -qq
sudo apt-get install -y -qq python3-pip python3-venv git

# ── 2. Clone / pull repo ───────────────────────────────────────────────────
if [ -d "$INSTALL_DIR/.git" ]; then
    info "Updating existing install..."
    git -C "$INSTALL_DIR" pull --ff-only
else
    info "Cloning repo..."
    sudo git clone "$REPO_URL" "$INSTALL_DIR"
    sudo chown -R pi:pi "$INSTALL_DIR"
fi

# ── 3. Python venv + deps ─────────────────────────────────────────────────
info "Setting up Python venv..."
python3 -m venv "$INSTALL_DIR/venv"
"$INSTALL_DIR/venv/bin/pip" install --quiet --upgrade pip
"$INSTALL_DIR/venv/bin/pip" install --quiet -e "$INSTALL_DIR/api"

# ── 4. Create .env if missing ─────────────────────────────────────────────
ENV_FILE="$INSTALL_DIR/.env"
if [ ! -f "$ENV_FILE" ]; then
    info "Creating .env..."
    cat > "$ENV_FILE" << 'EOF'
PIHOLE_DB=/etc/pihole/pihole-FTL.db
APP_DB=/opt/pi-monitor/app.db
BIND_HOST=127.0.0.1
BIND_PORT=8080
# CF_AUD=  (paste your CF Access Application Audience tag here)
# CF_TEAM= (your Cloudflare team name, e.g. andrewbakercloudscale)
EOF
    ok ".env created at $ENV_FILE — edit to add CF_AUD + CF_TEAM"
fi

# ── 5. Pi-hole permissions ─────────────────────────────────────────────────
info "Adding pi to pihole group for DB read access..."
sudo usermod -aG pihole pi || true

# ── 6. Set Pi-hole DNS TTL cap to 5 minutes ───────────────────────────────
info "Setting Pi-hole DNS TTL cap to 300 seconds (5 minutes)..."
sudo pihole-FTL --config dns.cache.maxTTL 300
sudo systemctl restart pihole-FTL
ok "Pi-hole TTL cap set to 5 minutes"

# ── 7. Install + start systemd service ────────────────────────────────────
info "Installing systemd service..."
sudo cp "$INSTALL_DIR/deploy/pi-monitor-api.service" "/etc/systemd/system/${SERVICE}.service"
sudo systemctl daemon-reload
sudo systemctl enable "$SERVICE"
sudo systemctl restart "$SERVICE"

sleep 2
if systemctl is-active --quiet "$SERVICE"; then
    ok "Service running"
else
    die "Service failed to start. Check: journalctl -u $SERVICE -n 30"
fi

# ── 8. Quick health check ─────────────────────────────────────────────────
sleep 1
RESP=$(curl -sf http://127.0.0.1:8080/api/ping || echo "FAIL")
if echo "$RESP" | grep -q '"ok"'; then
    ok "API responding: $RESP"
else
    die "API health check failed. Check: journalctl -u $SERVICE -n 30"
fi

echo ""
echo -e "${BOLD}Install complete!${NC}"
echo ""
echo "  API: http://127.0.0.1:8080/api/ping"
echo "  Logs: journalctl -u $SERVICE -f"
echo ""
echo "  Next: set up cloudflared tunnel → api.pi.andrewbaker.ninja"
echo "  See: deploy/cloudflared.yml"
echo ""
