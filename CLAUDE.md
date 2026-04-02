# pi-monitor — Claude Context

## What this project is
Self-hosted parental controls dashboard. FastAPI backend + Next.js frontend running **directly on a Raspberry Pi**. No AWS. No EC2. No WordPress. No external servers of any kind.

## Infrastructure
- **Pi IP**: `YOUR-PI-LAN-IP`
- **SSH**: `ssh -i ~/.ssh/pi_key pi@YOUR-PI-LAN-IP`
- **API**: FastAPI on `:8080`, files at `/opt/pi-monitor/api/`
- **Frontend**: nginx on `:3001`, static files at `/opt/pi-monitor/frontend/`
- **Exposed via**: Cloudflare Tunnel (`cloudflared`) → `pi.andrewbaker.ninja`
- **Auth**: Cloudflare Access (Google SSO)
- **Playwright tests**: run against `http://YOUR-PI-LAN-IP:3001`

## Deploying

### Frontend
```bash
cd frontend && npm run build
rsync -az --delete -e "ssh -i ~/.ssh/pi_key" out/ pi@YOUR-PI-LAN-IP:/opt/pi-monitor/frontend/
```

### Backend (single file)
```bash
scp -i ~/.ssh/pi_key api/<file>.py pi@YOUR-PI-LAN-IP:/opt/pi-monitor/api/<file>.py
ssh -i ~/.ssh/pi_key pi@YOUR-PI-LAN-IP "sudo systemctl restart pi-monitor-api"
```

### Git push
`github.com` may be blocked on Pi-hole. If `git push` fails:
1. `curl -s -X POST "http://YOUR-PI-LAN-IP:8080/api/rules/<id>/toggle"` to unblock
2. Push
3. Re-toggle to reblock

## What does NOT exist here
- **No AWS / EC2** — the EC2 instance in `deploy/purge-cf-cache.sh` is from the OLD WordPress setup, completely unrelated to this project. Never SSH to EC2 for anything related to pi-monitor.
- **No WordPress / MySQL / PHP**
- **No Cloudflare Pages** — frontend is served from the Pi directly
- **No CF API credentials on EC2** — if CF API access is needed, ask the user

## Cloudflare
- Tunnel UUID: `YOUR-TUNNEL-UUID`
- Zone ID: `YOUR-CF-ZONE-ID` (andrewbaker.ninja)
- `pi.andrewbaker.ninja` → Pi :3001 (frontend)
- `api-pi.andrewbaker.ninja` → Pi :8080 (API)
- Page rule: `pi.andrewbaker.ninja/*` → `cache_level = bypass` (nothing cached at CF edge)
- Full config: `deploy/cloudflared.yml`
- If CF API credentials are needed, **ask the user** — do NOT use the EC2/AWS script in deploy/
