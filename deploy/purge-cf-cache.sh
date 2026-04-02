#!/usr/bin/env bash
# purge-cf-cache.sh — Purge Cloudflare cache for andrewbaker.ninja
# Credentials are stored in deploy/cf_token (gitignored)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CF_TOKEN_FILE="$SCRIPT_DIR/cf_token"
CF_ZONE="YOUR-CF-ZONE-ID"

[ -f "$CF_TOKEN_FILE" ] || { echo "✗  deploy/cf_token not found"; exit 1; }
source "$CF_TOKEN_FILE"

RESULT=$(curl -s -X POST "https://api.cloudflare.com/client/v4/zones/$CF_ZONE/purge_cache" \
    -H "X-Auth-Email: $CF_EMAIL" -H "X-Auth-Key: $CF_KEY" -H "Content-Type: application/json" \
    --data '{"purge_everything":true}')

if echo "$RESULT" | grep -q '"success":true'; then
    echo "✓  Cloudflare cache purged for andrewbaker.ninja"
else
    echo "✗  Purge failed: $RESULT"
    exit 1
fi
