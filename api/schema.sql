-- app.db schema for pi-monitor
-- Applied automatically on first startup by db.py

CREATE TABLE IF NOT EXISTS devices (
    mac         TEXT PRIMARY KEY,
    label       TEXT NOT NULL DEFAULT '',
    last_ip     TEXT NOT NULL DEFAULT '',
    first_seen  TEXT NOT NULL DEFAULT (datetime('now')),
    last_seen   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS rules (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    category    TEXT NOT NULL DEFAULT '',
    service_key TEXT NOT NULL DEFAULT '',
    rule_type   TEXT NOT NULL DEFAULT 'domain' CHECK (rule_type IN ('domain', 'ip')),
    value       TEXT NOT NULL,
    is_blocked  INTEGER NOT NULL DEFAULT 0,
    is_custom   INTEGER NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX IF NOT EXISTS rules_value_uidx ON rules (value);

CREATE TABLE IF NOT EXISTS schedules (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    scope_type      TEXT NOT NULL DEFAULT 'category' CHECK (scope_type IN ('category', 'service')),
    scope_key       TEXT NOT NULL,
    weekday_start   TEXT,  -- HH:MM
    weekday_end     TEXT,  -- HH:MM
    weekend_start   TEXT,
    weekend_end     TEXT,
    enabled         INTEGER NOT NULL DEFAULT 1,
    UNIQUE (scope_type, scope_key)
);
