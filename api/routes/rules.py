import asyncio
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import pihole_cmd
from db import get_app_db

router = APIRouter()

# Built-in category/service metadata for the frontend
CATEGORIES = {
    "gaming": {
        "label": "Games",
        "services": {
            "gaming_steam":     "Steam",
            "gaming_roblox":    "Roblox",
            "gaming_epic":      "Epic Games / Fortnite",
            "gaming_minecraft": "Minecraft",
            "gaming_xbox":      "Xbox Live",
            "gaming_psn":       "PlayStation Network",
            "gaming_cod":       "Call of Duty",
            "gaming_ea":        "EA / Origin",
            "gaming_tarkov":    "Escape from Tarkov",
        },
    },
    "social": {
        "label": "Social Networking",
        "services": {
            "social_youtube":   "YouTube",
            "social_tiktok":    "TikTok",
            "social_instagram": "Instagram",
            "social_snapchat":  "Snapchat",
            "social_discord":   "Discord",
            "social_twitter":   "X / Twitter",
            "social_facebook":  "Facebook",
        },
    },
    "streaming": {
        "label": "Entertainment",
        "services": {
            "streaming_netflix": "Netflix",
            "streaming_disney":  "Disney+",
            "streaming_twitch":  "Twitch",
            "streaming_spotify": "Spotify",
            "streaming_hulu":    "Hulu",
        },
    },
    "communication": {
        "label": "Communication",
        "services": {
            "comm_whatsapp":  "WhatsApp",
            "comm_telegram":  "Telegram",
            "comm_signal":    "Signal",
            "comm_messenger": "Messenger",
            "comm_wechat":    "WeChat",
        },
    },
    "shopping": {
        "label": "Shopping & Food",
        "services": {
            "shop_amazon":     "Amazon",
            "shop_ebay":       "eBay",
            "shop_aliexpress": "AliExpress",
            "shop_shein":      "Shein",
            "shop_etsy":       "Etsy",
        },
    },
    "vpn_bypass": {
        "label": "VPN & Proxy Bypass",
        "services": {
            "vpn_nordvpn":     "NordVPN",
            "vpn_expressvpn":  "ExpressVPN",
            "vpn_surfshark":   "Surfshark",
            "vpn_mullvad":     "Mullvad",
            "vpn_protonvpn":   "ProtonVPN",
            "vpn_windscribe":  "Windscribe",
            "vpn_cyberghost":  "CyberGhost",
            "vpn_pia":         "Private Internet Access",
            "vpn_tunnelbear":  "TunnelBear",
            "vpn_ipvanish":    "IPVanish",
        },
    },
}


@router.get("/rules")
async def list_rules(category: str | None = None):
    async with get_app_db() as db:
        if category:
            rows = await db.execute_fetchall(
                "SELECT * FROM rules WHERE category = ? ORDER BY service_key, value",
                (category,),
            )
        else:
            rows = await db.execute_fetchall(
                "SELECT * FROM rules ORDER BY category, service_key, value"
            )
    return {"rules": [dict(r) for r in rows], "categories": CATEGORIES}


@router.post("/rules/{rule_id}/toggle")
async def toggle_rule(rule_id: int):
    async with get_app_db() as db:
        rows = await db.execute_fetchall("SELECT * FROM rules WHERE id = ?", (rule_id,))
        if not rows:
            raise HTTPException(404, "Rule not found")
        rule = rows[0]
        new_blocked = 0 if rule["is_blocked"] else 1

        try:
            if rule["rule_type"] == "domain":
                if new_blocked:
                    await pihole_cmd.block_domain(rule["value"])
                else:
                    await pihole_cmd.unblock_domain(rule["value"])
            else:
                if new_blocked:
                    await pihole_cmd.block_ip(rule["value"])
                else:
                    await pihole_cmd.unblock_ip(rule["value"])
        except RuntimeError as exc:
            raise HTTPException(500, str(exc))

        await db.execute(
            "UPDATE rules SET is_blocked = ? WHERE id = ?", (new_blocked, rule_id)
        )
        await db.commit()

    return {"id": rule_id, "is_blocked": new_blocked}


