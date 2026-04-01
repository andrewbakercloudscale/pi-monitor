"""
scheduler.py — APScheduler job that enforces block schedules every 60 seconds.

Logic mirrors the WordPress plugin's evaluate_schedules():
  - Each schedule defines an ALLOWED window (start → end)
  - Outside the window: block the rules
  - Inside the window: unblock them
  - Overnight windows supported (e.g. 22:00–07:00)
"""

import asyncio
import logging
from datetime import datetime, timezone

from apscheduler.schedulers.asyncio import AsyncIOScheduler

import pihole_cmd
from db import get_app_db

log = logging.getLogger("scheduler")


def _to_secs(t: str) -> int:
    parts = t.split(":")
    return int(parts[0]) * 3600 + int(parts[1]) * 60 if len(parts) >= 2 else 0


def _in_window(start: str, end: str, now_secs: int) -> bool:
    """True if now is inside the allowed window."""
    s, e = _to_secs(start), _to_secs(end)
    if s <= e:
        return s <= now_secs < e
    # Overnight: e.g. 22:00–07:00
    return now_secs >= s or now_secs < e


async def evaluate():
    now_utc  = datetime.now(timezone.utc)
    dow      = now_utc.weekday()          # 0=Mon … 6=Sun
    weekend  = dow >= 5
    now_secs = now_utc.hour * 3600 + now_utc.minute * 60 + now_utc.second

    async with await get_app_db() as db:
        schedules = await db.execute_fetchall("SELECT * FROM schedules WHERE enabled = 1")

        for sched in schedules:
            start = sched["weekend_start"] if weekend else sched["weekday_start"]
            end   = sched["weekend_end"]   if weekend else sched["weekday_end"]
            if not start or not end:
                continue

            allowed         = _in_window(start, end, now_secs)
            desired_blocked = 0 if allowed else 1

            # Fetch all rules for this scope
            if sched["scope_type"] == "category":
                rules = await db.execute_fetchall(
                    "SELECT * FROM rules WHERE category = ? AND is_custom = 0",
                    (sched["scope_key"],),
                )
            else:
                rules = await db.execute_fetchall(
                    "SELECT * FROM rules WHERE service_key = ?",
                    (sched["scope_key"],),
                )

            for rule in rules:
                if rule["is_blocked"] == desired_blocked:
                    continue

                try:
                    if rule["rule_type"] == "domain":
                        if desired_blocked:
                            await pihole_cmd.block_domain(rule["value"])
                        else:
                            await pihole_cmd.unblock_domain(rule["value"])
                    else:
                        if desired_blocked:
                            await pihole_cmd.block_ip(rule["value"])
                        else:
                            await pihole_cmd.unblock_ip(rule["value"])

                    await db.execute(
                        "UPDATE rules SET is_blocked = ? WHERE id = ?",
                        (desired_blocked, rule["id"]),
                    )
                    log.info(
                        "%s %s %s (schedule: %s/%s)",
                        "blocked" if desired_blocked else "unblocked",
                        rule["rule_type"],
                        rule["value"],
                        sched["scope_type"],
                        sched["scope_key"],
                    )
                except Exception as exc:
                    log.error("Schedule apply failed for rule %s: %s", rule["id"], exc)

        await db.commit()


def start_scheduler() -> AsyncIOScheduler:
    scheduler = AsyncIOScheduler()
    scheduler.add_job(evaluate, "interval", seconds=60, id="schedule_eval")
    scheduler.start()
    return scheduler
