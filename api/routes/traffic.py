from datetime import date
from fastapi import APIRouter
import pihole

router = APIRouter()


@router.get("/traffic")
async def top_traffic(date: date | None = None, limit: int = 50):
    domains = await pihole.get_top_domains(date, limit)
    return {"domains": domains}


@router.get("/blocks")
async def top_blocks(date: date | None = None, limit: int = 50):
    blocks = await pihole.get_top_blocks(date, limit)
    return {"blocks": blocks}
