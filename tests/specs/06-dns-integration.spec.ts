/**
 * 06-dns-integration.spec.ts
 *
 * End-to-end DNS verification — proves that toggling controls in the UI
 * actually changes what DNS resolves to.
 *
 * Run via:  ./tests/run-tests.sh
 * That script temporarily sets system DNS to the Pi so browser-initiated
 * DNS queries (Playwright page navigations) also flow through Pi-hole.
 * resolve4() always queries the Pi directly regardless of system DNS.
 *
 * What is tested:
 *   1. Pi DNS responds to queries
 *   2. Blocking a domain → Pi returns 0.0.0.0
 *   3. Unblocking → real IP comes back
 *   4. Category block → ALL domains in category return 0.0.0.0
 *   5. UI toggle → DNS change confirmed
 *   6. Queries made to Pi appear in dashboard stats
 *   7. Blocked queries appear in /api/blocks
 *   8. Querying devices appear in /api/devices
 */

import { test, expect } from "@playwright/test";
import { Resolver } from "dns/promises";
import {
  ensureCategoryUnblocked,
  ensureRuleBlocked,
  deleteCustomRule,
  apiPost,
  apiGet,
  apiDelete,
} from "../helpers/api";
import { waitForData } from "../helpers/page";

const PI_DNS   = process.env.PI_HOST  ?? "192.168.0.51";
const API_URL  = process.env.API_URL  ?? "http://192.168.0.51:8080";
const BLOCK_IP = "0.0.0.0";
// A real domain we can safely temporarily block and unblock
const SAFE_DOMAIN = "cloudflare.com";
// Throwaway domain for block-logging tests — doesn't need to resolve upstream
const TEST_DOMAIN = "dns-pitest-playwright.example.com";

// ── DNS helpers ───────────────────────────────────────────────────────────────
// Always queries the Pi DNS directly so tests work regardless of system DNS.

function makePiResolver() {
  const r = new Resolver({ timeout: 5000 });
  r.setServers([PI_DNS]);
  return r;
}

