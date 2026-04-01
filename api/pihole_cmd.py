"""
pihole_cmd.py — Execute Pi-hole v6 CLI commands and custom.list edits.

Pi-hole v6 syntax:
  Block domain:   pihole deny domain.com
  Unblock domain: pihole deny -d domain.com
  Reload DNS:     pihole restartdns reload
"""

import asyncio
import os

CUSTOM_LIST = "/etc/pihole/custom.list"


async def _run(*args: str, timeout: int = 30) -> tuple[int, str]:
    proc = await asyncio.create_subprocess_exec(
        *args,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
    )
    try:
        stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=timeout)
        return proc.returncode, stdout.decode(errors="replace").strip()
    except asyncio.TimeoutError:
        proc.kill()
        raise RuntimeError(f"Command timed out: {' '.join(args)}")


async def block_domain(domain: str) -> None:
    rc, out = await _run("pihole", "deny", domain)
    if rc != 0:
        raise RuntimeError(f"pihole deny failed ({rc}): {out[:200]}")


async def unblock_domain(domain: str) -> None:
    rc, out = await _run("pihole", "deny", "-d", domain)
    if rc != 0:
        raise RuntimeError(f"pihole deny -d failed ({rc}): {out[:200]}")


async def block_ip(ip: str) -> None:
    entry = f"0.0.0.0 {ip}"
    try:
        with open(CUSTOM_LIST) as f:
            lines = f.readlines()
    except FileNotFoundError:
        lines = []

    if entry not in [l.strip() for l in lines]:
        with open(CUSTOM_LIST, "a") as f:
            f.write(entry + "\n")

    await _run("pihole", "restartdns", "reload")


async def unblock_ip(ip: str) -> None:
    entry = f"0.0.0.0 {ip}"
    try:
        with open(CUSTOM_LIST) as f:
            lines = f.readlines()
    except FileNotFoundError:
        return

    filtered = [l for l in lines if l.strip() != entry]
    with open(CUSTOM_LIST, "w") as f:
        f.writelines(filtered)

    await _run("pihole", "restartdns", "reload")
