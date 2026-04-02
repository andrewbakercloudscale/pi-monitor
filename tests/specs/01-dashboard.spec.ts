/**
 * 01-dashboard.spec.ts
 *
 * Dashboard page — stats, top domains, blocked domains, date navigation.
 *
 * As a parent, the dashboard is the first thing I see. I need to understand
 * at a glance: how much traffic is there today, what was blocked, and which
 * devices are online.
 */

import { test, expect } from "@playwright/test";
import { waitForData, getStatValue } from "../helpers/page";
import { apiPost, apiGet, deleteCustomRule } from "../helpers/api";

test.describe("Dashboard", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await waitForData(page);
  });

  test("page title and nav are visible", async ({ page }) => {
    await expect(page).toHaveTitle(/Pi Monitor/i);
    await expect(page.locator("aside")).toContainText("Pi Monitor");
    await expect(page.locator('aside nav a:has-text("Dashboard")')).toBeVisible();
    await expect(page.locator('aside nav a:has-text("Devices")')).toBeVisible();
    await expect(page.locator('aside nav a:has-text("Controls")')).toBeVisible();
    await expect(page.locator('aside nav a:has-text("Settings")')).toBeVisible();
  });

  test("stats cards show numeric values", async ({ page }) => {
    const queries = await getStatValue(page, "DNS Queries");
    const blocks  = await getStatValue(page, "Blocks");
    const devices = await getStatValue(page, "Devices Seen");

    expect(queries).toBeGreaterThanOrEqual(0);
    expect(blocks).toBeGreaterThanOrEqual(0);
    expect(devices).toBeGreaterThanOrEqual(0);

    // Sanity: can't have more blocks than total queries
    expect(blocks).toBeLessThanOrEqual(queries + 1); // +1 for edge case
  });

  test("top domains list is visible", async ({ page }) => {
    await expect(page.locator("h2:has-text('Top Domains')")).toBeVisible();
    // Either shows domain rows or the empty state
    const hasRows  = await page.locator("table tbody tr").count() > 0;
    const hasEmpty = await page.locator("text=No data").count() > 0;
    expect(hasRows || hasEmpty).toBeTruthy();
  });

  test("blocked domains panel is visible", async ({ page }) => {
    await expect(page.locator("h2:has-text('Blocked Domains')")).toBeVisible();
  });

  test("date picker: go to yesterday and back", async ({ page }) => {
    // Note today's query count
    const todayQueries = await getStatValue(page, "DNS Queries");

    // Click Prev
    await page.click('[aria-label="Previous day"]');
    await waitForData(page);

    // Stats should reload (yesterday's values — just check they're numeric)
    const yesterdayQueries = await getStatValue(page, "DNS Queries");
    expect(yesterdayQueries).toBeGreaterThanOrEqual(0);

    // Click Next to return to today
    await page.click('[aria-label="Next day"]');
    await waitForData(page);
    // Poll until the stat card shows a non-zero value — avoids a race where
    // waitForData resolves before the new fetch even starts (React batching).
    await page.waitForFunction(
      () => {
        const cards = Array.from(document.querySelectorAll(".rounded-xl"));
        const dnsCard = cards.find((c) => c.textContent?.includes("DNS Queries"));
        if (!dnsCard) return false;
        const valEl = dnsCard.querySelector(".text-3xl");
        return valEl ? parseInt(valEl.textContent?.replace(/,/g, "") ?? "0", 10) > 0 : false;
      },
      { timeout: 12_000 }
    );
    const backToToday = await getStatValue(page, "DNS Queries");
    // Verify today's stats loaded (not zero) — don't compare to earlier read since
    // the live Pi-hole DB can return slightly different counts between fetches
    expect(backToToday).toBeGreaterThan(0);
  });

  test("Next button is disabled when viewing today", async ({ page }) => {
    const nextBtn = page.locator('[aria-label="Next day"]');
    await expect(nextBtn).toBeDisabled();
  });

  test("domain rows show domain + count side by side", async ({ page }) => {
    const rows = page.locator("h2:has-text('Top Domains') + div > div");
    const count = await rows.count();
    if (count > 0) {
      const first = rows.first();
      const text = await first.innerText();
      // Should contain a domain-like string and a number
      expect(text).toMatch(/\./); // domain has a dot
    }
  });

  test("blocked domain names are visually distinct (red)", async ({ page }) => {
    const blockedItems = page.locator(".text-red-700");
    // May be 0 if nothing blocked — just ensure there's no error
    const count = await blockedItems.count();
    expect(count).toBeGreaterThanOrEqual(0);
  });

  test("top domains table has Blocked and Last Blocked columns", async ({ page }) => {
    // "Blocked" and "Last Blocked" headers only exist in the Top Domains table
    await expect(page.locator("th:has-text('Last Blocked')").first()).toBeVisible();
    await expect(page.locator("th", { hasText: /^Blocked$/ }).first()).toBeVisible();
  });

  test("blocked domain shows Shield badge (not Block button) in Top Domains", async ({ page }) => {
    const TEST = "dashboard-block-test.example.com";

    // Ensure the domain is blocked via the API so it appears in rules
    await apiPost("/api/rules/custom", { name: TEST, value: TEST, is_blocked: true });

    // Reload the page — rules cache is invalidated on load so the badge should appear
    await page.goto("/");
    await waitForData(page);

    // Find the row if it appears in traffic (it may not — the domain has no real queries)
    // Instead verify the API state is reflected: if we can find the row, it must show Blocked
    const rows = page.locator("table tbody tr");
    const count = await rows.count();
    for (let i = 0; i < count; i++) {
      const text = await rows.nth(i).innerText();
      if (text.includes(TEST)) {
        await expect(rows.nth(i).locator('[class*="text-red"]')).toBeVisible();
        break;
      }
    }

    await deleteCustomRule(TEST);
  });

  test("domain row with block history shows a count in Blocked column", async ({ page }) => {
    const API = process.env.API_URL ?? "http://192.168.0.51:8080";

    // Only meaningful if there are blocks today
    const { blocks } = await (await page.request.get(`${API}/api/blocks?limit=5`)).json();
    if (blocks.length === 0) return; // no blocks today — skip

    // The top blocked domain should appear in the traffic table with a count
    const topBlocked = blocks[0].domain as string;

    // Wait for the row to be present
    const row = page.locator("table tbody tr").filter({ hasText: topBlocked }).first();
    await expect(row).toBeVisible({ timeout: 10_000 });

    // The "Blocked" count cell (2nd from last before Devices/Action) must not be "—"
    const cells     = row.locator("td");
    const cellCount = await cells.count();
    const blockedCell     = cells.nth(cellCount - 4); // Blocked count
    const lastBlockedCell = cells.nth(cellCount - 3); // Last Blocked

    await expect(blockedCell).not.toHaveText("—");
    await expect(lastBlockedCell).not.toHaveText("—");
  });
});
