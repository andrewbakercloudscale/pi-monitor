"""
db.py — SQLite connection helpers

app.db    : read-write, managed by this app
pihole.db : read-only, owned by Pi-hole FTL
"""

import aiosqlite
import asyncio
from pathlib import Path
from config import APP_DB, PIHOLE_DB

_app_lock = asyncio.Lock()


async def get_app_db() -> aiosqlite.Connection:
    """Open app.db (read-write). Caller is responsible for closing."""
    db = await aiosqlite.connect(APP_DB)
    db.row_factory = aiosqlite.Row
    await db.execute("PRAGMA journal_mode=WAL")
    await db.execute("PRAGMA foreign_keys=ON")
    return db


async def get_pihole_db() -> aiosqlite.Connection:
    """Open pihole-FTL.db (read-only URI)."""
    db = await aiosqlite.connect(f"file:{PIHOLE_DB}?mode=ro", uri=True)
    db.row_factory = aiosqlite.Row
    return db


async def init_app_db():
    """Create tables from schema.sql if they don't exist."""
    schema = Path(__file__).parent / "schema.sql"
    sql = schema.read_text()
    async with await get_app_db() as db:
        await db.executescript(sql)
        await db.commit()
