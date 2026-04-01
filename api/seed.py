"""
seed.py — Insert built-in rules into app.db on first run.

73 domains across gaming / social / streaming.
Run once: python3 seed.py  (or called automatically from main.py lifespan)
"""

import asyncio
from db import get_app_db

RULES = [
    # ── Gaming ──────────────────────────────────────────────────────────────
    ("Steam",                  "gaming", "gaming_steam",     "steampowered.com"),
    ("Steam",                  "gaming", "gaming_steam",     "steamcommunity.com"),
    ("Steam",                  "gaming", "gaming_steam",     "steamserver.net"),
    ("Steam",                  "gaming", "gaming_steam",     "steamcdn-a.akamaihd.net"),
    ("Steam",                  "gaming", "gaming_steam",     "api.steampowered.com"),
    ("Roblox",                 "gaming", "gaming_roblox",    "roblox.com"),
    ("Roblox",                 "gaming", "gaming_roblox",    "rbxcdn.com"),
    ("Roblox",                 "gaming", "gaming_roblox",    "rbxtrk.com"),
    ("Roblox",                 "gaming", "gaming_roblox",    "robloxlabs.com"),
    ("Epic Games / Fortnite",  "gaming", "gaming_epic",      "epicgames.com"),
    ("Epic Games / Fortnite",  "gaming", "gaming_epic",      "fortnite.com"),
    ("Epic Games / Fortnite",  "gaming", "gaming_epic",      "epicgamescdn.com"),
    ("Epic Games / Fortnite",  "gaming", "gaming_epic",      "unrealengine.com"),
    ("Minecraft",              "gaming", "gaming_minecraft", "minecraft.net"),
    ("Minecraft",              "gaming", "gaming_minecraft", "minecraftservices.com"),
    ("Minecraft",              "gaming", "gaming_minecraft", "mojang.com"),
    ("Xbox Live",              "gaming", "gaming_xbox",      "xboxlive.com"),
    ("Xbox Live",              "gaming", "gaming_xbox",      "xbox.com"),
    ("Xbox Live",              "gaming", "gaming_xbox",      "xboxone.com"),
    ("Xbox Live",              "gaming", "gaming_xbox",      "playfabapi.com"),
    ("PlayStation Network",    "gaming", "gaming_psn",       "playstation.com"),
    ("PlayStation Network",    "gaming", "gaming_psn",       "playstation.net"),
    ("PlayStation Network",    "gaming", "gaming_psn",       "dl.playstation.net"),
    ("Call of Duty",           "gaming", "gaming_cod",       "callofduty.com"),
    ("Call of Duty",           "gaming", "gaming_cod",       "activision.com"),
    ("Call of Duty",           "gaming", "gaming_cod",       "demonware.net"),
    ("EA / Origin",            "gaming", "gaming_ea",        "ea.com"),
    ("EA / Origin",            "gaming", "gaming_ea",        "origin.com"),
    ("EA / Origin",            "gaming", "gaming_ea",        "easports.com"),
    ("EA / Origin",            "gaming", "gaming_ea",        "eaplay.com"),
    # ── Social ───────────────────────────────────────────────────────────────
    ("YouTube",    "social", "social_youtube",    "youtube.com"),
    ("YouTube",    "social", "social_youtube",    "youtu.be"),
    ("YouTube",    "social", "social_youtube",    "ytimg.com"),
    ("YouTube",    "social", "social_youtube",    "googlevideo.com"),
    ("YouTube",    "social", "social_youtube",    "youtube-nocookie.com"),
    ("TikTok",     "social", "social_tiktok",     "tiktok.com"),
    ("TikTok",     "social", "social_tiktok",     "tiktokv.com"),
    ("TikTok",     "social", "social_tiktok",     "muscdn.com"),
    ("TikTok",     "social", "social_tiktok",     "musical.ly"),
    ("Instagram",  "social", "social_instagram",  "instagram.com"),
    ("Instagram",  "social", "social_instagram",  "cdninstagram.com"),
    ("Snapchat",   "social", "social_snapchat",   "snapchat.com"),
    ("Snapchat",   "social", "social_snapchat",   "snapkit.com"),
    ("Snapchat",   "social", "social_snapchat",   "sc-cdn.net"),
    ("Discord",    "social", "social_discord",    "discord.com"),
    ("Discord",    "social", "social_discord",    "discordapp.com"),
    ("Discord",    "social", "social_discord",    "discord.gg"),
    ("Discord",    "social", "social_discord",    "discordcdn.com"),
    ("X / Twitter","social", "social_twitter",    "twitter.com"),
    ("X / Twitter","social", "social_twitter",    "x.com"),
    ("X / Twitter","social", "social_twitter",    "t.co"),
    ("X / Twitter","social", "social_twitter",    "twimg.com"),
    ("Facebook",   "social", "social_facebook",   "facebook.com"),
    ("Facebook",   "social", "social_facebook",   "fbcdn.net"),
    ("Facebook",   "social", "social_facebook",   "fb.com"),
    ("Facebook",   "social", "social_facebook",   "fbsbx.com"),
    # ── Streaming ────────────────────────────────────────────────────────────
    ("Netflix",   "streaming", "streaming_netflix",  "netflix.com"),
    ("Netflix",   "streaming", "streaming_netflix",  "nflxvideo.net"),
    ("Netflix",   "streaming", "streaming_netflix",  "nflximg.net"),
    ("Netflix",   "streaming", "streaming_netflix",  "nflxext.com"),
    ("Disney+",   "streaming", "streaming_disney",   "disneyplus.com"),
    ("Disney+",   "streaming", "streaming_disney",   "dssott.com"),
    ("Disney+",   "streaming", "streaming_disney",   "bamgrid.com"),
    ("Twitch",    "streaming", "streaming_twitch",   "twitch.tv"),
    ("Twitch",    "streaming", "streaming_twitch",   "twitchapps.com"),
    ("Twitch",    "streaming", "streaming_twitch",   "jtvnw.net"),
    ("Twitch",    "streaming", "streaming_twitch",   "ext-twitch.tv"),
    ("Spotify",   "streaming", "streaming_spotify",  "spotify.com"),
    ("Spotify",   "streaming", "streaming_spotify",  "scdn.co"),
    ("Spotify",   "streaming", "streaming_spotify",  "spotifycdn.com"),
    ("Hulu",      "streaming", "streaming_hulu",     "hulu.com"),
    ("Hulu",      "streaming", "streaming_hulu",     "huluim.com"),
    ("Hulu",      "streaming", "streaming_hulu",     "hulustream.com"),
]


async def seed():
    async with get_app_db() as db:
        existing = await db.execute_fetchall("SELECT value FROM rules WHERE is_custom = 0")
        existing_values = {r["value"] for r in existing}

        to_insert = [r for r in RULES if r[3] not in existing_values]
        if not to_insert:
            return

        await db.executemany(
            """
            INSERT OR IGNORE INTO rules (name, category, service_key, rule_type, value, is_blocked, is_custom)
            VALUES (?, ?, ?, 'domain', ?, 0, 0)
            """,
            to_insert,
        )
        await db.commit()
        print(f"Seeded {len(to_insert)} rules.")


if __name__ == "__main__":
    asyncio.run(seed())