@router.post("/categories/{slug}/toggle")
async def toggle_category(slug: str):
    if slug not in CATEGORIES:
        raise HTTPException(404, "Category not found")

    async with get_app_db() as db:
        rows = await db.execute_fetchall(
            "SELECT * FROM rules WHERE category = ? AND is_custom = 0", (slug,)
        )
        if not rows:
            raise HTTPException(404, "No rules in category")

        # If any rule is unblocked → block all; otherwise unblock all
        any_unblocked = any(not r["is_blocked"] for r in rows)
        new_blocked   = 1 if any_unblocked else 0

        to_change = [r for r in rows if r["is_blocked"] != new_blocked]
        domains   = [r["value"] for r in to_change if r["rule_type"] == "domain"]
        errors: list[str] = []

        try:
            if domains:
                if new_blocked:
                    await pihole_cmd.block_domains_batch(domains)
                else:
                    await pihole_cmd.unblock_domains_batch(domains)
        except RuntimeError as exc:
            errors.append(str(exc))

        await db.execute(
            "UPDATE rules SET is_blocked = ? WHERE category = ? AND is_custom = 0",
            (new_blocked, slug),
        )
        await db.commit()

    return {"category": slug, "is_blocked": new_blocked, "errors": errors}


class CustomRuleIn(BaseModel):
    name:        str
    value:       str
    rule_type:   str       = "domain"
    category:    str       = "custom"   # can be any built-in slug, e.g. "social", "gaming"
    service_key: str | None = None      # optional; if set, domain is grouped under this service
    is_blocked:  bool      = False      # False = watchlist only; True = block immediately


@router.post("/rules/custom")
async def add_custom_rule(body: CustomRuleIn):
    if body.rule_type not in ("domain", "ip"):
        raise HTTPException(400, "rule_type must be 'domain' or 'ip'")

    # Only call pihole if we're actually blocking right now
    if body.is_blocked:
        try:
            if body.rule_type == "domain":
                await pihole_cmd.block_domain(body.value)
            else:
                await pihole_cmd.block_ip(body.value)
        except RuntimeError as exc:
            raise HTTPException(500, str(exc))

    cat = body.category if body.category else "custom"
    # Caller can pin to a specific service (e.g. gaming_steam); otherwise derive from category
    svc = body.service_key if body.service_key else (f"{cat}_custom" if cat != "custom" else "custom")
    blocked = 1 if body.is_blocked else 0

    async with get_app_db() as db:
        await db.execute(
            """
            INSERT INTO rules (name, category, service_key, rule_type, value, is_blocked, is_custom)
            VALUES (?, ?, ?, ?, ?, ?, 1)
            """,
            (body.name, cat, svc, body.rule_type, body.value, blocked),
        )
        await db.commit()
        row = await db.execute_fetchall(
            "SELECT * FROM rules WHERE value = ? AND is_custom = 1", (body.value,)
        )

    return dict(row[0]) if row else {"ok": True}


class BlockForIn(BaseModel):
    minutes: int


@router.post("/rules/{rule_id}/block-for")
async def block_rule_for(rule_id: int, body: BlockForIn):
    """Block a rule for N minutes, then auto-unblock via scheduler."""
    if body.minutes < 1 or body.minutes > 1440:
        raise HTTPException(400, "minutes must be 1–1440")

    unblock_at = (
        datetime.now(timezone.utc) + timedelta(minutes=body.minutes)
    ).strftime("%Y-%m-%dT%H:%M:%SZ")

    async with get_app_db() as db:
        rows = await db.execute_fetchall("SELECT * FROM rules WHERE id = ?", (rule_id,))
        if not rows:
            raise HTTPException(404, "Rule not found")
        rule = rows[0]

        if not rule["is_blocked"]:
            try:
                if rule["rule_type"] == "domain":
                    await pihole_cmd.block_domain(rule["value"])
                else:
                    await pihole_cmd.block_ip(rule["value"])
            except RuntimeError as exc:
                raise HTTPException(500, str(exc))

        await db.execute(
            "UPDATE rules SET is_blocked = 1, unblock_at = ?, reblock_at = NULL WHERE id = ?",
            (unblock_at, rule_id),
        )
        await db.commit()

    return {"id": rule_id, "is_blocked": 1, "unblock_at": unblock_at}


