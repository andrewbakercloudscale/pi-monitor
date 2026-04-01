from datetime import date
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import pihole
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
