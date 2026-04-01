from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import pihole_cmd
from db import get_app_db

router = APIRouter()

# Built-in category/service metadata for the frontend
CATEGORIES = {
    "gaming": {
        "label": "Gaming",
        "services": {
            "gaming_steam":     "Steam",
            "gaming_roblox":    "Roblox",
            "gaming_epic":      "Epic Games / Fortnite",
            "gaming_minecraft": "Minecraft",
            "gaming_xbox":      "Xbox Live",
            "gaming_psn":       "PlayStation Network",
            "gaming_cod":       "Call of Duty",
            "gaming_ea":        "EA / Origin",
        },
    },
    "social": {
        "label": "Social Media",
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
        "label": "Streaming",
        "services": {
            "streaming_netflix": "Netflix",
            "streaming_disney":  "Disney+",
            "streaming_twitch":  "Twitch",
            "streaming_spotify": "Spotify",
            "streaming_hulu":    "Hulu",
        },
    },
}


@router.get("/rules")
async def list_rules(category: str | None = None):
    async with await get_app_db() as db:
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
    async with await get_app_db() as db:
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

    async with await get_app_db() as db:
        rows = await db.execute_fetchall(
            "SELECT * FROM rules WHERE category = ? AND is_custom = 0", (slug,)
        )
        if not rows:
            raise HTTPException(404, "No rules in category")

        # If any rule is unblocked → block all; otherwise unblock all
        any_unblocked = any(not r["is_blocked"] for r in rows)
        new_blocked   = 1 if any_unblocked else 0

        errors = []
        for rule in rows:
            if rule["is_blocked"] == new_blocked:
                continue
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
                errors.append(str(exc))

        await db.execute(
            "UPDATE rules SET is_blocked = ? WHERE category = ? AND is_custom = 0",
            (new_blocked, slug),
        )
        await db.commit()

    return {"category": slug, "is_blocked": new_blocked, "errors": errors}


class CustomRuleIn(BaseModel):
    name:      str
    value:     str
    rule_type: str = "domain"


@router.post("/rules/custom")
async def add_custom_rule(body: CustomRuleIn):
    if body.rule_type not in ("domain", "ip"):
        raise HTTPException(400, "rule_type must be 'domain' or 'ip'")

    try:
        if body.rule_type == "domain":
            await pihole_cmd.block_domain(body.value)
        else:
            await pihole_cmd.block_ip(body.value)
    except RuntimeError as exc:
        raise HTTPException(500, str(exc))

    async with await get_app_db() as db:
        await db.execute(
            """
            INSERT INTO rules (name, category, service_key, rule_type, value, is_blocked, is_custom)
            VALUES (?, 'custom', 'custom', ?, ?, 1, 1)
            """,
            (body.name, body.rule_type, body.value),
        )
        await db.commit()
        row = await db.execute_fetchall(
            "SELECT * FROM rules WHERE value = ? AND is_custom = 1", (body.value,)
        )

    return dict(row[0]) if row else {"ok": True}


@router.delete("/rules/{rule_id}")
async def delete_rule(rule_id: int):
    async with await get_app_db() as db:
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
