from datetime import date
import re
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import pihole
import pihole_cmd
from db import get_app_db

router = APIRouter()


class LabelUpdate(BaseModel):
    label: str


@router.get("/devices")
async def list_devices():
    devices = await pihole.get_devices()
    # Merge stored labels from app.db
    async with get_app_db() as db:
        rows = await db.execute_fetchall("SELECT mac, label FROM devices")
        labels = {r["mac"]: r["label"] for r in rows}

    for d in devices:
        mac = d.get("mac", "").lower()
        stored = labels.get(mac, "")
        d["label"] = stored or d.get("label", mac)

    return {"devices": devices}


@router.patch("/devices/{mac}")
async def update_device(mac: str, body: LabelUpdate):
    mac = mac.lower()
    async with get_app_db() as db:
        await db.execute(
            """
            INSERT INTO devices (mac, label) VALUES (?, ?)
            ON CONFLICT(mac) DO UPDATE SET label = excluded.label, last_seen = datetime('now')
            """,
            (mac, body.label.strip()),
        )
        await db.commit()
    return {"ok": True, "mac": mac, "label": body.label.strip()}


@router.get("/devices/{mac}/traffic")
async def device_traffic(mac: str, date: date | None = None):
    queries = await pihole.get_device_traffic(mac, date)
    blocks  = await pihole.get_device_blocks(mac, date)
    return {"mac": mac, "queries": queries, "blocks": blocks}


@router.post("/devices/{mac}/probe")
async def probe_device(mac: str):
    """Run nmap OS detection against the device's last known IP."""
    devices = await pihole.get_devices()
    device  = next((d for d in devices if d.get("mac", "").lower() == mac.lower()), None)
    if not device:
        raise HTTPException(404, "Device not found")
    ip = device.get("last_ip")
    if not ip:
        raise HTTPException(400, "No IP address known for this device")

    # -O  OS detection  --osscan-guess  aggressive guessing
    # -sV  service versions  -T4  fast  -F  top-100 ports only
    rc, out = await pihole_cmd._run(
        "sudo", "nmap", "-O", "--osscan-guess", "-sV", "-T4", "-F", ip,
        timeout=60,
    )

    # Parse OS guess lines
    os_lines: list[str] = []
    for line in out.splitlines():
        l = line.strip()
        if l.startswith(("OS details:", "OS guess:", "Running:", "Aggressive OS guesses:")):
            # strip the label prefix and grab just the value
            value = re.sub(r"^[^:]+:\s*", "", l)
            os_lines.append(value)

    # Parse open ports
    open_ports: list[str] = []
    for line in out.splitlines():
        l = line.strip()
        if re.match(r"\d+/(tcp|udp)\s+open", l):
            open_ports.append(l)

    os_guess = os_lines[0].split(",")[0].strip() if os_lines else "Could not determine"

    return {
        "mac": mac,
        "ip": ip,
        "os_guess": os_guess,
        "os_matches": os_lines,
        "open_ports": open_ports,
    }
