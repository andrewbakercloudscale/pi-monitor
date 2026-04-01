import os
from dotenv import load_dotenv

load_dotenv()

PIHOLE_DB  = os.getenv("PIHOLE_DB",  "/etc/pihole/pihole-FTL.db")
APP_DB     = os.getenv("APP_DB",     "/opt/pi-monitor/app.db")
BIND_HOST  = os.getenv("BIND_HOST",  "127.0.0.1")
BIND_PORT  = int(os.getenv("BIND_PORT", "8080"))

# Cloudflare Access audience tag (from CF dashboard → Access → Application → Application Audience)
# Set in .env on the Pi. Leave blank to disable Access JWT verification (dev mode).
CF_AUD     = os.getenv("CF_AUD", "")
CF_TEAM    = os.getenv("CF_TEAM", "")  # e.g. "andrewbakercloudscale" (your CF team name)
