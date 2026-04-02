from datetime import date
from fastapi import APIRouter
import pihole

router = APIRouter()


VERSION = "0.3.0"

@router.get("/ping")
async def ping():
    return {"ok": True, "version": VERSION}


@router.get("/stats")
async def stats(date: date | None = None):
    return await pihole.get_stats(date)
