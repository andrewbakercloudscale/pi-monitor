"""
pihole.py — Read Pi-hole FTL SQLite database directly (Pi-hole v6)

Pi-hole v6 notes:
- `queries` is a VIEW that resolves integer FKs from query_storage
- `network` table has NO `name` column (moved to network_addresses.name)
- Blocked statuses: 1,4,5,6,7,8,9,10,11,15,16
- Allowed statuses: 2,3,12,13,14
"""

from datetime import datetime, timezone, date
from db import get_pihole_db

BLOCKED_STATUSES = (1, 4, 5, 6, 7, 8, 9, 10, 11, 15, 16)
ALLOWED_STATUSES = (2, 3, 12, 13, 14)

_BLOCKED_IN = ",".join(str(s) for s in BLOCKED_STATUSES)
_ALLOWED_IN = ",".join(str(s) for s in ALLOWED_STATUSES)

_MAC_RE = r'^([0-9a-f]{2}:){5}[0-9a-f]{2}$'

import re as _re

def _valid_mac(mac: str) -> bool:
    return bool(mac and _re.match(_MAC_RE, mac.lower().strip()))


def _day_bounds(d: date) -> tuple[int, int]:
    """Return (start_unix, end_unix) for a calendar day in UTC."""
    start = datetime(d.year, d.month, d.day, tzinfo=timezone.utc)
    end   = datetime(d.year, d.month, d.day, 23, 59, 59, tzinfo=timezone.utc)
    return int(start.timestamp()), int(end.timestamp())


async def get_stats(for_date: date | None = None) -> dict:
    d = for_date or date.today()
    start, end = _day_bounds(d)
    async with await get_pihole_db() as db:
        row = await db.execute_fetchall(
            f"""
            SELECT
                COUNT(*) FILTER (WHERE status IN ({_ALLOWED_IN})) AS queries,
                COUNT(*) FILTER (WHERE status IN ({_BLOCKED_IN})) AS blocks,
                COUNT(DISTINCT client) AS devices
            FROM queries
            WHERE timestamp BETWEEN ? AND ?
            """,
            (start, end),
        )
        r = dict(row[0]) if row else {}
        return {
            "queries": r.get("queries", 0),
            "blocks":  r.get("blocks",  0),
            "devices": r.get("devices", 0),
            "date":    d.isoformat(),
        }


async def get_devices() -> list[dict]:
    """Return all devices Pi-hole has seen, with today's query/block counts."""
    start, end = _day_bounds(date.today())
    async with await get_pihole_db() as db:
        rows = await db.execute_fetchall(
            f"""
            SELECT
                n.hwaddr                                    AS mac,
                COALESCE(na.name, na.ip, n.hwaddr)         AS label,
                na.ip                                       AS last_ip,
                COUNT(*) FILTER (WHERE q.status IN ({_ALLOWED_IN})
                                   AND q.timestamp BETWEEN ? AND ?) AS queries_today,
                COUNT(*) FILTER (WHERE q.status IN ({_BLOCKED_IN})
                                   AND q.timestamp BETWEEN ? AND ?) AS blocks_today
            FROM network n
            JOIN network_addresses na ON na.network_id = n.id
            LEFT JOIN queries q ON q.client = na.ip
            GROUP BY n.hwaddr, na.ip
            ORDER BY queries_today DESC
            """,
            (start, end, start, end),
        )
        out = []
        for r in rows:
            mac = (r["mac"] or "").lower().strip()
            if not _valid_mac(mac):
                continue
            out.append(dict(r))
        return out


async def get_device_traffic(mac: str, for_date: date | None = None) -> list[dict]:
    """Top queried domains for a single device on a given day."""
    d = for_date or date.today()
    start, end = _day_bounds(d)
    async with await get_pihole_db() as db:
        rows = await db.execute_fetchall(
            f"""
            SELECT q.domain, COUNT(*) AS count
            FROM queries q
            JOIN network_addresses na ON na.ip = q.client
            JOIN network n ON n.id = na.network_id
            WHERE LOWER(n.hwaddr) = LOWER(?)
              AND q.status IN ({_ALLOWED_IN})
              AND q.timestamp BETWEEN ? AND ?
            GROUP BY q.domain
            ORDER BY count DESC
            LIMIT 100
            """,
            (mac, start, end),
        )
        return [dict(r) for r in rows]


async def get_device_blocks(mac: str, for_date: date | None = None) -> list[dict]:
    """Blocked domains for a single device on a given day."""
    d = for_date or date.today()
    start, end = _day_bounds(d)
    async with await get_pihole_db() as db:
        rows = await db.execute_fetchall(
            f"""
            SELECT
                q.domain,
                COUNT(*) AS count,
                MAX(q.timestamp) AS last_ts
            FROM queries q
            JOIN network_addresses na ON na.ip = q.client
            JOIN network n ON n.id = na.network_id
            WHERE LOWER(n.hwaddr) = LOWER(?)
              AND q.status IN ({_BLOCKED_IN})
              AND q.timestamp BETWEEN ? AND ?
            GROUP BY q.domain
            ORDER BY count DESC
            LIMIT 100
            """,
            (mac, start, end),
        )
        return [
            {
                "domain":  r["domain"],
                "count":   r["count"],
                "last_at": datetime.fromtimestamp(r["last_ts"], tz=timezone.utc)
                                   .strftime("%Y-%m-%dT%H:%M:%SZ"),
            }
            for r in rows
        ]


async def get_top_domains(for_date: date | None = None, limit: int = 50) -> list[dict]:
    """Global top queried domains for a day."""
    d = for_date or date.today()
    start, end = _day_bounds(d)
    async with await get_pihole_db() as db:
        rows = await db.execute_fetchall(
            f"""
            SELECT domain, COUNT(*) AS count
            FROM queries
            WHERE status IN ({_ALLOWED_IN})
              AND timestamp BETWEEN ? AND ?
            GROUP BY domain
            ORDER BY count DESC
            LIMIT ?
            """,
            (start, end, limit),
        )
        return [dict(r) for r in rows]


async def get_top_blocks(for_date: date | None = None, limit: int = 50) -> list[dict]:
    """Global top blocked domains for a day."""
    d = for_date or date.today()
    start, end = _day_bounds(d)
    async with await get_pihole_db() as db:
        rows = await db.execute_fetchall(
            f"""
            SELECT
                domain,
                COUNT(*) AS count,
                MAX(timestamp) AS last_ts
            FROM queries
            WHERE status IN ({_BLOCKED_IN})
              AND timestamp BETWEEN ? AND ?
            GROUP BY domain
            ORDER BY count DESC
            LIMIT ?
            """,
            (start, end, limit),
        )
        return [
            {
                "domain":  r["domain"],
                "count":   r["count"],
                "last_at": datetime.fromtimestamp(r["last_ts"], tz=timezone.utc)
                                   .strftime("%Y-%m-%dT%H:%M:%SZ"),
            }
            for r in rows
        ]
