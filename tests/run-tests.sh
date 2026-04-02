#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# run-tests.sh — Pi Monitor test runner
#
# What this does:
#   1. Points this Mac's DNS at the Pi (YOUR-PI-LAN-IP) so DNS queries made
#      during tests actually flow through Pi-hole — no custom Resolver hack needed
#   2. Runs all Playwright tests against the Pi directly (http://YOUR-PI-LAN-IP:3001)
#      to bypass Cloudflare Access, which requires a Google login for the UI
#   3. Smoke-tests the public domain (pi.andrewbaker.ninja/api/ping) to confirm
#      the Cloudflare Tunnel is alive
#   4. Restores DNS to whatever it was before, even if tests fail
#
# Usage:
#   ./tests/run-tests.sh              # all tests
#   ./tests/run-tests.sh 06-dns       # filter to a specific spec
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PI_HOST="${PI_HOST:-YOUR-PI-LAN-IP}"
WIFI_SERVICE="Wi-Fi"

RED='\033[0;31m'; GREEN='\033[0;32m'; BLUE='\033[0;34m'; YELLOW='\033[1;33m'; BOLD='\033[1m'; NC='\033[0m'
ok()   { echo -e "${GREEN}✓${NC}  $*"; }
info() { echo -e "${BLUE}→${NC}  $*"; }
warn() { echo -e "${YELLOW}⚠${NC}  $*"; }
die()  { echo -e "${RED}✗  ERROR:${NC} $*" >&2; exit 1; }
step() { echo -e "\n${BOLD}── $* ──${NC}"; }

# ── Save current DNS and restore on exit ──────────────────────────────────
ORIGINAL_DNS=$(networksetup -getdnsservers "$WIFI_SERVICE" 2>/dev/null || echo "Empty")

restore_dns() {
    step "Restoring DNS"
    if [ "$ORIGINAL_DNS" = "There aren't any DNS Servers set on Wi-Fi." ] || \
       [ "$ORIGINAL_DNS" = "Empty" ]; then
        networksetup -setdnsservers "$WIFI_SERVICE" "Empty"
        ok "DNS cleared (back to DHCP/router)"
    else
        networksetup -setdnsservers "$WIFI_SERVICE" $ORIGINAL_DNS
        ok "DNS restored to: $ORIGINAL_DNS"
    fi
    # Flush DNS cache
    dscacheutil -flushcache 2>/dev/null || true
    sudo killall -HUP mDNSResponder 2>/dev/null || true
}
trap restore_dns EXIT

# ── Step 1: Set DNS to Pi ─────────────────────────────────────────────────
step "Switching DNS to Pi ($PI_HOST)"
info "Current DNS: $ORIGINAL_DNS"
networksetup -setdnsservers "$WIFI_SERVICE" "$PI_HOST"
dscacheutil -flushcache 2>/dev/null || true
sudo killall -HUP mDNSResponder 2>/dev/null || true
ok "DNS is now $PI_HOST (all queries flow through Pi-hole)"

# ── Step 2: Confirm Pi API is reachable ──────────────────────────────────
step "Pi connectivity check"
PING=$(curl -sf --max-time 5 "http://${PI_HOST}:8080/api/ping" || echo "FAIL")
if echo "$PING" | grep -q '"ok"'; then
    ok "Pi API: $PING"
else
    die "Pi API unreachable at http://${PI_HOST}:8080. Is the Pi on?"
fi

FRONTEND=$(curl -sf --max-time 5 -o /dev/null -w "%{http_code}" "http://${PI_HOST}:3001/" || echo "000")
if [ "$FRONTEND" = "200" ]; then
    ok "Pi frontend: HTTP $FRONTEND"
else
    warn "Pi frontend returned HTTP $FRONTEND — tests may fail"
fi

# ── Step 3: Smoke-test public domain ─────────────────────────────────────
step "Public domain smoke test (pi.andrewbaker.ninja)"
# /api/* has a CF Access bypass — usable without Google login
PUBLIC_PING=$(curl -sf --max-time 10 "https://pi.andrewbaker.ninja/api/ping" || echo "FAIL")
if echo "$PUBLIC_PING" | grep -q '"ok"'; then
    ok "Public URL: https://pi.andrewbaker.ninja/api/ping → $PUBLIC_PING"
else
    warn "Public URL check failed ($PUBLIC_PING) — Cloudflare tunnel may be down"
    warn "Tests will still run against the direct Pi IP"
fi

# ── Step 4: Run Playwright tests ─────────────────────────────────────────
step "Running Playwright tests"
info "Base URL:  http://${PI_HOST}:3001  (direct Pi — bypasses CF Access login)"
info "DNS:       ${PI_HOST}             (Pi-hole — DNS blocks are live)"
info "API URL:   http://${PI_HOST}:8080"

TEST_FILTER="${1:-}"
cd "$SCRIPT_DIR"

EXIT_CODE=0
if [ -n "$TEST_FILTER" ]; then
    info "Filter: $TEST_FILTER"
    BASE_URL="http://${PI_HOST}:3001" \
    API_URL="http://${PI_HOST}:8080" \
    PI_HOST="$PI_HOST" \
    npx playwright test --grep "$TEST_FILTER" || EXIT_CODE=$?
else
    BASE_URL="http://${PI_HOST}:3001" \
    API_URL="http://${PI_HOST}:8080" \
    PI_HOST="$PI_HOST" \
    npx playwright test || EXIT_CODE=$?
fi

# ── Step 5: Show report path ──────────────────────────────────────────────
echo ""
if [ $EXIT_CODE -eq 0 ]; then
    echo -e "${BOLD}${GREEN}All tests passed!${NC}"
else
    echo -e "${BOLD}${RED}Tests failed (exit $EXIT_CODE)${NC}"
    echo ""
    echo "  View report:  npx playwright show-report tests/report"
fi
echo ""

# DNS is restored by the trap above
exit $EXIT_CODE
