#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# run-tests.sh — Pi Monitor test runner
#
# How it works:
#   1. Generates a disposable SSH key pair (in /tmp, deleted on exit)
#   2. Creates a temporary Linux user (pi-test-runner) on the Pi via SSH
#   3. Opens an SSH tunnel using that user:
#        localhost:13001 → Pi nginx :3001
#        localhost:18080 → Pi FastAPI :8080
#   4. Sets system DNS to Pi so Pi-hole blocks take effect during tests
#   5. Smoke-tests pi.andrewbaker.ninja/api/ping (public Cloudflare tunnel)
#   6. Runs all Playwright tests against localhost (through the tunnel)
#   7. Kills the tunnel, deletes the test user, restores DNS — even on failure
#
# Usage:
#   ./tests/run-tests.sh              # all tests
#   ./tests/run-tests.sh 06-dns       # filter to matching specs
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PI_HOST="${PI_HOST:-YOUR-PI-LAN-IP}"
PI_ADMIN_USER="pi"
PI_ADMIN_KEY="${SSH_KEY:-$HOME/.ssh/pi_key}"
PI_SSH_OPTS="-i $PI_ADMIN_KEY -o StrictHostKeyChecking=no -o ConnectTimeout=10 -o BatchMode=yes"

TEST_USER="pi-test-runner"
TUNNEL_FRONTEND_PORT=13001
TUNNEL_API_PORT=18080
TEMP_KEY="/tmp/pi-test-runner-key-$$"
TUNNEL_PID=""
WIFI_SERVICE="Wi-Fi"

RED='\033[0;31m'; GREEN='\033[0;32m'; BLUE='\033[0;34m'; YELLOW='\033[1;33m'; BOLD='\033[1m'; NC='\033[0m'
ok()   { echo -e "${GREEN}✓${NC}  $*"; }
info() { echo -e "${BLUE}→${NC}  $*"; }
warn() { echo -e "${YELLOW}⚠${NC}  $*"; }
die()  { echo -e "${RED}✗  ERROR:${NC} $*" >&2; exit 1; }
step() { echo -e "\n${BOLD}── $* ──${NC}"; }

pi() { ssh $PI_SSH_OPTS ${PI_ADMIN_USER}@${PI_HOST} "$@"; }

# ── Cleanup on exit ───────────────────────────────────────────────────────────
ORIGINAL_DNS=$(networksetup -getdnsservers "$WIFI_SERVICE" 2>/dev/null || echo "Empty")

cleanup() {
    echo ""
    step "Cleanup"

    # Kill SSH tunnel
    if [ -n "$TUNNEL_PID" ] && kill -0 "$TUNNEL_PID" 2>/dev/null; then
        kill "$TUNNEL_PID" 2>/dev/null || true
        ok "SSH tunnel closed"
    fi

    # Delete test user on Pi (kill any lingering processes first)
    if pi "id $TEST_USER" &>/dev/null 2>&1; then
        pi "sudo pkill -u $TEST_USER 2>/dev/null || true; sleep 1; sudo userdel -r $TEST_USER 2>/dev/null || true"
        ok "Test user '$TEST_USER' deleted from Pi"
    fi

    # Delete temp SSH key
    rm -f "$TEMP_KEY" "${TEMP_KEY}.pub"
    ok "Temporary SSH key deleted"

    # Restore DNS
    if [ "$ORIGINAL_DNS" = "There aren't any DNS Servers set on Wi-Fi." ] || \
       [ "$ORIGINAL_DNS" = "Empty" ]; then
        networksetup -setdnsservers "$WIFI_SERVICE" "Empty" 2>/dev/null || true
        ok "DNS cleared (back to DHCP/router)"
    else
        networksetup -setdnsservers "$WIFI_SERVICE" $ORIGINAL_DNS 2>/dev/null || true
        ok "DNS restored to: $ORIGINAL_DNS"
    fi
    dscacheutil -flushcache 2>/dev/null || true
    sudo killall -HUP mDNSResponder 2>/dev/null || true
}
trap cleanup EXIT

# ── Step 1: Generate disposable SSH key ──────────────────────────────────────
step "Generating temporary SSH key"
ssh-keygen -t ed25519 -N "" -C "pi-test-runner-$$" -f "$TEMP_KEY" -q
ok "Key pair created at $TEMP_KEY"

# ── Step 2: Create test user on Pi ───────────────────────────────────────────
step "Creating test user on Pi"

# Clean up any leftover from a previous failed run
pi "sudo pkill -u $TEST_USER 2>/dev/null || true; sleep 1; sudo userdel -r $TEST_USER 2>/dev/null || true"

pi "sudo useradd -m -s /bin/bash $TEST_USER"
pi "sudo mkdir -p /home/${TEST_USER}/.ssh && sudo chmod 700 /home/${TEST_USER}/.ssh"
pi "echo '$(cat ${TEMP_KEY}.pub)' | sudo tee /home/${TEST_USER}/.ssh/authorized_keys > /dev/null"
pi "sudo chmod 600 /home/${TEST_USER}/.ssh/authorized_keys"
pi "sudo chown -R ${TEST_USER}:${TEST_USER} /home/${TEST_USER}/.ssh"
ok "User '$TEST_USER' created on Pi"