async function resolve4(domain: string): Promise<string[]> {
  try {
    return await makePiResolver().resolve4(domain);
  } catch {
    return ["NXDOMAIN"];
  }
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Pi DNS connectivity
// ─────────────────────────────────────────────────────────────────────────────
test.describe("Pi DNS — Connectivity", () => {
  test("Pi DNS server is reachable and resolves google.com", async () => {
    const addrs = await resolve4("google.com");
    expect(addrs.length).toBeGreaterThan(0);
    expect(addrs[0]).not.toBe(BLOCK_IP);
    expect(addrs[0]).not.toBe("NXDOMAIN");
  });

  test("Pi DNS returns 0.0.0.0 for a freshly blocked domain", async () => {
    await apiPost("/api/rules/custom", {
      name: "DNS connectivity test",
      value: TEST_DOMAIN,
      is_blocked: true,
    });
    await sleep(2000);

    const addrs = await resolve4(TEST_DOMAIN);
    expect(addrs).toContain(BLOCK_IP);
  });

  test("Pi DNS stops returning 0.0.0.0 after unblocking a real domain", async () => {
    // Block a real domain temporarily
    await apiPost("/api/rules/custom", {
      name: "DNS unblock test",
      value: SAFE_DOMAIN,
      is_blocked: true,
    });
    await sleep(2000);

    const blocked = await resolve4(SAFE_DOMAIN);
    expect(blocked).toContain(BLOCK_IP);

    // Find the rule and unblock it
    const { rules } = await apiGet("/api/rules");
    const rule = rules.find(
      (r: { value: string; is_custom: number }) => r.value === SAFE_DOMAIN && r.is_custom
    );
    expect(rule).toBeTruthy();
    await apiPost(`/api/rules/${rule.id}/toggle`);
    await sleep(2000);

    const unblocked = await resolve4(SAFE_DOMAIN);
    expect(unblocked[0]).not.toBe(BLOCK_IP);
    expect(unblocked[0]).not.toBe("NXDOMAIN");

    // Cleanup
    await apiDelete(`/api/rules/${rule.id}`);
  });

  test.afterAll(async () => {
    await deleteCustomRule(TEST_DOMAIN);
    await deleteCustomRule(SAFE_DOMAIN);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Individual rule toggle via API
// ─────────────────────────────────────────────────────────────────────────────
test.describe("Pi DNS — Rule toggle (API)", () => {
  test.beforeEach(async () => {
    await ensureRuleBlocked("tiktok.com", false);
    await sleep(2000);
  });
  test.afterEach(async () => {
    await ensureRuleBlocked("tiktok.com", false);
    await sleep(1000);
  });

  test("blocking tiktok.com via API → DNS returns 0.0.0.0", async () => {
    const { rules } = await apiGet("/api/rules");
    const rule = rules.find((r: { value: string }) => r.value === "tiktok.com");
    expect(rule).toBeTruthy();

    await apiPost(`/api/rules/${rule.id}/toggle`);
    await sleep(2000);

    const addrs = await resolve4("tiktok.com");
    expect(addrs).toContain(BLOCK_IP);
  });

  test("unblocking tiktok.com via API → DNS returns real IP", async () => {
    await ensureRuleBlocked("tiktok.com", true);
    await sleep(2000);

    const blocked = await resolve4("tiktok.com");
    expect(blocked).toContain(BLOCK_IP);

    const { rules } = await apiGet("/api/rules");
    const rule = rules.find((r: { value: string }) => r.value === "tiktok.com");
    await apiPost(`/api/rules/${rule.id}/toggle`); // unblock
    await sleep(2000);

    const unblocked = await resolve4("tiktok.com");
    expect(unblocked[0]).not.toBe(BLOCK_IP);
    expect(unblocked[0]).not.toBe("NXDOMAIN");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Category block via API
// ─────────────────────────────────────────────────────────────────────────────
test.describe("Pi DNS — Category block (API)", () => {
  test.beforeEach(async () => {
    await ensureCategoryUnblocked("social");
    await sleep(3000);
  });
  test.afterEach(async () => {
    await ensureCategoryUnblocked("social");
    await sleep(2000);
  });

  test("blocking social category blocks youtube, tiktok, instagram via DNS", async () => {
    await apiPost("/api/categories/social/toggle");
    await sleep(3000);

    const [youtube, tiktok, instagram, discord] = await Promise.all([
      resolve4("youtube.com"),
      resolve4("tiktok.com"),
      resolve4("instagram.com"),
      resolve4("discord.com"),
    ]);

    expect(youtube,    "youtube.com should be blocked").toContain(BLOCK_IP);
    expect(tiktok,     "tiktok.com should be blocked").toContain(BLOCK_IP);
    expect(instagram,  "instagram.com should be blocked").toContain(BLOCK_IP);
    expect(discord,    "discord.com should be blocked").toContain(BLOCK_IP);
  });

  test("unblocking social restores DNS for youtube.com", async () => {
    await apiPost("/api/categories/social/toggle"); // block
    await sleep(2000);

    const blocked = await resolve4("youtube.com");
    expect(blocked).toContain(BLOCK_IP);

    await apiPost("/api/categories/social/toggle"); // unblock
    await sleep(2000);

    const unblocked = await resolve4("youtube.com");
    expect(unblocked[0]).not.toBe(BLOCK_IP);
    expect(unblocked[0]).not.toBe("NXDOMAIN");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. UI toggle → DNS verified
// ─────────────────────────────────────────────────────────────────────────────
test.describe("Pi DNS — Toggle via UI (Playwright + DNS)", () => {
  test.beforeEach(async () => {
    await ensureRuleBlocked("tiktok.com", false);
    await sleep(2000);
  });
  test.afterEach(async () => {
    await ensureRuleBlocked("tiktok.com", false);
    await sleep(1000);
  });

  test("clicking TikTok toggle in UI blocks it at DNS level", async ({ page }) => {
    await page.goto("/controls/");
    await waitForData(page);

    const row    = page.locator("div.py-3").filter({ hasText: "TikTok" }).first();
    const toggle = row.locator('[role="switch"]');
    await expect(toggle).toHaveAttribute("aria-checked", "false");

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true", { timeout: 10_000 });

    await sleep(2000);
    const addrs = await resolve4("tiktok.com");
    expect(addrs).toContain(BLOCK_IP);
  });

  test("clicking toggle again unblocks TikTok at DNS level", async ({ page }) => {
    await ensureRuleBlocked("tiktok.com", true);
    await sleep(2000);

    await page.goto("/controls/");
    await waitForData(page);

    const row    = page.locator("div.py-3").filter({ hasText: "TikTok" }).first();
    const toggle = row.locator('[role="switch"]');
    await expect(toggle).toHaveAttribute("aria-checked", "true");

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "false", { timeout: 10_000 });

    await sleep(2000);
    const addrs = await resolve4("tiktok.com");
    expect(addrs[0]).not.toBe(BLOCK_IP);
    expect(addrs[0]).not.toBe("NXDOMAIN");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Gaming category block via UI
// ─────────────────────────────────────────────────────────────────────────────
test.describe("Pi DNS — Gaming block via UI", () => {
  test.beforeEach(async () => {
    await ensureCategoryUnblocked("gaming");
    await sleep(2000);
  });
  test.afterEach(async () => {
    await ensureCategoryUnblocked("gaming");
    await sleep(1000);
  });

  test("blocking Games in UI → Steam, Roblox, Minecraft all return 0.0.0.0", async ({ page }) => {
    await page.goto("/controls/");
    await waitForData(page);

    const gaming = page.locator("section").filter({ has: page.locator("h2:has-text('Games')") });
    const toggle = gaming.locator('[role="switch"]').first();
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true", { timeout: 10_000 });

    await sleep(2000);

    const [steam, roblox, minecraft] = await Promise.all([
      resolve4("steamcommunity.com"),
      resolve4("roblox.com"),
      resolve4("minecraft.net"),
    ]);

    expect(steam,     "Steam should be blocked").toContain(BLOCK_IP);
    expect(roblox,    "Roblox should be blocked").toContain(BLOCK_IP);
    expect(minecraft, "Minecraft should be blocked").toContain(BLOCK_IP);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Timed block via API — DNS confirms block, UI shows timer badge
// ─────────────────────────────────────────────────────────────────────────────
test.describe("Pi DNS — Block for period", () => {
  test.beforeEach(async () => {
    await ensureRuleBlocked("tiktok.com", false);
    await sleep(2000);
  });
  test.afterEach(async () => {
    await ensureRuleBlocked("tiktok.com", false);
    await sleep(1000);
  });

  test("block-for sets 0.0.0.0 at DNS and shows timer badge in UI", async ({ page }) => {
    const { rules } = await apiGet("/api/rules");
    const rule = rules.find((r: { value: string }) => r.value === "tiktok.com");
    expect(rule).toBeTruthy();

    await apiPost(`/api/rules/${rule.id}/block-for`, { minutes: 30 });
    await sleep(2000);

    const addrs = await resolve4("tiktok.com");
    expect(addrs).toContain(BLOCK_IP);

    await page.goto("/controls/");
    await waitForData(page);
    await expect(page.locator("text=then unblocks").first()).toBeVisible({ timeout: 8_000 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. Query logging
// ─────────────────────────────────────────────────────────────────────────────
test.describe("Pi DNS — Query logging", () => {
  test("DNS queries to Pi appear in traffic top domains", async ({ request }) => {
    // Fire the same domain many times so it ranks in top-100
    for (let i = 0; i < 8; i++) await resolve4("github.com");
    await sleep(4000);

    const { domains } = await (await request.get(`${API_URL}/api/traffic?limit=100`)).json();
    const found = domains.some((d: { domain: string }) => d.domain === "github.com");
    expect(found, "github.com should appear in /api/traffic after repeated queries").toBe(true);
  });

  test("blocked queries appear in /api/blocks", async ({ request }) => {
    await apiPost("/api/rules/custom", {
      name: "block-log-test",
      value: TEST_DOMAIN,
      is_blocked: true,
    });
    await sleep(2000);

    await resolve4(TEST_DOMAIN);
    await resolve4(TEST_DOMAIN);
    await resolve4(TEST_DOMAIN);
    await sleep(3000);

    const { blocks } = await (await request.get(`${API_URL}/api/blocks?limit=200`)).json();
    const found = blocks.some((b: { domain: string }) => b.domain === TEST_DOMAIN);
    expect(found, `${TEST_DOMAIN} should appear in /api/blocks`).toBe(true);

    await deleteCustomRule(TEST_DOMAIN);
  });

  test("machine querying Pi appears in /api/devices", async ({ request }) => {
    await Promise.all([
      resolve4("google.com"),
      resolve4("cloudflare.com"),
      resolve4("github.com"),
    ]);
    await sleep(3000);

    const { devices } = await (await request.get(`${API_URL}/api/devices`)).json();
    expect(devices.length).toBeGreaterThan(0);
    const active = devices.some((d: { queries_today: number }) => d.queries_today > 0);
    expect(active).toBe(true);
  });

  test("top domains list includes recently queried domain", async ({ request }) => {
    // Fire many queries to ensure wikipedia.org ranks
    for (let i = 0; i < 5; i++) await resolve4("wikipedia.org");
    await sleep(3000);

    const { domains } = await (await request.get(`${API_URL}/api/traffic?limit=100`)).json();
    const found = domains.some((d: { domain: string }) => d.domain === "wikipedia.org");
    expect(found, "wikipedia.org should appear in top domains").toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. Custom domain block via UI → DNS confirmed
// ─────────────────────────────────────────────────────────────────────────────
test.describe("Pi DNS — Custom domain via UI", () => {
  const CUSTOM = "custom-dns-test-playwright.example.com";

  test.beforeEach(async () => deleteCustomRule(CUSTOM));
  test.afterEach(async ()  => deleteCustomRule(CUSTOM));

  test("adding and blocking a custom domain via UI → DNS returns 0.0.0.0", async ({ page }) => {
    await page.goto("/controls/");
    await waitForData(page);

    await page.locator('input[placeholder="Name (optional)"]').fill("DNS test");
    await page.locator('input[placeholder="domain.com"]').fill(CUSTOM);
    await page.locator('button:has-text("Add Rule")').click();

    await expect(page.locator(`text=${CUSTOM}`).first()).toBeVisible({ timeout: 20_000 });

    // Toggle to block it
    const ruleRow = page.locator("div.py-3").filter({ hasText: CUSTOM });
    await ruleRow.locator('[role="switch"]').click();
    await expect(ruleRow.locator('[role="switch"]')).toHaveAttribute("aria-checked", "true", { timeout: 10_000 });

    await sleep(2000);

    const addrs = await resolve4(CUSTOM);
    expect(addrs).toContain(BLOCK_IP);
  });
});
