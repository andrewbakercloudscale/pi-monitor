from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from db import get_app_db

router = APIRouter()


class ScheduleIn(BaseModel):
    scope_type:    str = "category"
    scope_key:     str
    weekday_start: str | None = None
    weekday_end:   str | None = None
    weekend_start: str | None = None
    weekend_end:   str | None = None
    enabled:       bool = True


@router.get("/schedules")
async def list_schedules():
    async with await get_app_db() as db:
        rows = await db.execute_fetchall("SELECT * FROM schedules ORDER BY scope_type, scope_key")
    return {"schedules": [dict(r) for r in rows]}


@router.post("/schedules")
async def upsert_schedule(body: ScheduleIn):
    if body.scope_type not in ("category", "service"):
        raise HTTPException(400, "scope_type must be 'category' or 'service'")

    async with await get_app_db() as db:
        await db.execute(
            """
            INSERT INTO schedules
                (scope_type, scope_key, weekday_start, weekday_end,
                 weekend_start, weekend_end, enabled)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(scope_type, scope_key) DO UPDATE SET
                weekday_start = excluded.weekday_start,
                weekday_end   = excluded.weekday_end,
                weekend_start = excluded.weekend_start,
                weekend_end   = excluded.weekend_end,
                enabled       = excluded.enabled
            """,
            (
                body.scope_type, body.scope_key,
                body.weekday_start, body.weekday_end,
                body.weekend_start, body.weekend_end,
                1 if body.enabled else 0,
            ),
        )
        await db.commit()
        rows = await db.execute_fetchall(
            "SELECT * FROM schedules WHERE scope_type = ? AND scope_key = ?",
            (body.scope_type, body.scope_key),
        )
    return dict(rows[0]) if rows else {"ok": True}


@router.delete("/schedules/{schedule_id}")
async def delete_schedule(schedule_id: int):
    async with await get_app_db() as db:
        rows = await db.execute_fetchall(
            "SELECT id FROM schedules WHERE id = ?", (schedule_id,)
        )
        if not rows:
            raise HTTPException(404, "Schedule not found")
        await db.execute("DELETE FROM schedules WHERE id = ?", (schedule_id,))
        await db.commit()
    return {"ok": True}
