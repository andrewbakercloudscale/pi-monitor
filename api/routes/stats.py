from datetime import date
from fastapi import APIRouter
import pihole

router = APIRouter()


@router.get("/ping")
async def ping():
    return {"ok": True}


@router.get("/stats")
async def stats(date: date | None = None):
    return await pihole.get_stats(date)