# ── Step 3: Open SSH tunnel as test user ─────────────────────────────────────
step "Opening SSH tunnel"
TEST_SSH_OPTS="-i $TEMP_KEY -o StrictHostKeyChecking=no -o ConnectTimeout=10 -o BatchMode=yes"

# Kill anything already using our tunnel ports
lsof -ti :${TUNNEL_FRONTEND_PORT} | xargs kill -9 2>/dev/null || true
lsof -ti :${TUNNEL_API_PORT}      | xargs kill -9 2>/dev/null || true

ssh $TEST_SSH_OPTS \
    -N \
    -L ${TUNNEL_FRONTEND_PORT}:localhost:3001 \
    -L ${TUNNEL_API_PORT}:localhost:8080 \
    ${TEST_USER}@${PI_HOST} &
TUNNEL_PID=$!

# Wait for tunnel ports to be ready
for i in $(seq 1 15); do
    if curl -sf --max-time 2 "http://localhost:${TUNNEL_API_PORT}/api/ping" | grep -q '"ok"' 2>/dev/null; then
        break
    fi
    if [ $i -eq 15 ]; then
        die "SSH tunnel did not become ready after 15 seconds"
    fi
    sleep 1
done
ok "Tunnel ready: localhost:${TUNNEL_FRONTEND_PORT} → Pi:3001,  localhost:${TUNNEL_API_PORT} → Pi:8080"

# ── Step 4: Set DNS to Pi ─────────────────────────────────────────────────────
step "Switching DNS to Pi ($PI_HOST)"
info "Current DNS: $ORIGINAL_DNS"
networksetup -setdnsservers "$WIFI_SERVICE" "$PI_HOST"
dscacheutil -flushcache 2>/dev/null || true
sudo killall -HUP mDNSResponder 2>/dev/null || true
ok "DNS is now $PI_HOST (queries flow through Pi-hole)"

# ── Step 5: Smoke-test public domain ─────────────────────────────────────────
step "Public domain smoke test (pi.andrewbaker.ninja)"
PUBLIC_PING=$(curl -sf --max-time 10 "https://pi.andrewbaker.ninja/api/ping" || echo "FAIL")
if echo "$PUBLIC_PING" | grep -q '"ok"'; then
    ok "Public URL responding: $PUBLIC_PING"
else
    warn "Public URL unreachable ($PUBLIC_PING) — Cloudflare tunnel may be down"
    warn "Playwright tests will still run via direct SSH tunnel"
fi

# ── Step 6: Verify deployed version ──────────────────────────────────────────
step "Checking deployed version"
BUILD_INFO=$(curl -sf --max-time 5 "http://localhost:${TUNNEL_FRONTEND_PORT}/build-info.json" || echo "{}")
DEPLOYED_VER=$(echo "$BUILD_INFO" | grep -o '"version": *"[^"]*"' | grep -o '[0-9][^"]*' || echo "unknown")
info "Deployed version: v${DEPLOYED_VER}"

# ── Step 7: Run Playwright tests ─────────────────────────────────────────────
step "Running Playwright tests (v${DEPLOYED_VER})"
info "Frontend: http://localhost:${TUNNEL_FRONTEND_PORT}  (SSH tunnel → Pi nginx :3001)"
info "API:      http://localhost:${TUNNEL_API_PORT}       (SSH tunnel → Pi FastAPI :8080)"
info "DNS:      ${PI_HOST}                               (Pi-hole active)"

TEST_FILTER="${1:-}"
cd "$SCRIPT_DIR"

EXIT_CODE=0
if [ -n "$TEST_FILTER" ]; then
    info "Filter: $TEST_FILTER"
    BASE_URL="http://localhost:${TUNNEL_FRONTEND_PORT}" \
    API_URL="http://localhost:${TUNNEL_API_PORT}" \
    PI_HOST="${PI_HOST}" \
    npx playwright test --grep "$TEST_FILTER" || EXIT_CODE=$?
else
    BASE_URL="http://localhost:${TUNNEL_FRONTEND_PORT}" \
    API_URL="http://localhost:${TUNNEL_API_PORT}" \
    PI_HOST="${PI_HOST}" \
    npx playwright test || EXIT_CODE=$?
fi

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
if [ $EXIT_CODE -eq 0 ]; then
    echo -e "${BOLD}${GREEN}All tests passed!${NC}  (v${DEPLOYED_VER})"
else
    echo -e "${BOLD}${RED}Tests failed (exit $EXIT_CODE)${NC}"
    echo "  View report:  npx playwright show-report tests/report"
fi
echo ""

# cleanup() runs via trap
exit $EXIT_CODE
