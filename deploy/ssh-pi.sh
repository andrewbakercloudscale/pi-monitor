#!/usr/bin/env bash
# ssh-pi.sh — SSH into the Raspberry Pi
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
exec ssh -i "$SCRIPT_DIR/pi_key" pi@YOUR-PI-LAN-IP "$@"