@router.post("/rules/{rule_id}/allow-for")
async def allow_rule_for(rule_id: int, body: BlockForIn):
    """Allow a blocked rule for N minutes, then auto-reblock via scheduler."""
    if body.minutes < 1 or body.minutes > 1440:
        raise HTTPException(400, "minutes must be 1–1440")

    reblock_at = (
        datetime.now(timezone.utc) + timedelta(minutes=body.minutes)
    ).strftime("%Y-%m-%dT%H:%M:%SZ")

    async with get_app_db() as db:
        rows = await db.execute_fetchall("SELECT * FROM rules WHERE id = ?", (rule_id,))
        if not rows:
            raise HTTPException(404, "Rule not found")
        rule = rows[0]

        if rule["is_blocked"]:
            try:
                if rule["rule_type"] == "domain":
                    await pihole_cmd.unblock_domain(rule["value"])
                else:
                    await pihole_cmd.unblock_ip(rule["value"])
            except RuntimeError as exc:
                raise HTTPException(500, str(exc))

        await db.execute(
            "UPDATE rules SET is_blocked = 0, reblock_at = ?, unblock_at = NULL WHERE id = ?",
            (reblock_at, rule_id),
        )
        await db.commit()

    return {"id": rule_id, "is_blocked": 0, "reblock_at": reblock_at}


@router.post("/categories/{slug}/block-for")
async def block_category_for(slug: str, body: BlockForIn):
    """Block all rules in a category for N minutes, then auto-unblock."""
    if slug not in CATEGORIES:
        raise HTTPException(404, "Category not found")
    if body.minutes < 1 or body.minutes > 1440:
        raise HTTPException(400, "minutes must be 1–1440")

    unblock_at = (
        datetime.now(timezone.utc) + timedelta(minutes=body.minutes)
    ).strftime("%Y-%m-%dT%H:%M:%SZ")

    async with get_app_db() as db:
        rows = await db.execute_fetchall(
            "SELECT * FROM rules WHERE category = ? AND is_custom = 0", (slug,)
        )
        to_block = [r for r in rows if not r["is_blocked"]]
        domains  = [r["value"] for r in to_block if r["rule_type"] == "domain"]
        ips      = [r["value"] for r in to_block if r["rule_type"] == "ip"]

        try:
            if domains:
                await pihole_cmd.block_domains_batch(domains)
            for ip in ips:
                await pihole_cmd.block_ip(ip)
        except RuntimeError as exc:
            raise HTTPException(500, str(exc))

        await db.execute(
            "UPDATE rules SET is_blocked = 1, unblock_at = ?, reblock_at = NULL "
            "WHERE category = ? AND is_custom = 0",
            (unblock_at, slug),
        )
        await db.commit()

    return {"category": slug, "is_blocked": 1, "unblock_at": unblock_at}


@router.post("/categories/{slug}/allow-for")
async def allow_category_for(slug: str, body: BlockForIn):
    """Temporarily allow all rules in a category for N minutes, then auto-reblock."""
    if slug not in CATEGORIES:
        raise HTTPException(404, "Category not found")
    if body.minutes < 1 or body.minutes > 1440:
        raise HTTPException(400, "minutes must be 1–1440")

    reblock_at = (
        datetime.now(timezone.utc) + timedelta(minutes=body.minutes)
    ).strftime("%Y-%m-%dT%H:%M:%SZ")

    async with get_app_db() as db:
        rows = await db.execute_fetchall(
            "SELECT * FROM rules WHERE category = ? AND is_custom = 0", (slug,)
        )
        to_unblock = [r for r in rows if r["is_blocked"]]
        domains    = [r["value"] for r in to_unblock if r["rule_type"] == "domain"]
        ips        = [r["value"] for r in to_unblock if r["rule_type"] == "ip"]

        try:
            if domains:
                await pihole_cmd.unblock_domains_batch(domains)
            for ip in ips:
                await pihole_cmd.unblock_ip(ip)
        except RuntimeError as exc:
            raise HTTPException(500, str(exc))

        await db.execute(
            "UPDATE rules SET is_blocked = 0, reblock_at = ?, unblock_at = NULL "
            "WHERE category = ? AND is_custom = 0",
            (reblock_at, slug),
        )
        await db.commit()

    return {"category": slug, "is_blocked": 0, "reblock_at": reblock_at}


