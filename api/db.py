"""
db.py — SQLite connection helpers

app.db    : read-write, managed by this app
pihole.db : read-only, owned by Pi-hole FTL

Usage:
    async with get_app_db() as db:
        ...
    async with get_pihole_db() as db:
        ...
"""

import aiosqlite
from contextlib import asynccontextmanager
from pathlib import Path
from config import APP_DB, PIHOLE_DB


@asynccontextmanager
async def get_app_db():
    """Async context manager for app.db (read-write)."""
    async with aiosqlite.connect(APP_DB) as db:
        db.row_factory = aiosqlite.Row
        await db.execute("PRAGMA journal_mode=WAL")
        await db.execute("PRAGMA foreign_keys=ON")
        yield db


@asynccontextmanager
async def get_pihole_db():
    """Async context manager for pihole-FTL.db (read-only)."""
    async with aiosqlite.connect(f"file:{PIHOLE_DB}?mode=ro", uri=True) as db:
        db.row_factory = aiosqlite.Row
        yield db


async def init_app_db():
    """Create tables from schema.sql if they don't exist."""
    schema = Path(__file__).parent / "schema.sql"
    sql = schema.read_text()
    async with get_app_db() as db:
        await db.executescript(sql)
        await db.commit()