@router.post("/services/{service_key}/block-for")
async def block_service_for(service_key: str, body: BlockForIn):
    """Block all rules for a service for N minutes, then auto-unblock."""
    if body.minutes < 1 or body.minutes > 1440:
        raise HTTPException(400, "minutes must be 1–1440")

    unblock_at = (
        datetime.now(timezone.utc) + timedelta(minutes=body.minutes)
    ).strftime("%Y-%m-%dT%H:%M:%SZ")

    async with get_app_db() as db:
        rows = await db.execute_fetchall(
            "SELECT * FROM rules WHERE service_key = ?", (service_key,)
        )
        if not rows:
            raise HTTPException(404, "Service not found")

        to_block = [r for r in rows if not r["is_blocked"]]
        domains  = [r["value"] for r in to_block if r["rule_type"] == "domain"]
        ips      = [r["value"] for r in to_block if r["rule_type"] == "ip"]

        try:
            if domains:
                await pihole_cmd.block_domains_batch(domains)
            for ip in ips:
                await pihole_cmd.block_ip(ip)
        except RuntimeError as exc:
            raise HTTPException(500, str(exc))

        await db.execute(
            "UPDATE rules SET is_blocked = 1, unblock_at = ?, reblock_at = NULL WHERE service_key = ?",
            (unblock_at, service_key),
        )
        await db.commit()

    return {"service_key": service_key, "is_blocked": 1, "unblock_at": unblock_at}


@router.post("/services/{service_key}/allow-for")
async def allow_service_for(service_key: str, body: BlockForIn):
    """Temporarily allow all rules for a service for N minutes, then auto-reblock."""
    if body.minutes < 1 or body.minutes > 1440:
        raise HTTPException(400, "minutes must be 1–1440")

    reblock_at = (
        datetime.now(timezone.utc) + timedelta(minutes=body.minutes)
    ).strftime("%Y-%m-%dT%H:%M:%SZ")

    async with get_app_db() as db:
        rows = await db.execute_fetchall(
            "SELECT * FROM rules WHERE service_key = ?", (service_key,)
        )
        if not rows:
            raise HTTPException(404, "Service not found")

        to_unblock = [r for r in rows if r["is_blocked"]]
        domains    = [r["value"] for r in to_unblock if r["rule_type"] == "domain"]
        ips        = [r["value"] for r in to_unblock if r["rule_type"] == "ip"]

        try:
            if domains:
                await pihole_cmd.unblock_domains_batch(domains)
            for ip in ips:
                await pihole_cmd.unblock_ip(ip)
        except RuntimeError as exc:
            raise HTTPException(500, str(exc))

        await db.execute(
            "UPDATE rules SET is_blocked = 0, reblock_at = ?, unblock_at = NULL WHERE service_key = ?",
            (reblock_at, service_key),
        )
        await db.commit()

    return {"service_key": service_key, "is_blocked": 0, "reblock_at": reblock_at}


@router.delete("/rules/{rule_id}")
async def delete_rule(rule_id: int):
    async with get_app_db() as db:
        rows = await db.execute_fetchall(
            "SELECT * FROM rules WHERE id = ? AND is_custom = 1", (rule_id,)
        )
        if not rows:
            raise HTTPException(404, "Custom rule not found")
        rule = rows[0]

        try:
            if rule["rule_type"] == "domain":
                await pihole_cmd.unblock_domain(rule["value"])
            else:
                await pihole_cmd.unblock_ip(rule["value"])
        except RuntimeError:
            pass  # Best-effort unblock

        await db.execute("DELETE FROM rules WHERE id = ?", (rule_id,))
        await db.commit()

    return {"ok": True}


class DomainActionIn(BaseModel):
    domain: str


@router.post("/domains/allow")
async def allow_domain_endpoint(body: DomainActionIn):
    """Remove from our rules + add to Pi-hole allowlist so it passes even if in blocklists."""
    import pihole_cmd as _cmd
    # Remove any custom rule for this domain
    async with get_app_db() as db:
        rows = await db.execute_fetchall(
            "SELECT id FROM rules WHERE value = ?", (body.domain,)
        )
        if rows:
            rule = rows[0]
            try:
                await _cmd.unblock_domain(body.domain)
            except RuntimeError:
                pass
            await db.execute("UPDATE rules SET is_blocked = 0 WHERE id = ?", (rule["id"],))
            await db.commit()
    # Also allowlist via pihole allow so it bypasses any blocklist entry
    try:
        await _cmd.allow_domain(body.domain)
    except RuntimeError:
        pass
    return {"ok": True, "domain": body.domain}
